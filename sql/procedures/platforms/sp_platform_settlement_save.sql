/* sp_platform_settlement_save
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* =================== sp_platform_settlement_save (0069) ===================
   Crea o cambia una liquidacion en BORRADOR y vuelve a emparejar.

   Importes con IVA, tal como los ensena la plataforma, y en positivo (lo que
   descuenta). @other_adjustments lleva signo: negativo si la plataforma pago
   de mas. El deposito esperado lo calcula la tabla.

   @orders_json (opcional) reemplaza TODOS los pedidos. Un arreglo de
     { "id", "at", "customer", "fulfillment", "status",
       "base", "tax", "total", "net", "cancelled" }
   donde total = lo que pago el cliente con IVA. Si falta, total = base + tax.
   Sin @orders_json los pedidos se quedan como estaban.
   ==================================================================== */
CREATE OR ALTER PROCEDURE dbo.sp_platform_settlement_save
    @id                INT = NULL,
    @user_id           INT,
    @platform          VARCHAR(12),
    @period_from       DATE,
    @period_to         DATE,
    @source_file       NVARCHAR(200) = NULL,
    @gross_sales       DECIMAL(14, 2) = 0,
    @marketing         DECIMAL(14, 2) = 0,
    @service_fees      DECIMAL(14, 2) = 0,
    @refunds           DECIMAL(14, 2) = 0,
    @isr_withheld      DECIMAL(14, 2) = 0,
    @iva_withheld      DECIMAL(14, 2) = 0,
    @other_adjustments DECIMAL(14, 2) = 0,
    @iva_rate          DECIMAL(5, 4) = 0.16,
    @deposit_real      DECIMAL(14, 2) = NULL,
    @deposit_date      DATE = NULL,
    @note              NVARCHAR(255) = NULL,
    @orders_json       NVARCHAR(MAX) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;
    SET @platform = UPPER(LTRIM(RTRIM(ISNULL(@platform, ''))));
    SET @note = NULLIF(LTRIM(RTRIM(@note)), N'');
    SET @source_file = NULLIF(LTRIM(RTRIM(@source_file)), N'');

    IF @user_id IS NULL OR NOT EXISTS (SELECT 1 FROM dbo.users WHERE id = @user_id)
        THROW 51000, 'Sesion no valida.', 1;
    IF @platform NOT IN ('UBER_EATS', 'DIDI_FOOD', 'RAPPI')
        THROW 51000, 'Elige la plataforma.', 1;
    IF @period_from IS NULL OR @period_to IS NULL OR @period_from > @period_to
        THROW 51000, 'Indica un periodo valido.', 1;
    IF DATEDIFF(DAY, @period_from, @period_to) > 366
        THROW 51000, 'El periodo maximo de una liquidacion es de un ano.', 1;
    IF ISNULL(@gross_sales, 0) < 0 OR ISNULL(@marketing, 0) < 0 OR ISNULL(@service_fees, 0) < 0
       OR ISNULL(@refunds, 0) < 0 OR ISNULL(@isr_withheld, 0) < 0 OR ISNULL(@iva_withheld, 0) < 0
        THROW 51000, 'Captura los descuentos en positivo: lo que la plataforma desconto.', 1;
    IF @iva_rate IS NULL OR @iva_rate < 0 OR @iva_rate >= 1
        THROW 51000, 'Tasa de IVA no valida.', 1;
    IF @deposit_real IS NOT NULL AND @deposit_date IS NULL SET @deposit_date = @period_to;
    IF @deposit_real IS NULL SET @deposit_date = NULL;

    /* --------------------------------------------- pedidos del archivo */
    CREATE TABLE #o (line_no INT NOT NULL, platform_order_id NVARCHAR(100) COLLATE DATABASE_DEFAULT, order_at DATETIME2(0),
        customer NVARCHAR(120) COLLATE DATABASE_DEFAULT, fulfillment NVARCHAR(40) COLLATE DATABASE_DEFAULT, platform_status NVARCHAR(40) COLLATE DATABASE_DEFAULT,
        sales_base DECIMAL(14, 2), tax DECIMAL(14, 2), sales_total DECIMAL(14, 2), net_amount DECIMAL(14, 2), cancelled BIT);
    IF @orders_json IS NOT NULL
    BEGIN
        IF ISJSON(@orders_json) <> 1 OR LEFT(LTRIM(@orders_json), 1) <> '['
            THROW 51000, 'El archivo de pedidos no es valido.', 1;
        INSERT INTO #o
        SELECT CAST(j.[key] AS INT) + 1,
               NULLIF(LTRIM(RTRIM(LEFT(JSON_VALUE(j.value, '$.id'), 100))), N''),
               TRY_CONVERT(DATETIME2(0), JSON_VALUE(j.value, '$.at'), 126),
               NULLIF(LEFT(JSON_VALUE(j.value, '$.customer'), 120), N''),
               NULLIF(LEFT(JSON_VALUE(j.value, '$.fulfillment'), 40), N''),
               NULLIF(LEFT(JSON_VALUE(j.value, '$.status'), 40), N''),
               TRY_CONVERT(DECIMAL(14, 2), JSON_VALUE(j.value, '$.base')),
               TRY_CONVERT(DECIMAL(14, 2), JSON_VALUE(j.value, '$.tax')),
               COALESCE(TRY_CONVERT(DECIMAL(14, 2), JSON_VALUE(j.value, '$.total')),
                        TRY_CONVERT(DECIMAL(14, 2), JSON_VALUE(j.value, '$.base')) + ISNULL(TRY_CONVERT(DECIMAL(14, 2), JSON_VALUE(j.value, '$.tax')), 0)),
               TRY_CONVERT(DECIMAL(14, 2), JSON_VALUE(j.value, '$.net')),
               CASE WHEN JSON_VALUE(j.value, '$.cancelled') IN ('true', '1') THEN 1 ELSE 0 END
          FROM OPENJSON(@orders_json) j;
        IF (SELECT COUNT(*) FROM #o) > 20000
            THROW 51000, 'El archivo trae mas de 20,000 pedidos: divide el periodo.', 1;
        IF EXISTS (SELECT 1 FROM #o WHERE sales_total IS NULL)
            THROW 51000, 'Hay pedidos sin importe en el archivo.', 1;
        IF EXISTS (SELECT platform_order_id FROM #o WHERE platform_order_id IS NOT NULL GROUP BY platform_order_id HAVING COUNT(*) > 1)
            THROW 51000, 'El archivo repite un mismo pedido.', 1;
    END

    BEGIN TRAN;
    IF @id IS NULL
    BEGIN
        INSERT INTO dbo.platform_settlements (platform, period_from, period_to, source_file, gross_sales, marketing,
            service_fees, refunds, isr_withheld, iva_withheld, other_adjustments, iva_rate, deposit_real, deposit_date, note, created_by)
        VALUES (@platform, @period_from, @period_to, @source_file, ISNULL(@gross_sales, 0), ISNULL(@marketing, 0),
            ISNULL(@service_fees, 0), ISNULL(@refunds, 0), ISNULL(@isr_withheld, 0), ISNULL(@iva_withheld, 0),
            ISNULL(@other_adjustments, 0), @iva_rate, @deposit_real, @deposit_date, @note, @user_id);
        SET @id = SCOPE_IDENTITY();
    END
    ELSE
    BEGIN
        DECLARE @estado VARCHAR(10);
        SELECT @estado = status FROM dbo.platform_settlements WITH (UPDLOCK, HOLDLOCK) WHERE id = @id;
        IF @estado IS NULL THROW 51000, 'La liquidacion no existe.', 1;
        IF @estado <> 'BORRADOR' THROW 51000, 'Solo se cambia una liquidacion en borrador.', 1;
        UPDATE dbo.platform_settlements
           SET platform = @platform, period_from = @period_from, period_to = @period_to,
               source_file = CASE WHEN @orders_json IS NOT NULL THEN @source_file ELSE ISNULL(@source_file, source_file) END,
               gross_sales = ISNULL(@gross_sales, 0), marketing = ISNULL(@marketing, 0), service_fees = ISNULL(@service_fees, 0),
               refunds = ISNULL(@refunds, 0), isr_withheld = ISNULL(@isr_withheld, 0), iva_withheld = ISNULL(@iva_withheld, 0),
               other_adjustments = ISNULL(@other_adjustments, 0), iva_rate = @iva_rate,
               deposit_real = @deposit_real, deposit_date = @deposit_date, note = @note, updated_at = SYSDATETIME()
         WHERE id = @id;
    END

    IF @orders_json IS NOT NULL
    BEGIN
        DELETE FROM dbo.platform_settlement_orders WHERE settlement_id = @id;
        INSERT INTO dbo.platform_settlement_orders (settlement_id, line_no, platform_order_id, order_at, customer, fulfillment,
            platform_status, sales_base, tax, sales_total, net_amount, cancelled)
        SELECT @id, line_no, platform_order_id, order_at, customer, fulfillment, platform_status, sales_base, tax,
               sales_total, net_amount, cancelled
          FROM #o;
    END
    COMMIT TRAN;

    EXEC dbo.sp_platform_settlement_match @settlement_id = @id;
    SELECT @id AS id;
END
GO
