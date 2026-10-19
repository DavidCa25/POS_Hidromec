SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* ===================== sp_loyalty_points_config_save (0064) =====================
   Cómo se ganan los puntos. `@per_amount` NULL = no se gana por compra (solo
   por visita, si la hay). Encender sin ninguna de las dos es un error: un
   programa de puntos que no reparte nada confunde a quien lo ve encendido.
   ============================================================================ */
CREATE OR ALTER PROCEDURE dbo.sp_loyalty_points_config_save
    @enabled BIT,
    @per_amount DECIMAL(12,2) = NULL,
    @points_per INT = 1,
    @visit_points INT = 0,
    @expiry_months INT = NULL
AS
BEGIN
    SET NOCOUNT ON;
    IF @per_amount IS NOT NULL AND @per_amount <= 0 SET @per_amount = NULL;
    IF ISNULL(@points_per, 0) < 1 SET @points_per = 1;
    IF ISNULL(@visit_points, 0) < 0 SET @visit_points = 0;
    IF @expiry_months IS NOT NULL AND @expiry_months < 1 SET @expiry_months = NULL;
    IF @enabled = 1 AND @per_amount IS NULL AND @visit_points = 0
        THROW 51000, 'Di cómo se ganan: por cada cierto monto, por visita o ambos.', 1;

    UPDATE dbo.loyalty_points_config
       SET enabled = @enabled, per_amount = @per_amount, points_per = @points_per,
           visit_points = @visit_points, expiry_months = @expiry_months,
           origin = N'LOCAL', updated_at = SYSDATETIME()
     WHERE id = 1;
END;
GO
