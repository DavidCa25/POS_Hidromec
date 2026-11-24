/* sp_salud_cie10_buscar
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* Diagnósticos CIE-10 por código o por texto. Primero los que empiezan por
 * lo escrito, después los que lo contienen.
 */
CREATE OR ALTER PROCEDURE [dbo].[sp_salud_cie10_buscar]
    @buscar NVARCHAR(100),
    @top    INT = 20
AS
BEGIN
    SET NOCOUNT ON;
    SET @buscar = NULLIF(LTRIM(RTRIM(@buscar)), N'');
    IF @buscar IS NULL RETURN;
    IF @top IS NULL OR @top NOT BETWEEN 1 AND 100 SET @top = 20;

    SELECT TOP (@top) codigo, descripcion
      FROM dbo.salud_cie10
     WHERE codigo LIKE @buscar + N'%' OR descripcion LIKE N'%' + @buscar + N'%'
     ORDER BY CASE WHEN codigo LIKE @buscar + N'%' THEN 0
                   WHEN descripcion LIKE @buscar + N'%' THEN 1 ELSE 2 END,
              codigo;
END
GO
