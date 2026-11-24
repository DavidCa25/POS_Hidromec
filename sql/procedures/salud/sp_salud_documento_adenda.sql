/* sp_salud_documento_adenda
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* La única forma de corregir o completar un documento firmado: una nota
 * aparte, con su autor y su fecha, que no toca el original.
 */
CREATE OR ALTER PROCEDURE [dbo].[sp_salud_documento_adenda]
    @documento_id INT,
    @texto        NVARCHAR(2000),
    @user_id      INT
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;
    SET @texto = NULLIF(LTRIM(RTRIM(@texto)), N'');
    IF @texto IS NULL BEGIN RAISERROR('Escribe la adenda.', 16, 1); RETURN; END

    DECLARE @estado NVARCHAR(10), @pac INT;
    SELECT @estado = estado, @pac = paciente_id FROM dbo.salud_documentos WHERE id = @documento_id;
    IF @estado IS NULL BEGIN RAISERROR('El documento no existe.', 16, 1); RETURN; END
    IF @estado <> N'FIRMADO' BEGIN RAISERROR('Un borrador se corrige editándolo; la adenda es para documentos firmados.', 16, 1); RETURN; END

    BEGIN TRAN;
    INSERT INTO dbo.salud_adendas (documento_id, texto, autor_id) VALUES (@documento_id, @texto, @user_id);
    DECLARE @id INT = SCOPE_IDENTITY();
    INSERT INTO dbo.salud_bitacora (user_id, paciente_id, documento_id, accion)
    VALUES (@user_id, @pac, @documento_id, N'ADENDA');
    COMMIT;

    SELECT @id AS id;
END
GO
