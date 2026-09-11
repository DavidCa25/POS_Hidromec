/* sp_get_invoice_files_data
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* Devuelve el id del PAC, uuid, xml guardado y datos basicos
   para descargar/mostrar los archivos de una factura. */
CREATE OR ALTER PROCEDURE [dbo].[sp_get_invoice_files_data]
    @id INT
AS
BEGIN
    SET NOCOUNT ON;
    SELECT
        id,
        uuid,
        serie,
        folio,
        fiscalapi_invoice_id,
        xml_content,
        receptor_razon_social,
        estado
    FROM dbo.invoices
    WHERE id = @id;
END
GO
