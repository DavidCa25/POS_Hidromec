/* sp_WA_GetConfiguracion
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
-- ==========================================================
-- PROCEDIMIENTOS PARA LA CONFIGURACIÓN GENERAL
-- ==========================================================
CREATE OR ALTER PROCEDURE sp_WA_GetConfiguracion
AS
BEGIN
    SET NOCOUNT ON;
    SELECT TOP 1 Id, SucursalId, Activo, AutoEnviarTicket, UpdatedAt
    FROM WA_Configuracion
    ORDER BY Id ASC;
END;
GO
