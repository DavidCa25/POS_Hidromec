/* sp_import_rows_clear
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* Vacia las filas de una carga para volver a planificar con otro mapeo.
   Solo las NO aplicadas: lo que ya entro al catalogo no se replantea. */
CREATE OR ALTER PROCEDURE dbo.sp_import_rows_clear
    @batch_id INT
AS
BEGIN
    SET NOCOUNT ON;
    DELETE FROM dbo.import_rows WHERE batch_id = @batch_id AND aplicada = 0;
    SELECT @@ROWCOUNT AS borradas;
END
GO
