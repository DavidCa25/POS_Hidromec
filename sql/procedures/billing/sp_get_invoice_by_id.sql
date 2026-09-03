/* sp_get_invoice_by_id
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* Trae una factura por id con todos sus datos (para el detalle). */
CREATE OR ALTER PROCEDURE [dbo].[sp_get_invoice_by_id]
    @id INT
AS
BEGIN
    SET NOCOUNT ON;
    SELECT * FROM dbo.invoices WHERE id = @id;
END
GO
