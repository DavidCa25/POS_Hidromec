/* sp_save_invoice
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
CREATE OR ALTER PROCEDURE [dbo].[sp_save_invoice]
    @sale_id                INT = NULL,
    @tipo                   NVARCHAR(2) = 'I',
    @serie                  NVARCHAR(25) = NULL,
    @folio                  NVARCHAR(40) = NULL,
    @uuid                   NVARCHAR(50) = NULL,
    @receptor_rfc           NVARCHAR(13),
    @receptor_razon_social  NVARCHAR(255),
    @receptor_regimen       NVARCHAR(5),
    @receptor_uso_cfdi      NVARCHAR(5),
    @receptor_codigo_postal NVARCHAR(5),
    @receptor_email         NVARCHAR(255) = NULL,
    @metodo_pago            NVARCHAR(3) = 'PUE',
    @forma_pago             NVARCHAR(3) = '01',
    @subtotal               DECIMAL(12,2) = 0,
    @descuento              DECIMAL(12,2) = 0,
    @iva                    DECIMAL(12,2) = 0,
    @total                  DECIMAL(12,2) = 0,
    @estado                 NVARCHAR(20) = 'timbrada',
    @fiscalapi_invoice_id   NVARCHAR(100) = NULL,
    @xml_content            NVARCHAR(MAX) = NULL,
    @error_mensaje          NVARCHAR(MAX) = NULL
AS
BEGIN
    SET NOCOUNT ON;

    INSERT INTO dbo.invoices (
        sale_id, tipo, serie, folio, uuid,
        receptor_rfc, receptor_razon_social, receptor_regimen,
        receptor_uso_cfdi, receptor_codigo_postal, receptor_email,
        metodo_pago, forma_pago,
        subtotal, descuento, iva, total,
        estado, fiscalapi_invoice_id, xml_content, error_mensaje,
        fecha_timbrado
    )
    VALUES (
        @sale_id, @tipo, @serie, @folio, @uuid,
        @receptor_rfc, @receptor_razon_social, @receptor_regimen,
        @receptor_uso_cfdi, @receptor_codigo_postal, @receptor_email,
        @metodo_pago, @forma_pago,
        @subtotal, @descuento, @iva, @total,
        @estado, @fiscalapi_invoice_id, @xml_content, @error_mensaje,
        CASE WHEN @estado = 'timbrada' THEN SYSDATETIME() ELSE NULL END
    );

    SELECT SCOPE_IDENTITY() AS id;
END
GO
