/* TR_salud_bitacora_append_only
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
CREATE OR ALTER TRIGGER dbo.TR_salud_bitacora_append_only
ON dbo.salud_bitacora
AFTER UPDATE, DELETE
AS
BEGIN
    SET NOCOUNT ON;
    RAISERROR('La bitácora del expediente no se modifica.', 16, 1);
    ROLLBACK TRANSACTION;
END;
GO
