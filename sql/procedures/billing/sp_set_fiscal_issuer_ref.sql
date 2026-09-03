/* sp_set_fiscal_issuer_ref
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* Marcar que los certificados quedaron registrados en el PAC,
   guardando la referencia del emisor. Lo usara la Edge Function. */
CREATE OR ALTER PROCEDURE [dbo].[sp_set_fiscal_issuer_ref]
    @fiscalapi_issuer_id NVARCHAR(100)
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @id INT;
    SELECT TOP(1) @id = id FROM dbo.fiscal_config ORDER BY id ASC;
    IF @id IS NOT NULL
    BEGIN
        UPDATE dbo.fiscal_config
        SET fiscalapi_issuer_id = @fiscalapi_issuer_id,
            csd_registrado = 1,
            updated_at = SYSDATETIME()
        WHERE id = @id;
    END
    SELECT id, fiscalapi_issuer_id, csd_registrado FROM dbo.fiscal_config WHERE id = @id;
END
GO
