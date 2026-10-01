/* sp_product_prep_set
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
CREATE OR ALTER PROCEDURE dbo.sp_product_prep_set
    @product_id INT,
    @station_id INT = NULL
AS
BEGIN
    SET NOCOUNT ON;
    IF NOT EXISTS (SELECT 1 FROM dbo.products WHERE id = @product_id AND active = 1)
    BEGIN RAISERROR('El producto no existe.', 16, 1); RETURN; END

    IF @station_id IS NULL
    BEGIN
        DELETE FROM dbo.product_prep_station WHERE product_id = @product_id;
    END
    ELSE
    BEGIN
        IF NOT EXISTS (SELECT 1 FROM dbo.prep_stations WHERE id = @station_id AND activa = 1)
        BEGIN RAISERROR('La estación no existe.', 16, 1); RETURN; END
        MERGE dbo.product_prep_station AS d
        USING (SELECT @product_id AS product_id) AS s ON d.product_id = s.product_id
        WHEN MATCHED THEN UPDATE SET station_id = @station_id, updated_at = SYSDATETIME()
        WHEN NOT MATCHED THEN INSERT (product_id, station_id) VALUES (@product_id, @station_id);
    END
    SELECT @product_id AS product_id, @station_id AS station_id;
END
GO
