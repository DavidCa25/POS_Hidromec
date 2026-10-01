/* sp_import_resolve_group
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* Resolver un GRUPO entero. Es lo que hace que «asignar categoria a los
   10» sea un gesto y no diez.

   NO TOCA EL CATALOGO: escribe en el almacen intermedio y vuelve a
   clasificar la fila. El catalogo se escribe al confirmar. */
CREATE OR ALTER PROCEDURE dbo.sp_import_resolve_group
    @batch_id INT,
    @codigo NVARCHAR(40),          -- que clase de problema se resuelve
    @resolucion NVARCHAR(20),      -- ASIGNAR | ACTUALIZAR | CREAR_OTRO | IGNORAR | PONER_VALOR
    @valor NVARCHAR(200) = NULL    -- la categoria, el precio, lo que toque
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    DECLARE @afectadas TABLE (id INT);

    INSERT INTO @afectadas (id)
    SELECT r.id
    FROM dbo.import_rows r
    WHERE r.batch_id = @batch_id AND r.aplicada = 0
      AND EXISTS (SELECT 1 FROM OPENJSON(ISNULL(r.problemas_json,'[]'))
                   WITH (codigo NVARCHAR(40) '$.codigo') j WHERE j.codigo = @codigo);

    IF @resolucion = 'ASIGNAR' AND @codigo = 'SIN_CATEGORIA'
        UPDATE dbo.import_rows SET category_name = @valor
         WHERE id IN (SELECT id FROM @afectadas);

    IF @resolucion = 'PONER_VALOR' AND @codigo = 'SIN_PRECIO'
        UPDATE dbo.import_rows SET price = TRY_CONVERT(DECIMAL(10,2), @valor)
         WHERE id IN (SELECT id FROM @afectadas);

    IF @resolucion = 'ACTUALIZAR'
        UPDATE dbo.import_rows SET accion = 'UPDATE', resolucion = 'ACTUALIZAR'
         WHERE id IN (SELECT id FROM @afectadas) AND match_product_id IS NOT NULL;

    IF @resolucion = 'CREAR_OTRO'
        UPDATE dbo.import_rows SET accion = 'CREATE', resolucion = 'CREAR_OTRO', match_product_id = NULL
         WHERE id IN (SELECT id FROM @afectadas);

    IF @resolucion = 'IGNORAR'
        UPDATE dbo.import_rows SET accion = 'OMITIR', resolucion = 'IGNORAR'
         WHERE id IN (SELECT id FROM @afectadas);

    /* El problema resuelto desaparece de la lista de esa fila. Si era el
       ultimo y la fila tiene lo minimo, vuelve a ser importable. */
    UPDATE r
       SET problemas_json = (
             SELECT j.[value] FROM OPENJSON(ISNULL(r.problemas_json,'[]')) j
              WHERE JSON_VALUE(j.[value], '$.codigo') <> @codigo
              FOR JSON PATH)
      FROM dbo.import_rows r
     WHERE r.id IN (SELECT id FROM @afectadas);

    UPDATE dbo.import_rows
       SET problemas_json = '[]'
     WHERE id IN (SELECT id FROM @afectadas) AND problemas_json IS NULL;

    UPDATE dbo.import_rows
       SET accion = CASE WHEN match_product_id IS NULL THEN 'CREATE' ELSE 'UPDATE' END
     WHERE id IN (SELECT id FROM @afectadas)
       AND accion = 'PENDIENTE'
       AND ISNULL(problemas_json,'[]') IN ('[]','')
       AND nombre IS NOT NULL AND price IS NOT NULL;

    EXEC dbo.sp_import_batch_touch @batch_id = @batch_id;

    SELECT COUNT(*) AS resueltas FROM @afectadas;
END
GO
