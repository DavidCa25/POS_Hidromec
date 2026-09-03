/* sp_save_fiscal_config
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* Guardar (upsert) la configuracion del emisor.
   Como es un solo emisor, mantiene un unico renglon. */
CREATE OR ALTER PROCEDURE [dbo].[sp_save_fiscal_config]
    @rfc            NVARCHAR(13),
    @razon_social   NVARCHAR(255),
    @regimen_fiscal NVARCHAR(5),
    @codigo_postal  NVARCHAR(5),
    @serie          NVARCHAR(25) = NULL
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @id INT;
    SELECT TOP(1) @id = id FROM dbo.fiscal_config ORDER BY id ASC;

    IF @id IS NULL
    BEGIN
        INSERT INTO dbo.fiscal_config (rfc, razon_social, regimen_fiscal, codigo_postal, serie)
        VALUES (@rfc, @razon_social, @regimen_fiscal, @codigo_postal, @serie);
        SET @id = SCOPE_IDENTITY();
    END
    ELSE
    BEGIN
        UPDATE dbo.fiscal_config
        SET rfc = @rfc,
            razon_social = @razon_social,
            regimen_fiscal = @regimen_fiscal,
            codigo_postal = @codigo_postal,
            serie = @serie,
            updated_at = SYSDATETIME()
        WHERE id = @id;
    END

    SELECT id, rfc, razon_social, regimen_fiscal, codigo_postal, serie,
           fiscalapi_issuer_id, csd_registrado, activo
    FROM dbo.fiscal_config WHERE id = @id;
END
GO
