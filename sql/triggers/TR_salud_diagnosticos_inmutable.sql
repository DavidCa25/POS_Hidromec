/* TR_salud_diagnosticos_inmutable
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* Los diagnósticos son parte del documento: firmado, tampoco cambian. */
CREATE OR ALTER TRIGGER dbo.TR_salud_diagnosticos_inmutable
ON dbo.salud_diagnosticos
AFTER INSERT, UPDATE, DELETE
AS
BEGIN
    SET NOCOUNT ON;
    IF EXISTS (SELECT 1 FROM inserted i JOIN dbo.salud_documentos d ON d.id = i.documento_id WHERE d.estado = N'FIRMADO')
       OR EXISTS (SELECT 1 FROM deleted x JOIN dbo.salud_documentos d ON d.id = x.documento_id WHERE d.estado = N'FIRMADO')
    BEGIN
        RAISERROR('DOCUMENTO_FIRMADO: los diagnósticos de un documento firmado no cambian.', 16, 1);
        ROLLBACK TRANSACTION;
        RETURN;
    END
END;
GO
