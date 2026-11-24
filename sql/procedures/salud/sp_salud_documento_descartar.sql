/* sp_salud_documento_descartar
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* Borra un BORRADOR que su autor ya no quiere. Lo firmado no se borra nunca
 * (y el trigger de la tabla lo impide aunque se intente por fuera).
 */
CREATE OR ALTER PROCEDURE [dbo].[sp_salud_documento_descartar]
    @id      INT,
    @user_id INT
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    BEGIN TRAN;
    DECLARE @estado NVARCHAR(10), @autor INT, @pac INT;
    SELECT @estado = estado, @autor = autor_id, @pac = paciente_id
      FROM dbo.salud_documentos WITH (UPDLOCK) WHERE id = @id;
    IF @estado IS NULL BEGIN ROLLBACK; RAISERROR('El documento no existe.', 16, 1); RETURN; END
    IF @estado = N'FIRMADO' BEGIN ROLLBACK; RAISERROR('DOCUMENTO_FIRMADO: un documento firmado no se borra.', 16, 1); RETURN; END
    IF @autor <> @user_id BEGIN ROLLBACK; RAISERROR('Solo quien escribió el borrador puede descartarlo.', 16, 1); RETURN; END

    DELETE FROM dbo.salud_documentos WHERE id = @id;
    INSERT INTO dbo.salud_bitacora (user_id, paciente_id, documento_id, accion)
    VALUES (@user_id, @pac, NULL, N'DESCARTAR');
    COMMIT;

    SELECT @id AS id;
END
GO
