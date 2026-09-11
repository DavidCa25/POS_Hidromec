/* sp_WA_GetHistorial
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
-- ==========================================================
-- PROCEDIMIENTOS PARA EL HISTORIAL
-- ==========================================================
CREATE OR ALTER PROCEDURE sp_WA_GetHistorial
AS
BEGIN
    SET NOCOUNT ON;
    -- Traemos los últimos 100 para no saturar la memoria del Dashboard
    SELECT TOP 100 Id, Telefono, MensajeEnviado, Estado, ErrorLog, VentaId, SentAt
    FROM WA_Historial
    ORDER BY SentAt DESC;
END;
GO
