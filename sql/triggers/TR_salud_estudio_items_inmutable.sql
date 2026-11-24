/* TR_salud_estudio_items_inmutable
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* LO VALIDADO NO SE TOCA, tampoco por fuera de los procedimientos. */
CREATE OR ALTER TRIGGER dbo.TR_salud_estudio_items_inmutable
ON dbo.salud_estudio_items
AFTER UPDATE, DELETE
AS
BEGIN
    SET NOCOUNT ON;
    IF EXISTS (SELECT 1 FROM deleted WHERE estado = N'VALIDADO')
    BEGIN
        RAISERROR('ESTUDIO_VALIDADO: un resultado validado no cambia. Agrega una nota en el expediente.', 16, 1);
        ROLLBACK TRANSACTION;
        RETURN;
    END
END;
GO
