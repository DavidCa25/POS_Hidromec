/* sp_customer_asset_set_active
 * Definicion canonica. Modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* Retira un activo de las listas, o lo devuelve.
 *
 * El cliente vendio el coche. No se borra: las ordenes de servicio que se le
 * hicieron siguen siendo suyas y siguen teniendo que poder consultarse.
 */
CREATE OR ALTER PROCEDURE dbo.sp_customer_asset_set_active
    @id     INT,
    @active BIT
AS
BEGIN
    SET NOCOUNT ON;

    UPDATE dbo.customer_assets
       SET active = @active, updated_at = SYSDATETIME()
     WHERE id = @id;

    IF @@ROWCOUNT = 0
    BEGIN
        RAISERROR('Ese registro ya no existe.', 16, 1);
        RETURN;
    END

    SELECT @id AS id, @active AS active;
END
GO
