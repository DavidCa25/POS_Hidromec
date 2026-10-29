/* sp_platform_settlement_void
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* =================== sp_platform_settlement_void (0069) ===================
   Cancela una liquidacion (borrador o confirmada). No borra: queda quien,
   cuando y por que; su reparto deja de contar y su egreso de comision se
   cancela con el mismo motivo. Sus ventas quedan libres para otra.
   ==================================================================== */
CREATE OR ALTER PROCEDURE dbo.sp_platform_settlement_void
    @settlement_id INT,
    @user_id       INT,
    @reason        NVARCHAR(200)
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;
    SET @reason = NULLIF(LTRIM(RTRIM(@reason)), N'');
    IF @reason IS NULL THROW 51000, 'Escribe por que se cancela la liquidacion.', 1;
    IF @user_id IS NULL OR NOT EXISTS (SELECT 1 FROM dbo.users WHERE id = @user_id)
        THROW 51000, 'Sesion no valida.', 1;

    BEGIN TRAN;
    DECLARE @estado VARCHAR(10), @expense INT;
    SELECT @estado = status, @expense = expense_id
      FROM dbo.platform_settlements WITH (UPDLOCK, HOLDLOCK) WHERE id = @settlement_id;
    IF @estado IS NULL THROW 51000, 'La liquidacion no existe.', 1;
    IF @estado = 'CANCELADA' THROW 51000, 'Esa liquidacion ya estaba cancelada.', 1;

    UPDATE dbo.expenses
       SET voided_at = SYSDATETIME(), voided_by = @user_id,
           void_reason = LEFT(N'Liquidacion cancelada: ' + @reason, 200)
     WHERE platform_settlement_id = @settlement_id AND voided_at IS NULL;
    UPDATE dbo.platform_settlements
       SET status = 'CANCELADA', voided_by = @user_id, voided_at = SYSDATETIME(), void_reason = @reason,
           updated_at = SYSDATETIME()
     WHERE id = @settlement_id;
    COMMIT TRAN;
    SELECT @settlement_id AS id, @expense AS expense_id;
END
GO
