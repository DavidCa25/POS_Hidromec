/* sp_get_product_thumbs
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
-- Miniaturas para la cache local de una caja. @ids_json: '[1,5,9]' con los
-- productos cuya version local no coincide; NULL devuelve todas.
CREATE OR ALTER PROCEDURE dbo.sp_get_product_thumbs
    @ids_json NVARCHAR(MAX) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    IF @ids_json IS NOT NULL AND ISJSON(@ids_json) = 0
    BEGIN RAISERROR('ids_json debe ser un arreglo JSON.', 16, 1); RETURN; END

    SELECT i.product_id, i.version, i.mime, i.width, i.height, i.thumb
    FROM dbo.product_images i
    WHERE @ids_json IS NULL
       OR i.product_id IN (SELECT CAST([value] AS INT) FROM OPENJSON(@ids_json));
END
GO
