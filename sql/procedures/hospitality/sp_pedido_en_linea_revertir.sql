/* sp_pedido_en_linea_revertir
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* 0067 · Deshacer una aceptacion que NO llego a cocina (fallo al enviar la
   orden): si la cuenta no tiene ninguna linea, se cancela y el pedido vuelve
   a PENDIENTE. Con lineas ya enviadas no se toca nada: se reintenta aceptar. */
CREATE OR ALTER PROCEDURE dbo.sp_pedido_en_linea_revertir
    @id INT,
    @user_id INT = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;
    DECLARE @cuenta INT;
    BEGIN TRAN;
    SELECT @cuenta = cuenta_id FROM dbo.pedidos_en_linea WITH (UPDLOCK, HOLDLOCK) WHERE id = @id AND estado = 'ACEPTADO';
    IF @cuenta IS NOT NULL AND NOT EXISTS (SELECT 1 FROM dbo.hosp_orden_lineas WHERE cuenta_id = @cuenta)
    BEGIN
        UPDATE dbo.pedidos_en_linea SET estado = 'PENDIENTE', cuenta_id = NULL, decidido_en = NULL, decidido_por = NULL WHERE id = @id;
        UPDATE dbo.hosp_cuentas SET estado = 'CANCELADA', cerrada_en = SYSDATETIME(), cerrada_por = @user_id WHERE id = @cuenta;
        COMMIT TRAN;
        SELECT CAST(1 AS BIT) AS revertido;
        RETURN;
    END
    COMMIT TRAN;
    SELECT CAST(0 AS BIT) AS revertido;
END
GO
