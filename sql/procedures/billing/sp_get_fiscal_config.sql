/* sp_get_fiscal_config
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* Leer la configuracion del emisor (si existe). */
CREATE OR ALTER PROCEDURE [dbo].[sp_get_fiscal_config]
AS
BEGIN
    SET NOCOUNT ON;
    SELECT TOP(1)
        id, rfc, razon_social, regimen_fiscal, codigo_postal, serie,
        fiscalapi_issuer_id, csd_registrado, activo
    FROM dbo.fiscal_config
    ORDER BY id ASC;
END
GO
