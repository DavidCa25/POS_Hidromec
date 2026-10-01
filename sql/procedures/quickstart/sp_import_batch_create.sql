/* sp_import_batch_create
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* Nace segun de donde viene: un archivo se analiza, una libreta se captura. */
CREATE OR ALTER PROCEDURE dbo.sp_import_batch_create
    @origen NVARCHAR(12),
    @etiqueta NVARCHAR(200),
    @preset NVARCHAR(40) = NULL,
    @business_profile NVARCHAR(20) = NULL,
    @user_id INT = NULL,
    @metadata_json NVARCHAR(MAX) = NULL
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @estado NVARCHAR(12) =
        CASE WHEN @origen IN ('MANUAL','LECTOR') THEN 'CAPTURANDO' ELSE 'ANALIZANDO' END;

    INSERT INTO dbo.import_batches (origen, etiqueta, preset, business_profile, user_id, metadata_json, estado)
    VALUES (@origen, LEFT(LTRIM(RTRIM(@etiqueta)), 200), @preset, @business_profile, @user_id, @metadata_json, @estado);

    DECLARE @id INT = SCOPE_IDENTITY();
    SELECT * FROM dbo.import_batches WHERE id = @id;
END
GO
