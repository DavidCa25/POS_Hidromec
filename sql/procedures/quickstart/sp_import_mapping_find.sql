/* sp_import_mapping_find
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* ------------------------------------------------------- los perfiles */
CREATE OR ALTER PROCEDURE dbo.sp_import_mapping_find
    @huella NVARCHAR(200)
AS
BEGIN
    SET NOCOUNT ON;
    SELECT TOP 1 * FROM dbo.import_mappings WHERE huella = @huella;
END
GO
