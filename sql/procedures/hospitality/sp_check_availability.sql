/* sp_check_availability
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* ============================================================
   sp_check_availability — cuantas puedo preparar CON ESTAS OPCIONES.

   QUE PROBLEMA RESUELVE
   ---------------------
   `sp_get_menu_catalog` calcula la disponibilidad desde la receta BASE. Es
   correcto para pintar la rejilla, cuando todavia no hay nada elegido, pero
   deja de serlo en cuanto alguien elige: un latte podia mostrarse disponible y
   fallar al cobrar porque la leche de almendra que eligio estaba agotada. El
   mensaje que veia el cajero no hablaba de la leche.

   Son DOS preguntas distintas y aqui se responde la segunda:

     catalogo    "¿puedo ofrecer este producto?"   -> receta base, estimacion
     efectiva    "¿puedo preparar ESTA combinacion?" -> receta efectiva real

   USA EL MISMO MOTOR QUE LA VENTA
   -------------------------------
   `sp_resolver_receta_efectiva`, el mismo procedimiento que usa
   `sp_register_sale`. No es una copia parecida: es el mismo codigo. Si fueran
   dos, empezarian iguales y terminarian distintos, y el sintoma seria que la
   pantalla promete lo que el cobro rechaza.

   ESTO NO AUTORIZA NADA
   ---------------------
   Es informacion para la interfaz. La venta vuelve a validar existencias
   DENTRO de su transaccion, con los productos bloqueados. Entre esta consulta
   y el cobro puede vender otra caja, y esa carrera la resuelve la transaccion,
   no esta respuesta.

   Devuelve una fila: disponible (unidades enteras), y si algo limita, cual es
   y cuanto hay.
   ============================================================ */
CREATE OR ALTER PROCEDURE [dbo].[sp_check_availability]
    @product_id INT,
    @SaleModifiers dbo.SaleModifierType READONLY
AS
BEGIN
    SET NOCOUNT ON;

    IF NOT EXISTS (SELECT 1 FROM dbo.products WHERE id = @product_id AND active = 1)
    BEGIN
        SELECT CAST(0 AS INT) AS disponible, CAST(0 AS BIT) AS hay_receta,
               CAST(NULL AS INT) AS limita_product_id, CAST(NULL AS NVARCHAR(100)) AS limita_nombre,
               CAST(NULL AS DECIMAL(18,6)) AS limita_necesita, CAST(NULL AS DECIMAL(12,2)) AS limita_stock,
               CAST(NULL AS NVARCHAR(10)) AS limita_uom,
               N'El producto no existe o esta inactivo.' AS motivo;
        RETURN;
    END

    CREATE TABLE #ef_lineas (
        line_no INT NOT NULL PRIMARY KEY,
        product_id INT NOT NULL,
        inventory_mode NVARCHAR(10) NULL,
        recipe_id INT NULL,
        variant_option_id INT NULL,
        scale DECIMAL(8,4) NULL
    );
    CREATE TABLE #ef_opciones (
        line_no INT NOT NULL,
        modifier_option_id INT NOT NULL,
        qty INT NOT NULL
    );
    CREATE TABLE #ef_requerimientos (
        line_no INT NOT NULL,
        product_id INT NOT NULL,
        qty_per_unit DECIMAL(18,6) NOT NULL,
        origen NVARCHAR(12) NOT NULL,
        modifier_option_id INT NULL,
        recipe_id INT NULL
    );

    INSERT INTO #ef_lineas (line_no, product_id, scale) VALUES (1, @product_id, 1);
    INSERT INTO #ef_opciones (line_no, modifier_option_id, qty)
    SELECT 1, modifier_option_id, ISNULL(quantity, 1) FROM @SaleModifiers;

    EXEC dbo.sp_resolver_receta_efectiva;

    DECLARE @modo NVARCHAR(10), @recipe_id INT;
    SELECT @modo = inventory_mode, @recipe_id = recipe_id FROM #ef_lineas WHERE line_no = 1;

    /* Un producto con receta y sin receta resoluble no es "cero disponible":
       es que falta configurarlo, o falta elegir el tamano. Se distingue. */
    IF @modo = 'RECIPE' AND @recipe_id IS NULL
    BEGIN
        SELECT CAST(0 AS INT) AS disponible, CAST(0 AS BIT) AS hay_receta,
               CAST(NULL AS INT) AS limita_product_id, CAST(NULL AS NVARCHAR(100)) AS limita_nombre,
               CAST(NULL AS DECIMAL(18,6)) AS limita_necesita, CAST(NULL AS DECIMAL(12,2)) AS limita_stock,
               CAST(NULL AS NVARCHAR(10)) AS limita_uom,
               CASE
                   WHEN NOT EXISTS (SELECT 1 FROM dbo.recipes r WHERE r.product_id = @product_id AND r.active = 1)
                       THEN N'Este producto no tiene receta configurada.'
                   WHEN NOT EXISTS (SELECT 1 FROM #ef_opciones o
                                     JOIN dbo.modifier_options mo ON mo.id = o.modifier_option_id
                                     JOIN dbo.modifier_groups g ON g.id = mo.group_id AND g.role = 'SIZE')
                       THEN N'Falta elegir el tamano: la receta depende de el.'
                   ELSE N'El tamano elegido no tiene receta.'
               END AS motivo;
        RETURN;
    END

    /* NONE no consume nada: siempre se puede preparar. */
    IF NOT EXISTS (SELECT 1 FROM #ef_requerimientos)
    BEGIN
        SELECT CAST(999999 AS INT) AS disponible, CAST(1 AS BIT) AS hay_receta,
               CAST(NULL AS INT) AS limita_product_id, CAST(NULL AS NVARCHAR(100)) AS limita_nombre,
               CAST(NULL AS DECIMAL(18,6)) AS limita_necesita, CAST(NULL AS DECIMAL(12,2)) AS limita_stock,
               CAST(NULL AS NVARCHAR(10)) AS limita_uom, CAST(NULL AS NVARCHAR(200)) AS motivo;
        RETURN;
    END

    /* Cuantas unidades alcanzan, y cual es el ingrediente que pone el limite.
       Se agrupa por producto: si un ingrediente aparece dos veces -receta mas
       un extra del mismo- lo que manda es la suma, no cada parte. */
    SELECT TOP 1
        CAST(CASE WHEN t.necesita <= 0 THEN 999999
                  ELSE FLOOR(ISNULL(p.stock, 0) / t.necesita) END AS INT) AS disponible,
        CAST(1 AS BIT) AS hay_receta,
        p.id AS limita_product_id,
        p.nombre AS limita_nombre,
        t.necesita AS limita_necesita,
        ISNULL(p.stock, 0) AS limita_stock,
        p.base_uom AS limita_uom,
        CASE WHEN ISNULL(p.stock, 0) < t.necesita
             THEN CONCAT(N'No hay suficiente ', p.nombre, N' para preparar esta combinacion.')
             ELSE NULL END AS motivo
    FROM (SELECT product_id, SUM(qty_per_unit) AS necesita
            FROM #ef_requerimientos GROUP BY product_id) t
    JOIN dbo.products p ON p.id = t.product_id
    ORDER BY CASE WHEN t.necesita <= 0 THEN 999999
                  ELSE FLOOR(ISNULL(p.stock, 0) / t.necesita) END ASC,
             p.id ASC;
END
GO
