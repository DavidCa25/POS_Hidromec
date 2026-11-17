/* sp_producto_impuestos_guardar
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* ================= sp_producto_impuestos_guardar (0083) =================
   Reemplaza los impuestos además del IVA de un producto.
   @impuestos  JSON: [{ "id": 3 }, { "id": 9, "cantidad": 0.6 }]
               cantidad = unidades de la cuota que trae UNA pieza (litros,
               cigarros); solo para los de cuota, y obligatoria en ellos.
   Un impuesto apagado se puede dejar marcado (no se cobra hasta encenderlo);
   uno nuevo apagado no se puede marcar.
   ======================================================================= */
CREATE OR ALTER PROCEDURE dbo.sp_producto_impuestos_guardar
    @product_id INT,
    @impuestos  NVARCHAR(MAX)
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    IF NOT EXISTS (SELECT 1 FROM dbo.products WHERE id = @product_id) THROW 51000, 'Ese producto no existe.', 1;
    /* Un producto de la matriz trae sus impuestos de allá (sp_corporate_catalog_apply). */
    IF EXISTS (SELECT 1 FROM dbo.products WHERE id = @product_id AND corporate = 1)
        THROW 51000, 'Este producto lo administra la matriz: sus impuestos se cambian allá y llegan solos.', 1;
    IF ISJSON(ISNULL(@impuestos, N'[]')) = 0 THROW 51000, 'Lista de impuestos inválida.', 1;

    SELECT DISTINCT j.id, j.cantidad
      INTO #n
      FROM OPENJSON(ISNULL(@impuestos, N'[]')) WITH (id INT '$.id', cantidad DECIMAL(12, 4) '$.cantidad') j
     WHERE j.id IS NOT NULL;

    IF EXISTS (SELECT 1 FROM #n n LEFT JOIN dbo.CAT_impuestos i ON i.id = n.id WHERE i.id IS NULL)
        THROW 51000, 'Uno de los impuestos no existe.', 1;
    IF EXISTS (SELECT 1 FROM #n n JOIN dbo.CAT_impuestos i ON i.id = n.id
                WHERE i.activo = 0 AND NOT EXISTS (SELECT 1 FROM dbo.product_impuestos pi WHERE pi.product_id = @product_id AND pi.impuesto_id = n.id))
        THROW 51000, 'Ese impuesto está apagado: enciéndelo en Configuración → Impuestos.', 1;
    IF EXISTS (SELECT 1 FROM #n n JOIN dbo.CAT_impuestos i ON i.id = n.id WHERE i.factor = 'Cuota' AND (n.cantidad IS NULL OR n.cantidad <= 0))
        THROW 51000, 'Un impuesto por cuota necesita cuánto trae una pieza (por ejemplo, 0.6 litros).', 1;

    BEGIN TRAN;
        DELETE FROM dbo.product_impuestos WHERE product_id = @product_id;
        INSERT INTO dbo.product_impuestos (product_id, impuesto_id, cantidad)
        SELECT @product_id, n.id, CASE WHEN i.factor = 'Cuota' THEN n.cantidad END
          FROM #n n JOIN dbo.CAT_impuestos i ON i.id = n.id;
    COMMIT;

    EXEC dbo.sp_producto_impuestos_get @product_id = @product_id;
END
GO
