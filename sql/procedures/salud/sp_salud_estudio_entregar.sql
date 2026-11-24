/* sp_salud_estudio_entregar
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* El paciente se lleva sus resultados. Solo una orden LISTA (todo validado)
 * se entrega; queda en la bitácora quién la entregó.
 */
CREATE OR ALTER PROCEDURE [dbo].[sp_salud_estudio_entregar]
    @id      INT,
    @user_id INT = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;
    BEGIN TRAN;
    DECLARE @estado NVARCHAR(12), @pac INT;
    SELECT @estado = estado, @pac = paciente_id FROM dbo.salud_estudio_ordenes WITH (UPDLOCK) WHERE id = @id;
    IF @estado IS NULL BEGIN ROLLBACK; RAISERROR('La orden no existe.', 16, 1); RETURN; END
    IF @estado = N'ENTREGADA' BEGIN ROLLBACK; RAISERROR('Esta orden ya se entregó.', 16, 1); RETURN; END
    IF @estado <> N'LISTA' BEGIN ROLLBACK; RAISERROR('Faltan resultados por validar.', 16, 1); RETURN; END

    UPDATE dbo.salud_estudio_ordenes SET estado = N'ENTREGADA', entregado_at = SYSDATETIME(), entregado_por = @user_id WHERE id = @id;
    INSERT INTO dbo.salud_bitacora (user_id, paciente_id, accion) VALUES (@user_id, @pac, N'ENTREGAR');
    COMMIT;
    SELECT id, folio, estado, entregado_at FROM dbo.salud_estudio_ordenes WHERE id = @id;
END
GO
