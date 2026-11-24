/* sp_salud_estudio_orden_vincular
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* Enlaza la orden de estudios con la orden de servicio con la que se cobra.
 * Una sola vez.
 */
CREATE OR ALTER PROCEDURE [dbo].[sp_salud_estudio_orden_vincular]
    @id       INT,
    @orden_id INT
AS
BEGIN
    SET NOCOUNT ON;
    IF NOT EXISTS (SELECT 1 FROM dbo.service_orders WHERE id = @orden_id)
    BEGIN RAISERROR('La orden de servicio no existe.', 16, 1); RETURN; END
    UPDATE dbo.salud_estudio_ordenes SET orden_id = @orden_id WHERE id = @id AND orden_id IS NULL;
    IF @@ROWCOUNT = 0 BEGIN RAISERROR('La orden de estudios no existe o ya tiene cobro.', 16, 1); RETURN; END
    SELECT @id AS id, @orden_id AS orden_id;
END
GO
