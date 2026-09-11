/* sp_log_security_event
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* 2) Registrar un evento de seguridad */
CREATE OR ALTER PROCEDURE dbo.sp_log_security_event
    @user_id INT = NULL, @authorized_by INT = NULL, @register_id INT = NULL,
    @event_type NVARCHAR(40), @amount DECIMAL(18,2) = NULL,
    @detail NVARCHAR(400) = NULL, @sale_id INT = NULL
AS
BEGIN
    SET NOCOUNT ON;
    INSERT INTO dbo.security_events (user_id, authorized_by, register_id, event_type, amount, detail, sale_id)
    VALUES (@user_id, @authorized_by, @register_id, @event_type, @amount, @detail, @sale_id);
    SELECT SCOPE_IDENTITY() AS id;
END
GO
