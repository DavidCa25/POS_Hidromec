/* sp_salud_plan_estado
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* Mueve un plan: ACEPTADO (con la orden de servicio que lo cobra),
 * CANCELADO o TERMINADO. Las transiciones válidas viven aquí:
 *   PROPUESTO -> ACEPTADO | CANCELADO
 *   ACEPTADO  -> TERMINADO | CANCELADO
 */
CREATE OR ALTER PROCEDURE [dbo].[sp_salud_plan_estado]
    @id       INT,
    @estado   NVARCHAR(12),
    @orden_id INT = NULL,
    @user_id  INT = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;
    SET @estado = UPPER(LTRIM(RTRIM(ISNULL(@estado, N''))));

    BEGIN TRAN;
    DECLARE @actual NVARCHAR(12), @pac INT;
    SELECT @actual = estado, @pac = paciente_id FROM dbo.salud_planes WITH (UPDLOCK) WHERE id = @id;
    IF @actual IS NULL BEGIN ROLLBACK; RAISERROR('El plan no existe.', 16, 1); RETURN; END

    IF NOT ((@actual = N'PROPUESTO' AND @estado IN (N'ACEPTADO', N'CANCELADO'))
         OR (@actual = N'ACEPTADO' AND @estado IN (N'TERMINADO', N'CANCELADO')))
    BEGIN
        ROLLBACK;
        DECLARE @msg NVARCHAR(200) = CONCAT(N'Un plan ', LOWER(@actual), N' no puede pasar a ', LOWER(@estado), N'.');
        RAISERROR(@msg, 16, 1);
        RETURN;
    END
    IF @estado = N'ACEPTADO' AND @orden_id IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM dbo.service_orders WHERE id = @orden_id AND customer_id = @pac)
    BEGIN ROLLBACK; RAISERROR('La orden de servicio no es de este paciente.', 16, 1); RETURN; END

    UPDATE dbo.salud_planes
       SET estado = @estado,
           orden_id = CASE WHEN @estado = N'ACEPTADO' THEN @orden_id ELSE orden_id END,
           aceptado_at = CASE WHEN @estado = N'ACEPTADO' THEN SYSDATETIME() ELSE aceptado_at END
     WHERE id = @id;

    INSERT INTO dbo.salud_bitacora (user_id, paciente_id, accion) VALUES (@user_id, @pac, N'PLAN');
    COMMIT;

    SELECT id, estado, orden_id, aceptado_at FROM dbo.salud_planes WHERE id = @id;
END
GO
