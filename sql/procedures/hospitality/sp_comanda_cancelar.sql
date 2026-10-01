/* sp_comanda_cancelar
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* CANCELAR saca lo pedido de la cuenta: sus lineas dejan de cobrarse. Es
   una decision de encargado (lo exige el canal), y queda escrito quien y por
   que. Una comanda entregada ya se sirvio: no se cancela, se cobra. */
CREATE OR ALTER PROCEDURE dbo.sp_comanda_cancelar
    @comanda_id INT,
    @motivo NVARCHAR(200) = NULL,
    @user_id INT = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;
    DECLARE @actual NVARCHAR(12), @cuenta INT;
    SELECT @actual = k.estado, @cuenta = k.cuenta_id FROM dbo.comandas k WHERE k.id = @comanda_id;
    IF @actual IS NULL BEGIN RAISERROR('La comanda no existe.', 16, 1); RETURN; END
    IF @actual = 'CANCELADA' BEGIN SELECT id, estado FROM dbo.comandas WHERE id = @comanda_id; RETURN; END
    IF @actual = 'ENTREGADA' BEGIN RAISERROR('Esta comanda ya se entregó: no se cancela, se cobra.', 16, 1); RETURN; END
    IF NOT EXISTS (SELECT 1 FROM dbo.hosp_cuentas WHERE id = @cuenta AND estado IN ('ABIERTA', 'POR_COBRAR'))
    BEGIN RAISERROR('La cuenta de esta comanda ya está cerrada.', 16, 1); RETURN; END

    BEGIN TRAN;
    UPDATE dbo.comandas
       SET estado = 'CANCELADA', cancelada_en = SYSDATETIME(), cancelada_por = @user_id,
           motivo = NULLIF(LTRIM(RTRIM(@motivo)), '')
     WHERE id = @comanda_id;
    UPDATE dbo.hosp_orden_lineas SET estado = 'CANCELADA' WHERE comanda_id = @comanda_id;
    COMMIT TRAN;

    SELECT id, estado FROM dbo.comandas WHERE id = @comanda_id;
END
GO
