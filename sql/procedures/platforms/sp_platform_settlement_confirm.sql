/* sp_platform_settlement_confirm
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* ================== sp_platform_settlement_confirm (0069) ==================
   Confirma una liquidacion: desde aqui cuenta en el estado de resultados.

   1  REPARTO. El desglose se reparte entre las ventas en proporcion a lo que
      cada una cobro en plataforma, y cae en el dia y el canal de cada venta:
        · las ventas emparejadas con un pedido; si no hay ninguna,
        · las ventas del periodo con canal de esta plataforma; si tampoco,
        · el ultimo dia del periodo, sin venta.
      Cada importe se separa en base y su IVA con la tasa de la liquidacion:
        promociones   -> discount_base / discount_iva   (descuento a la venta)
        reembolsos    -> refund_base / refund_iva       (ajuste a la venta)
        otros ajustes -> refund_base, tal cual         (sin IVA desglosado)
        comision      -> fee_base / fee_iva             (gasto / IVA acreditable)
        ISR + IVA ret -> withheld                       (acreditable, no gasto)
   2  EGRESO. La comision SIN IVA queda como egreso del concepto de
      plataforma, forma de pago OTRO (se desconto del deposito), fechado el
      ultimo dia del periodo y ligado a la liquidacion. Su IVA no es gasto.
   ==================================================================== */
