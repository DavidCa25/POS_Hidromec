/* sp_WA_UpdateConfiguracion
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
CREATE OR ALTER PROCEDURE sp_WA_UpdateConfiguracion
    @Activo BIT,
    @AutoEnviarTicket BIT
AS
BEGIN
    SET NOCOUNT ON;
    UPDATE WA_Configuracion
    SET Activo = @Activo,
        AutoEnviarTicket = @AutoEnviarTicket,
        UpdatedAt = GETDATE();
END;
GO
