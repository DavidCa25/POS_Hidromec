/* sp_resolver_receta_efectiva
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* ============================================================
   sp_resolver_receta_efectiva — LA receta efectiva. Una sola.

   QUE ES LA RECETA EFECTIVA
   -------------------------
   Lo que de verdad hay que sacar del almacen para preparar UNA unidad de un
   producto, con las opciones que eligio el cliente ya aplicadas:

       receta base (o la del tamano)
       x factor de escala
       - ingredientes removidos
       ~ ingredientes sustituidos
       + ingredientes anadidos

   POR QUE VIVE AQUI Y NO DENTRO DE LA VENTA
   -----------------------------------------
   Este calculo lo necesitan DOS cosas: registrar la venta y responder
   "¿cuantos de estos puedo preparar?". Tenerlo escrito dos veces es tener dos
   motores que empiezan iguales y terminan distintos, y el sintoma seria el
   peor posible: la pantalla dice que hay y el cobro dice que no, o al reves.

   POR QUE UN PROCEDIMIENTO Y NO UNA FUNCION
   -----------------------------------------
   Una funcion de tabla seria mas comoda de invocar, pero el constructor del
   baseline solo despliega objetos de tipo SQL_STORED_PROCEDURE: una funcion
   tendria su archivo en Git y NO viajaria al instalador. Ya paso dos veces
   (`sp_get_product_dependencies`, `sp_register_lease_touch`) y no se repite.

   Tampoco puede devolver un resultset: `sp_register_sale` tendria que hacer
   `INSERT ... EXEC`, y SQL Server prohibe el ROLLBACK dentro de esa
   construccion -sustituye el error real por otro que no dice nada-.

   Asi que el contrato son TABLAS TEMPORALES que crea quien llama:

     #ef_lineas       line_no, product_id, inventory_mode
                      + recipe_id, variant_option_id, scale  (los rellena este
                        procedimiento: son su respuesta, no su entrada)
     #ef_opciones     line_no, modifier_option_id, qty
     #ef_requerimientos  se llena aqui: que producto, cuanto, y de donde sale

   Es un acoplamiento explicito y documentado, y a cambio hay UNA sola
   implementacion de la regla.

   NO decide si algo esta mal: si un producto RECIPE se queda sin receta, deja
   `recipe_id` en NULL y quien llama dice por que (la venta con un mensaje, la
   disponibilidad devolviendo cero). Los mensajes son de quien tiene contexto.
   ============================================================ */
