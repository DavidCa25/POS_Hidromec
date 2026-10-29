/* sp_pedido_en_linea_rechazar
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* 0067 · RECHAZAR un pedido en linea, con motivo (el cliente lo ve).
   Solo un pedido PENDIENTE; uno aceptado se cancela como cualquier cuenta. */
CREATE OR ALTER PROCEDURE dbo.sp_pedido_en_linea_rechazar
    @id INT,
    @motivo NVARCHAR(200),
    @user_id INT = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET @motivo = NULLIF(LTRIM(RTRIM(@motivo)), '');
    IF @motivo IS NULL BEGIN RAISERROR('Escribe el motivo: el cliente lo va a ver.', 16, 1); RETURN; END
    UPDATE dbo.pedidos_en_linea
       SET estado = 'RECHAZADO', motivo = @motivo, decidido_en = SYSDATETIME(), decidido_por = @user_id
     WHERE id = @id AND estado = 'PENDIENTE';
    IF @@ROWCOUNT = 0
    BEGIN
        IF NOT EXISTS (SELECT 1 FROM dbo.pedidos_en_linea WHERE id = @id)
        BEGIN RAISERROR('El pedido no existe.', 16, 1); RETURN; END
        RAISERROR('Este pedido ya se aceptó o se rechazó.', 16, 1); RETURN;
    END
    SELECT id, estado, motivo FROM dbo.pedidos_en_linea WHERE id = @id;
END
GO
