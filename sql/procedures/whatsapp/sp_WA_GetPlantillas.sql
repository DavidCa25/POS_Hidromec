/* sp_WA_GetPlantillas
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
-- ==========================================================
-- PROCEDIMIENTOS PARA PLANTILLAS
-- ==========================================================
CREATE OR ALTER PROCEDURE sp_WA_GetPlantillas
AS
BEGIN
    SET NOCOUNT ON;
    SELECT Id, Nombre, EventoTrigger, Mensaje, EsPorDefecto, Activo, CreatedAt
    FROM WA_Plantillas
    ORDER BY EventoTrigger, Nombre;
END;
GO
