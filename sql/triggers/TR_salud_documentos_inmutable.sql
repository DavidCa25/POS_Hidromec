/* TR_salud_documentos_inmutable
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* LO FIRMADO NO SE TOCA, tampoco por fuera de los procedimientos. */
CREATE OR ALTER TRIGGER dbo.TR_salud_documentos_inmutable
ON dbo.salud_documentos
AFTER UPDATE, DELETE
AS
BEGIN
    SET NOCOUNT ON;
    IF EXISTS (SELECT 1 FROM deleted WHERE estado = N'FIRMADO')
    BEGIN
        RAISERROR('DOCUMENTO_FIRMADO: un documento firmado no se modifica ni se borra; agrega una adenda.', 16, 1);
        ROLLBACK TRANSACTION;
        RETURN;
    END
END;
GO