CREATE OR ALTER PROCEDURE [dbo].[sp_resolver_receta_efectiva]
AS
BEGIN
    SET NOCOUNT ON;

    /* Lo que el producto ES, si quien llama no lo dijo. */
    UPDATE l SET inventory_mode = ISNULL(l.inventory_mode, p.inventory_mode)
    FROM #ef_lineas l JOIN dbo.products p ON p.id = l.product_id;

    /* ---------------------------------------------------- 1) opciones
       Se releen de `modifier_options` en vez de fiarse de lo que llegue: el
       efecto, el ingrediente y las cantidades son configuracion, no algo que
       pueda decidir quien pide la venta. */
    IF OBJECT_ID('tempdb..#ef_op') IS NOT NULL DROP TABLE #ef_op;
    CREATE TABLE #ef_op (
        line_no INT NOT NULL,
        option_id INT NOT NULL,
        qty INT NOT NULL,
        role NVARCHAR(15) NULL,
        effect NVARCHAR(12) NULL,
        ingredient_product_id INT NULL,
        replaces_product_id INT NULL,
        qty_base DECIMAL(14,4) NULL,
        qty_factor DECIMAL(8,4) NULL
    );

    INSERT INTO #ef_op (line_no, option_id, qty, role, effect,
                        ingredient_product_id, replaces_product_id, qty_base, qty_factor)
    SELECT o.line_no, o.modifier_option_id, CASE WHEN ISNULL(o.qty, 1) < 1 THEN 1 ELSE o.qty END,
           g.role, mo.effect, mo.ingredient_product_id, mo.replaces_product_id, mo.qty_base, mo.qty_factor
    FROM #ef_opciones o
    JOIN dbo.modifier_options mo ON mo.id = o.modifier_option_id AND mo.active = 1
    JOIN dbo.modifier_groups g ON g.id = mo.group_id AND g.active = 1;

    /* ---------------------------------------------------- 2) que receta
       La del TAMANO elegido si existe; si no, la base. El orden del CASE es
       lo que da preferencia a la variante: una receta propia de "Grande" gana
       siempre a la base, y por eso el tamano no es una etiqueta.

       Una receta por variante SOLO se alcanza con su opcion SIZE en la linea.
       Eso es correcto y deliberado: la receta depende del tamano. */
    UPDATE l
       SET recipe_id = r.id,
           variant_option_id = r.variant_option_id
    FROM #ef_lineas l
    CROSS APPLY (
        SELECT TOP 1 rc.id, rc.variant_option_id
        FROM dbo.recipes rc
        WHERE rc.product_id = l.product_id AND rc.active = 1
          AND (rc.variant_option_id IS NULL
               OR rc.variant_option_id IN (SELECT o.option_id FROM #ef_op o
                                            WHERE o.line_no = l.line_no AND o.role = 'SIZE'))
        ORDER BY CASE WHEN rc.variant_option_id IS NULL THEN 1 ELSE 0 END
    ) r
    WHERE l.inventory_mode = 'RECIPE';

    /* ---------------------------------------------------- 3) escala
       SCALE multiplica la receta BASE. No se aplica sobre una receta de
       variante porque esa ya trae sus propias cantidades: multiplicarla seria
       contar el tamano dos veces. */
    UPDATE #ef_lineas SET scale = 1 WHERE scale IS NULL;

    UPDATE l SET scale = o.qty_factor
    FROM #ef_lineas l
    JOIN dbo.recipes r ON r.id = l.recipe_id AND r.variant_option_id IS NULL
    JOIN #ef_op o ON o.line_no = l.line_no AND o.effect = 'SCALE' AND o.qty_factor > 0
    WHERE l.inventory_mode = 'RECIPE';

    /* ---------------------------------------------------- 4) DIRECT
       Un producto de inventario directo se consume a si mismo. */
    INSERT INTO #ef_requerimientos (line_no, product_id, qty_per_unit, origen, modifier_option_id, recipe_id)
    SELECT l.line_no, l.product_id, 1, 'DIRECT', NULL, NULL
    FROM #ef_lineas l
    WHERE l.inventory_mode = 'DIRECT';

    /* NONE no consume nada: no se inserta ninguna fila, a proposito. */

    /* ---------------------------------------------------- 5) receta base
       La merma es parte del consumo real: preparar 240 ml con 2% de merma
       gasta 244.8 ml de almacen. `origen` distingue si la cantidad viene de
       una receta de tamano o de la base, para poder auditarlo despues. */
    INSERT INTO #ef_requerimientos (line_no, product_id, qty_per_unit, origen, modifier_option_id, recipe_id)
    SELECT l.line_no, rl.ingredient_product_id,
           rl.qty_base * (1 + rl.waste_pct / 100.0) * l.scale,
           CASE WHEN l.variant_option_id IS NOT NULL THEN 'SIZE' ELSE 'BASE' END,
           NULL, l.recipe_id
    FROM #ef_lineas l
    JOIN dbo.recipe_lines rl ON rl.recipe_id = l.recipe_id
    WHERE l.inventory_mode = 'RECIPE';

    /* ---------------------------------------------------- 6) REMOVE
       "Sin azucar" quita el requerimiento entero de ese ingrediente. Si el
       ingrediente no estaba en la receta, no hay nada que quitar y tampoco es
       un error: pedir "sin crema" un cafe que no lleva crema es inofensivo. */
    DELETE r
    FROM #ef_requerimientos r
    JOIN #ef_op o ON o.line_no = r.line_no AND o.effect = 'REMOVE'
                 AND o.replaces_product_id = r.product_id
    WHERE r.origen IN ('BASE', 'SIZE');

    /* ---------------------------------------------------- 7) SUBSTITUTE
       Cambia el ingrediente conservando la cantidad, salvo que la opcion
       traiga una cantidad propia (`qty_base`), que entonces manda y escala
       con el tamano. El requerimiento sustituido queda marcado con su opcion
       para poder auditar por que se consumio leche de almendra. */
    UPDATE r
       SET product_id = o.ingredient_product_id,
           qty_per_unit = ISNULL(o.qty_base * l.scale, r.qty_per_unit),
           origen = 'SUBSTITUTE',
           modifier_option_id = o.option_id
    FROM #ef_requerimientos r
    JOIN #ef_lineas l ON l.line_no = r.line_no
    JOIN #ef_op o ON o.line_no = r.line_no AND o.effect = 'SUBSTITUTE'
                 AND o.replaces_product_id = r.product_id
    WHERE r.origen IN ('BASE', 'SIZE');

    /* ---------------------------------------------------- 8) ADD
       Consumo extra. La cantidad elegida multiplica: dos shots son 2 x 30 g.
       NO escala con el tamano, a proposito: un shot es un shot, lo pidas en
       vaso chico o grande. */
    INSERT INTO #ef_requerimientos (line_no, product_id, qty_per_unit, origen, modifier_option_id, recipe_id)
    SELECT o.line_no, o.ingredient_product_id, o.qty_base * o.qty, 'ADD', o.option_id, NULL
    FROM #ef_op o
    JOIN #ef_lineas l ON l.line_no = o.line_no
    WHERE o.effect = 'ADD' AND o.ingredient_product_id IS NOT NULL AND o.qty_base > 0
      AND l.inventory_mode IN ('RECIPE', 'DIRECT');

    /* Un requerimiento de cantidad cero no consume nada y solo ensucia el
       historial y los movimientos de inventario. */
    DELETE FROM #ef_requerimientos WHERE qty_per_unit IS NULL OR qty_per_unit <= 0;

    DROP TABLE #ef_op;
END
GO
