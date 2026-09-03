/* sp_cancel_invoice
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* Marca una factura como cancelada */
CREATE OR ALTER PROCEDURE [dbo].[sp_cancel_invoice]
    @id                  INT,
    @motivo_cancelacion  NVARCHAR(2),
    @folio_sustitucion   NVARCHAR(50) = NULL
AS
BEGIN
    SET NOCOUNT ON;

    IF NOT EXISTS (SELECT 1 FROM dbo.invoices WHERE id = @id AND estado = 'timbrada')
    BEGIN
        RAISERROR('Solo se pueden cancelar facturas timbradas.', 16, 1);
        RETURN;
    END

    UPDATE dbo.invoices
    SET estado = 'cancelada',
        motivo_cancelacion = @motivo_cancelacion,
        folio_sustitucion = @folio_sustitucion,
        fecha_cancelacion = SYSDATETIME()
    WHERE id = @id;

    SELECT id, uuid, estado FROM dbo.invoices WHERE id = @id;
END
GO
