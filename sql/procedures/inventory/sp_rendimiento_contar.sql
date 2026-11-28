/* sp_rendimiento_contar
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* 0095 · GUARDA LO QUE QUEDÓ DE CADA CARNE AL CERRAR.

   @conteos: [{"carne_id": 12, "quedo_kg": 2.5}, …]   (las que se contestaron)

   Por cada una, en UNA transacción:
     usado = lo que había − lo que quedó
       · sale del inventario como salida RENDIMIENTO, a su costo de hoy: el
         estado de resultados la reparte entre los tacos vendidos;
       · si quedó MÁS de lo que había (una compra que no se capturó), la
         diferencia entra como ajuste de CONTEO y lo usado es 0;
     la existencia queda en lo que quedó;
     se guarda el conteo con los tacos vendidos desde el anterior.

   Reintentar el mismo corte no cuenta dos veces: la carne ya contada en él
   se salta. Devuelve cómo rindió (sp_rendimiento_dia). */
CREATE OR ALTER PROCEDURE dbo.sp_rendimiento_contar
    @closure_id INT = NULL,
    @user_id INT = NULL,
    @conteos NVARCHAR(MAX)
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    IF ISJSON(@conteos) <> 1 THROW 51000, 'Los conteos no son válidos.', 1;
    IF @closure_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM dbo.cash_closures WHERE id = @closure_id)
        THROW 51000, 'El corte indicado no existe.', 1;

    DECLARE @l TABLE (carne_id INT PRIMARY KEY, quedo DECIMAL(12, 2));
    INSERT INTO @l (carne_id, quedo)
    SELECT carne_id, ROUND(MAX(quedo_kg) * 1000, 2)
      FROM OPENJSON(@conteos) WITH (carne_id INT, quedo_kg DECIMAL(12, 3))
     WHERE carne_id IS NOT NULL AND quedo_kg IS NOT NULL
     GROUP BY carne_id;

    IF EXISTS (SELECT 1 FROM @l WHERE quedo < 0 OR quedo > 100000000)
        THROW 51000, 'Lo que quedó tiene que ser de 0 kg en adelante.', 1;
    IF EXISTS (SELECT 1 FROM @l l WHERE NOT EXISTS (SELECT 1 FROM dbo.rendimiento_carnes c WHERE c.product_id = l.carne_id AND c.activo = 1))
        THROW 51000, 'Esa carne no se lleva por rendimiento.', 1;

    /* Lo que el cierre ve en este momento (tenía, vendidos, precio). */
    DECLARE @vista TABLE (carne_id INT, nombre NVARCHAR(100), rinde DECIMAL(6, 2), desde DATETIME2(3), tenia_kg DECIMAL(12, 3),
                          comprado_kg DECIMAL(12, 3), vendidos DECIMAL(12, 2), precio_taco DECIMAL(10, 2), costo_kg DECIMAL(12, 2),
                          contado BIT, quedo_kg DECIMAL(12, 3));

    BEGIN TRAN;

    /* Nadie más mueve estas carnes mientras se cuentan. */
    DECLARE @bloqueo INT = (SELECT COUNT(*) FROM dbo.products WITH (UPDLOCK, HOLDLOCK) WHERE id IN (SELECT carne_id FROM @l));

    INSERT INTO @vista EXEC dbo.sp_rendimiento_cierre @closure_id = @closure_id;

    DECLARE @ahora DATETIME2(3) = SYSDATETIME();

    ;WITH x AS (
        SELECT l.carne_id, l.quedo, p.stock AS tenia, ISNULL(p.cost, 0) AS costo_g, v.desde, v.vendidos, v.precio_taco, v.rinde
          FROM @l l
          JOIN @vista v ON v.carne_id = l.carne_id AND v.contado = 0
          JOIN dbo.products p ON p.id = l.carne_id)
    SELECT * INTO #x FROM x;

    /* Lo usado sale a su costo; lo que sobró de más entra como ajuste. */
    INSERT INTO dbo.inventory_movements (product_id, typee, reference, quantity, datee, descriptionn, source, unit_cost)
    SELECT carne_id, 'salida', 'RENDIMIENTO', tenia - quedo, @ahora, N'Carne usada (cierre)', 'RENDIMIENTO', costo_g
      FROM #x WHERE tenia - quedo > 0
    UNION ALL
    SELECT carne_id, 'entrada', 'CONTEO', quedo - tenia, @ahora, N'Quedó más carne de la que había', 'RENDIMIENTO', costo_g
      FROM #x WHERE quedo - tenia > 0;

    UPDATE p SET stock = x.quedo
      FROM dbo.products p JOIN #x x ON x.carne_id = p.id;

    INSERT INTO dbo.rendimiento_conteos (carne_id, closure_id, desde, contado_en, tenia, quedo, usado, vendidos, rinde, costo_g, precio_taco, user_id)
    SELECT carne_id, @closure_id, desde, @ahora, tenia, quedo,
           CASE WHEN tenia > quedo THEN tenia - quedo ELSE 0 END, vendidos, rinde, costo_g, precio_taco, @user_id
      FROM #x;

    COMMIT;

    EXEC dbo.sp_rendimiento_dia @closure_id = @closure_id;
END;
GO
