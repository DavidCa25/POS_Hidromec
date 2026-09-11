/* sp_WA_AddHistorial
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
CREATE OR ALTER PROCEDURE sp_WA_AddHistorial
    @Telefono VARCHAR(20),
    @MensajeEnviado NVARCHAR(MAX),
    @Estado VARCHAR(20),
    @ErrorLog NVARCHAR(MAX) = NULL,
    @VentaId INT = NULL,
    @PlantillaId INT = NULL
AS
BEGIN
    SET NOCOUNT ON;
    INSERT INTO WA_Historial (Telefono, MensajeEnviado, Estado, ErrorLog, VentaId, PlantillaId, SentAt)
    VALUES (@Telefono, @MensajeEnviado, @Estado, @ErrorLog, @VentaId, @PlantillaId, GETDATE());
END;
GO
