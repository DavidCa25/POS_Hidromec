/* sp_import_resolve_row
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* Resolver UNA fila. El grupo resuelve muchas de golpe; esto es para el
   caso que no se parece a ningun otro —el codigo repetido con otro nombre—
   y que por eso no se puede meter en un lote. */
CREATE OR ALTER PROCEDURE dbo.sp_import_resolve_row
    @row_id INT,
    @resolucion NVARCHAR(20),     -- ACTUALIZAR | CREAR_OTRO | IGNORAR | EDITAR
    @campo NVARCHAR(40) = NULL,
    @valor NVARCHAR(200) = NULL
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @batch_id INT = (SELECT batch_id FROM dbo.import_rows WHERE id = @row_id);
    IF @batch_id IS NULL BEGIN SELECT 0 AS resueltas; RETURN; END

    IF EXISTS (SELECT 1 FROM dbo.import_rows WHERE id = @row_id AND aplicada = 1)
    BEGIN
        /* Una fila que ya entro al catalogo no se «resuelve»: se edita el
           producto, que es otra pantalla y otro permiso. */
        RAISERROR('Esa fila ya se importó.', 16, 1);
        RETURN;
    END

    IF @resolucion = 'EDITAR' AND @campo IS NOT NULL
    BEGIN
        IF @campo = 'nombre'        UPDATE dbo.import_rows SET nombre = @valor WHERE id = @row_id;
        IF @campo = 'price'         UPDATE dbo.import_rows SET price = TRY_CONVERT(DECIMAL(10,2), @valor) WHERE id = @row_id;
        IF @campo = 'cost'          UPDATE dbo.import_rows SET cost = TRY_CONVERT(DECIMAL(14,4), @valor) WHERE id = @row_id;
        IF @campo = 'stock'         UPDATE dbo.import_rows SET stock = TRY_CONVERT(DECIMAL(12,2), @valor) WHERE id = @row_id;
        IF @campo = 'part_number'   UPDATE dbo.import_rows SET part_number = @valor WHERE id = @row_id;
        IF @campo = 'bar_code'      UPDATE dbo.import_rows SET bar_code = @valor WHERE id = @row_id;
        IF @campo = 'category_name' UPDATE dbo.import_rows SET category_name = @valor WHERE id = @row_id;
        IF @campo = 'brand_name'    UPDATE dbo.import_rows SET brand_name = @valor WHERE id = @row_id;
        IF @campo = 'base_uom'      UPDATE dbo.import_rows SET base_uom = @valor WHERE id = @row_id;
    END

    IF @resolucion = 'ACTUALIZAR'
        UPDATE dbo.import_rows SET accion = 'UPDATE', resolucion = 'ACTUALIZAR'
         WHERE id = @row_id AND match_product_id IS NOT NULL;

    IF @resolucion = 'CREAR_OTRO'
        UPDATE dbo.import_rows SET accion = 'CREATE', resolucion = 'CREAR_OTRO',
               match_product_id = NULL, match_motivo = NULL
         WHERE id = @row_id;

    IF @resolucion = 'IGNORAR'
        UPDATE dbo.import_rows SET accion = 'OMITIR', resolucion = 'IGNORAR' WHERE id = @row_id;

    /* Tras editar, la fila se vuelve a mirar: si ya tiene lo minimo y no le
       queda ningun problema grave, deja de estar pendiente. */
    IF @resolucion = 'EDITAR'
    BEGIN
        UPDATE dbo.import_rows
           SET problemas_json = (
                 SELECT j.[value] FROM OPENJSON(ISNULL(problemas_json,'[]')) j
                  WHERE JSON_VALUE(j.[value], '$.campo') <> @campo
                  FOR JSON PATH)
         WHERE id = @row_id;

        UPDATE dbo.import_rows SET problemas_json = '[]'
         WHERE id = @row_id AND problemas_json IS NULL;

        UPDATE dbo.import_rows
           SET accion = CASE WHEN match_product_id IS NULL THEN 'CREATE' ELSE 'UPDATE' END
         WHERE id = @row_id AND accion = 'PENDIENTE'
           AND nombre IS NOT NULL AND price IS NOT NULL
           AND NOT EXISTS (SELECT 1 FROM OPENJSON(ISNULL(problemas_json,'[]'))
                            WITH (gravedad NVARCHAR(10) '$.gravedad') g WHERE g.gravedad = 'alto');
    END

    EXEC dbo.sp_import_batch_touch @batch_id = @batch_id;
    SELECT 1 AS resueltas;
END
GO
