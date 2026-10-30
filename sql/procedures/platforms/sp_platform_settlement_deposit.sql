/* sp_platform_settlement_deposit
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* ================== sp_platform_settlement_deposit (0069) ==================
   Registra (o corrige) el deposito que de verdad llego de la plataforma.
   Es el cobro de lo que la plataforma debia: no es venta ni ingreso nuevo,
   asi que no toca resultados. @amount = NULL lo quita (aun no llega).
   ==================================================================== */
CREATE OR ALTER PROCEDURE dbo.sp_platform_settlement_deposit
    @settlement_id INT,
    @amount        DECIMAL(14, 2) = NULL,
    @deposit_date  DATE = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;
    DECLARE @estado VARCHAR(10) = (SELECT status FROM dbo.platform_settlements WHERE id = @settlement_id);
    IF @estado IS NULL THROW 51000, 'La liquidacion no existe.', 1;
    IF @estado = 'CANCELADA' THROW 51000, 'La liquidacion esta cancelada.', 1;
    IF @amount IS NOT NULL AND @deposit_date IS NULL SET @deposit_date = CAST(GETDATE() AS DATE);
    IF @deposit_date > CAST(GETDATE() AS DATE) THROW 51000, 'La fecha del deposito no puede ser futura.', 1;

    UPDATE dbo.platform_settlements
       SET deposit_real = @amount, deposit_date = CASE WHEN @amount IS NULL THEN NULL ELSE @deposit_date END,
           updated_at = SYSDATETIME()
     WHERE id = @settlement_id;
    SELECT id, deposit_expected, deposit_real, deposit_date,
           CAST(deposit_real - deposit_expected AS DECIMAL(14, 2)) AS deposit_difference
      FROM dbo.platform_settlements WHERE id = @settlement_id;
END
GO
