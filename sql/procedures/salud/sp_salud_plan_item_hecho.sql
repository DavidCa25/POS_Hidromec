/* sp_salud_plan_item_hecho
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* Marca un procedimiento como hecho (o lo desmarca). Cuando todos están
 * hechos, el plan se termina solo: nadie tiene que acordarse de cerrarlo.
 */
CREATE OR ALTER PROCEDURE [dbo].[sp_salud_plan_item_hecho]
    @item_id INT,
    @hecho   BIT,
    @user_id INT = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    BEGIN TRAN;
    DECLARE @plan INT, @estado NVARCHAR(12), @pac INT;
    SELECT @plan = i.plan_id, @estado = pl.estado, @pac = pl.paciente_id
      FROM dbo.salud_plan_items i WITH (UPDLOCK)
      JOIN dbo.salud_planes pl WITH (UPDLOCK) ON pl.id = i.plan_id
     WHERE i.id = @item_id;
    IF @plan IS NULL BEGIN ROLLBACK; RAISERROR('El procedimiento no existe.', 16, 1); RETURN; END
    IF @estado NOT IN (N'ACEPTADO', N'TERMINADO')
    BEGIN ROLLBACK; RAISERROR('Solo se avanza un plan aceptado.', 16, 1); RETURN; END

    UPDATE dbo.salud_plan_items
       SET estado = CASE WHEN @hecho = 1 THEN N'HECHO' ELSE N'PENDIENTE' END,
           hecho_at = CASE WHEN @hecho = 1 THEN SYSDATETIME() END
     WHERE id = @item_id;

    UPDATE dbo.salud_planes
       SET estado = CASE WHEN NOT EXISTS (SELECT 1 FROM dbo.salud_plan_items WHERE plan_id = @plan AND estado = N'PENDIENTE')
                         THEN N'TERMINADO' ELSE N'ACEPTADO' END
     WHERE id = @plan;

    INSERT INTO dbo.salud_bitacora (user_id, paciente_id, accion) VALUES (@user_id, @pac, N'PLAN');
    COMMIT;

    SELECT pl.id AS plan_id, pl.estado FROM dbo.salud_planes pl WHERE pl.id = @plan;
END
GO
