/* sp_rendimiento_ajustar
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* 0095 · CAMBIA CUÁNTOS TACOS RINDE UN KILO DE UNA CARNE.

   Lo usa «Ajustar a 13.5» cuando la carne lleva días rindiendo distinto. Los
   conteos ya hechos conservan el número con el que se contaron; los platillos
   que se venden por kilo se recalculan con el nuevo. */
CREATE OR ALTER PROCEDURE dbo.sp_rendimiento_ajustar
    @carne_id INT,
    @rinde DECIMAL(6, 2)
AS
BEGIN
    SET NOCOUNT ON;
    IF @rinde IS NULL OR @rinde < 1 OR @rinde > 60 THROW 51000, 'Los tacos por kilo van de 1 a 60.', 1;
    IF NOT EXISTS (SELECT 1 FROM dbo.rendimiento_carnes WHERE product_id = @carne_id)
        THROW 51000, 'Esa carne no se lleva por rendimiento.', 1;

    UPDATE dbo.rendimiento_carnes SET rinde = @rinde, actualizado = SYSDATETIME() WHERE product_id = @carne_id;
    EXEC dbo.sp_rendimiento_mapear;

    SELECT product_id AS carne_id, rinde FROM dbo.rendimiento_carnes WHERE product_id = @carne_id;
END;
GO
