/* sp_salud_estudio_estado
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* Marca un estudio como TOMADO (la muestra o la placa ya se hizo) o lo
 * CANCELA. Lo validado no se cancela. Si al cancelar los que quedan ya están
 * todos validados, la orden queda LISTA; si se cancelan todos, CANCELADA.
 */
CREATE OR ALTER PROCEDURE [dbo].[sp_salud_estudio_estado]
    @item_id INT,
    @estado  NVARCHAR(12),
    @user_id INT = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;
    SET @estado = UPPER(LTRIM(RTRIM(ISNULL(@estado, N''))));
    IF @estado NOT IN (N'TOMADO', N'CANCELADO') BEGIN RAISERROR('Estado no válido.', 16, 1); RETURN; END

    BEGIN TRAN;
    DECLARE @actual NVARCHAR(12), @orden INT;
    SELECT @actual = estado, @orden = orden_id FROM dbo.salud_estudio_items WITH (UPDLOCK) WHERE id = @item_id;
    IF @actual IS NULL BEGIN ROLLBACK; RAISERROR('El estudio no existe.', 16, 1); RETURN; END
    IF @actual IN (N'VALIDADO', N'CANCELADO')
    BEGIN ROLLBACK; RAISERROR('ESTUDIO_VALIDADO: este estudio ya está cerrado.', 16, 1); RETURN; END
    IF @estado = N'TOMADO' AND @actual <> N'SOLICITADO'
    BEGIN ROLLBACK; RAISERROR('Este estudio ya se tomó.', 16, 1); RETURN; END
    IF EXISTS (SELECT 1 FROM dbo.salud_estudio_ordenes WHERE id = @orden AND estado IN (N'ENTREGADA', N'CANCELADA'))
    BEGIN ROLLBACK; RAISERROR('La orden ya está cerrada.', 16, 1); RETURN; END

    UPDATE dbo.salud_estudio_items
       SET estado = @estado,
           tomado_at = CASE WHEN @estado = N'TOMADO' THEN SYSDATETIME() ELSE tomado_at END,
           tomado_por = CASE WHEN @estado = N'TOMADO' THEN @user_id ELSE tomado_por END
     WHERE id = @item_id;

    IF @estado = N'CANCELADO'
        UPDATE o SET estado = CASE
                WHEN NOT EXISTS (SELECT 1 FROM dbo.salud_estudio_items i WHERE i.orden_id = o.id AND i.estado <> N'CANCELADO') THEN N'CANCELADA'
                WHEN NOT EXISTS (SELECT 1 FROM dbo.salud_estudio_items i WHERE i.orden_id = o.id AND i.estado NOT IN (N'VALIDADO', N'CANCELADO')) THEN N'LISTA'
                ELSE o.estado END
          FROM dbo.salud_estudio_ordenes o WHERE o.id = @orden;
    COMMIT;

    SELECT i.id, i.estado, o.estado AS orden_estado
      FROM dbo.salud_estudio_items i JOIN dbo.salud_estudio_ordenes o ON o.id = i.orden_id
     WHERE i.id = @item_id;
END
GO