CREATE OR ALTER PROCEDURE dbo.sp_platform_settlement_confirm
    @settlement_id INT,
    @user_id       INT
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;
    DECLARE @estado VARCHAR(10), @platform VARCHAR(12), @desde DATE, @hasta DATE, @rate DECIMAL(5, 4),
            @mkt DECIMAL(14, 2), @fee DECIMAL(14, 2), @ref DECIMAL(14, 2), @otro DECIMAL(14, 2), @ret DECIMAL(14, 2),
            @gross DECIMAL(14, 2);

    IF @user_id IS NULL OR NOT EXISTS (SELECT 1 FROM dbo.users WHERE id = @user_id)
        THROW 51000, 'Sesion no valida.', 1;

    CREATE TABLE #candidatas (sale_id INT PRIMARY KEY, datee DATETIME2(0), dia DATE, amount DECIMAL(14, 2),
        reference NVARCHAR(100) COLLATE DATABASE_DEFAULT, nref NVARCHAR(100) COLLATE DATABASE_DEFAULT, channel_id NVARCHAR(64) COLLATE DATABASE_DEFAULT, channel_name NVARCHAR(120) COLLATE DATABASE_DEFAULT,
        mapped BIT, in_period BIT);
    CREATE TABLE #b (sale_id INT NULL, channel_id NVARCHAR(64) COLLATE DATABASE_DEFAULT NULL, dia DATE NOT NULL, w DECIMAL(14, 2) NOT NULL);

    BEGIN TRAN;
    SELECT @estado = status, @platform = platform, @desde = period_from, @hasta = period_to, @rate = iva_rate,
           @mkt = marketing, @fee = service_fees, @ref = refunds, @otro = other_adjustments,
           @ret = isr_withheld + iva_withheld, @gross = gross_sales
      FROM dbo.platform_settlements WITH (UPDLOCK, HOLDLOCK) WHERE id = @settlement_id;
    IF @estado IS NULL THROW 51000, 'La liquidacion no existe.', 1;
    IF @estado <> 'BORRADOR' THROW 51000, 'Esta liquidacion ya no esta en borrador.', 1;
    IF @hasta > CAST(GETDATE() AS DATE)
        THROW 51000, 'El periodo todavia no termina: confirma la liquidacion cuando cierre.', 1;
    IF @gross = 0 AND @mkt = 0 AND @fee = 0 AND @ref = 0 AND @otro = 0 AND @ret = 0
        THROW 51000, 'Captura el desglose de la plataforma antes de confirmar.', 1;

    EXEC dbo.sp_platform_settlement_candidates @settlement_id = @settlement_id;

    /* Una emparejada que otra liquidacion tomo mientras tanto ya no cuenta. */
    INSERT INTO #b (sale_id, channel_id, dia, w)
    SELECT c.sale_id, c.channel_id, c.dia, c.amount
      FROM dbo.platform_settlement_orders o
      JOIN #candidatas c ON c.sale_id = o.sale_id
     WHERE o.settlement_id = @settlement_id AND o.cancelled = 0;
    IF NOT EXISTS (SELECT 1 FROM #b)
        INSERT INTO #b (sale_id, channel_id, dia, w)
        SELECT sale_id, channel_id, dia, amount FROM #candidatas WHERE mapped = 1 AND in_period = 1;
    IF NOT EXISTS (SELECT 1 FROM #b)
        INSERT INTO #b (sale_id, channel_id, dia, w)
        SELECT NULL, (SELECT TOP (1) channel_id FROM dbo.platform_channels WHERE platform = @platform ORDER BY channel_id), @hasta, 1;

    /* La proporcion va en FLOAT: en DECIMAL, SQL Server recorta la escala de
       cada cociente y con miles de pedidos el reparto dejaba de sumar el
       total. Lo guardado lleva seis decimales; la suma cuadra al centavo. */
    DECLARE @total FLOAT = (SELECT SUM(CAST(w AS FLOAT)) FROM #b);
    DECLARE @k FLOAT = 1 + CAST(@rate AS FLOAT);

    DELETE FROM dbo.platform_settlement_allocations WHERE settlement_id = @settlement_id;
    INSERT INTO dbo.platform_settlement_allocations (settlement_id, sale_id, channel_id, alloc_date,
        discount_base, discount_iva, refund_base, refund_iva, fee_base, fee_iva, withheld)
    SELECT @settlement_id, b.sale_id, b.channel_id, b.dia,
           CAST(@mkt / @k * f.p AS DECIMAL(18, 6)), CAST((@mkt - @mkt / @k) * f.p AS DECIMAL(18, 6)),
           CAST((@ref / @k + @otro) * f.p AS DECIMAL(18, 6)), CAST((@ref - @ref / @k) * f.p AS DECIMAL(18, 6)),
           CAST(@fee / @k * f.p AS DECIMAL(18, 6)), CAST((@fee - @fee / @k) * f.p AS DECIMAL(18, 6)),
           CAST(@ret * f.p AS DECIMAL(18, 6))
      FROM #b b
     CROSS APPLY (SELECT CAST(b.w AS FLOAT) / @total AS p) f;

    /* ----------------------------------------------- el egreso de comision */
    DECLARE @expense_id INT = NULL, @fee_base DECIMAL(12, 2) = ROUND(@fee / @k, 2);
    IF @fee_base > 0
    BEGIN
        DECLARE @cat INT = (SELECT TOP (1) id FROM dbo.expense_categories WHERE kind = 'PLATAFORMA' ORDER BY id);
        IF @cat IS NULL THROW 51000, 'Falta el concepto de egreso de plataforma.', 1;
        DECLARE @nombre NVARCHAR(40) = CASE @platform WHEN 'UBER_EATS' THEN N'Uber Eats' WHEN 'DIDI_FOOD' THEN N'Didi Food' ELSE N'Rappi' END;
        INSERT INTO dbo.expenses (expense_date, category_id, amount, payment_method, note, user_id, beneficiary, platform_settlement_id)
        VALUES (@hasta, @cat, @fee_base, 'OTRO',
                LEFT(N'Liquidacion #' + CAST(@settlement_id AS NVARCHAR(12)) + N' ' + @nombre + N' del '
                     + CONVERT(NVARCHAR(10), @desde, 103) + N' al ' + CONVERT(NVARCHAR(10), @hasta, 103)
                     + N'. Comision sin IVA; el IVA es acreditable.', 255),
                @user_id, @nombre, @settlement_id);
        SET @expense_id = SCOPE_IDENTITY();
    END

    UPDATE dbo.platform_settlements
       SET status = 'CONFIRMADA', confirmed_by = @user_id, confirmed_at = SYSDATETIME(),
           expense_id = @expense_id, updated_at = SYSDATETIME()
     WHERE id = @settlement_id;
    COMMIT TRAN;

    SELECT @settlement_id AS id, @expense_id AS expense_id, (SELECT COUNT(*) FROM #b) AS ventas_repartidas;
END
GO
