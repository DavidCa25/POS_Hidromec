/* sp_import_batch_drop_if_empty
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/**
 * Tira una carga SOLO si esta vacia.
 *
 * Es lo que se llama al salir de la captura. La regla completa:
 *
 *   0 filas  -> se borra. No es trabajo de nadie, y dejarla llenaria el
 *               historial de lineas de cero renglones.
 *   >0 filas -> NO se toca. Son minutos de alguien copiando una libreta;
 *               se queda en el riel para volver cuando quiera.
 *
 * Borrar y no marcar DESCARTADA a proposito: una carga vacia no tiene nada
 * que contar, y el historial es para lo que paso.
 */
CREATE OR ALTER PROCEDURE dbo.sp_import_batch_drop_if_empty
    @batch_id INT
AS
BEGIN
    SET NOCOUNT ON;

    IF EXISTS (SELECT 1 FROM dbo.import_rows WHERE batch_id = @batch_id)
    BEGIN
        SELECT 0 AS borrada, 'tiene filas' AS motivo;
        RETURN;
    END

    IF EXISTS (SELECT 1 FROM dbo.import_batches WHERE id = @batch_id AND estado = 'IMPORTADA')
    BEGIN
        SELECT 0 AS borrada, 'ya se importo' AS motivo;
        RETURN;
    END

    DELETE FROM dbo.import_batches WHERE id = @batch_id;
    SELECT @@ROWCOUNT AS borrada, 'vacia' AS motivo;
END
GO
