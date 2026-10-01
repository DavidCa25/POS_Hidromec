/* sp_import_mapping_save
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
CREATE OR ALTER PROCEDURE dbo.sp_import_mapping_save
    @nombre NVARCHAR(120),
    @huella NVARCHAR(200),
    @mapping_json NVARCHAR(MAX),
    @user_id INT = NULL
AS
BEGIN
    SET NOCOUNT ON;
    MERGE dbo.import_mappings AS d
    USING (SELECT @huella AS huella) AS s ON d.huella = s.huella
    WHEN MATCHED THEN UPDATE SET
        nombre = @nombre, mapping_json = @mapping_json,
        veces_usado = veces_usado + 1, last_used_at = SYSDATETIME()
    WHEN NOT MATCHED THEN INSERT (nombre, huella, mapping_json, user_id, veces_usado, last_used_at)
        VALUES (@nombre, @huella, @mapping_json, @user_id, 1, SYSDATETIME());

    SELECT * FROM dbo.import_mappings WHERE huella = @huella;
END
GO
