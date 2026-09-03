/* sp_WA_DeletePlantilla
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
CREATE OR ALTER PROCEDURE sp_WA_DeletePlantilla
    @Id INT
AS
BEGIN
    SET NOCOUNT ON;
    DELETE FROM WA_Plantillas WHERE Id = @Id;
END;
GO
