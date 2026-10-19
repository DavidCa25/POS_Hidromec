SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* ===================== sp_membership_apply_sale (0063) =====================
   Lo que una venta hace en el Club. Se llama DESDE sp_register_sale, dentro
   de su transacción y con su #map (line_no -> sale_detail_id) a la vista:
   si algo aquí falla, la venta entera no se registra. Nunca queda un café
   regalado sin su venta, ni una venta de membresía sin su periodo.

   1. PAGOS. Cada renglón cuyo producto es el "producto de cobro" de un plan
      activo afilia o renueva al cliente de la venta. Cada pieza cubre
      `period_days`: desde mañana del último día pagado, o desde hoy si ya
      venció. Sin cliente no se puede cobrar una membresía.
   2. CANJE. Si la cotización trae `membership` (la caja pidió el beneficio),
      los renglones con la regla `membership` quedaron en $0 en el motor
      comercial. Aquí se comprueba OTRA VEZ, ya con bloqueo: que la membresía
      sea de este cliente, que esté pagada (o en gracia) y que no se pase del
      límite del día. Va después de los pagos: renovar y tomar el café en la
      misma venta funciona.
   ==================================================================== */
CREATE OR ALTER PROCEDURE dbo.sp_membership_apply_sale
    @sale_id     INT,
    @customer_id INT = NULL,
    @user_id     INT = NULL,
    @register_id INT = NULL,
    @quote       NVARCHAR(MAX) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;
    DECLARE @hoy DATE = CAST(GETDATE() AS DATE);

    /* ---------------------------------------------------------- 1 pagos */
    DECLARE @pagos TABLE (n INT IDENTITY(1, 1), sale_detail_id INT, plan_id INT, qty INT, amount DECIMAL(12, 2));
    INSERT INTO @pagos (sale_detail_id, plan_id, qty, amount)
    SELECT d.id, p.id, CAST(d.quantity AS INT), d.subtotal
      FROM dbo.sale_detail d
      JOIN dbo.membership_plans p ON p.sale_product_id = d.product_id AND p.active = 1
     WHERE d.sale_id = @sale_id;

    IF EXISTS (SELECT 1 FROM @pagos)
    BEGIN
        IF @customer_id IS NULL
            THROW 51000, 'Asigna el cliente para cobrar la membresia.', 1;
        IF EXISTS (SELECT 1 FROM @pagos WHERE qty < 1)
            THROW 51000, 'La membresia se cobra por periodos completos.', 1;

        DECLARE @i INT = 1, @n INT = (SELECT COUNT(*) FROM @pagos);
        WHILE @i <= @n
        BEGIN
            DECLARE @plan INT, @qty INT, @monto DECIMAL(12, 2), @detalle INT, @mid INT, @hasta DATE, @dias INT, @desde DATE;
            SELECT @plan = plan_id, @qty = qty, @monto = amount, @detalle = sale_detail_id FROM @pagos WHERE n = @i;
            SELECT @dias = period_days FROM dbo.membership_plans WHERE id = @plan;

            SELECT @mid = id, @hasta = paid_until
              FROM dbo.customer_memberships WITH (UPDLOCK, HOLDLOCK)
             WHERE customer_id = @customer_id AND plan_id = @plan;
            IF @mid IS NULL
            BEGIN
                INSERT INTO dbo.customer_memberships (customer_id, plan_id, created_by) VALUES (@customer_id, @plan, @user_id);
                SET @mid = SCOPE_IDENTITY();
                SET @hasta = NULL;
            END

            SET @desde = CASE WHEN @hasta IS NOT NULL AND @hasta >= @hoy THEN DATEADD(DAY, 1, @hasta) ELSE @hoy END;
            INSERT INTO dbo.membership_payments (membership_id, sale_id, sale_detail_id, amount, period_from, period_to)
            VALUES (@mid, @sale_id, @detalle, @monto, @desde, DATEADD(DAY, @dias * @qty - 1, @desde));

            UPDATE dbo.customer_memberships
               SET paid_until = DATEADD(DAY, @dias * @qty - 1, @desde), status = N'ACTIVE',
                   cancelled_at = NULL, cancelled_by = NULL, updated_at = SYSDATETIME()
             WHERE id = @mid;

            SELECT @mid = NULL, @hasta = NULL;
            SET @i += 1;
        END
    END

    /* ---------------------------------------------------------- 2 canje */
    DECLARE @canje INT = TRY_CONVERT(INT, JSON_VALUE(@quote, '$.membership.membershipId'));
    IF @canje IS NULL RETURN;

    DECLARE @lineas TABLE (line_no INT, qty INT, amount DECIMAL(12, 2));
    INSERT INTO @lineas (line_no, qty, amount)
    SELECT c.line_no, CAST(c.qty AS INT), TRY_CONVERT(DECIMAL(12, 2), JSON_VALUE(c.audit, '$.discount'))
      FROM OPENJSON(@quote, '$.lines') WITH (line_no INT, qty DECIMAL(12, 2), audit NVARCHAR(MAX) AS JSON) c
     WHERE JSON_VALUE(c.audit, '$.rule') = 'membership';

    DECLARE @unidades INT = (SELECT SUM(qty) FROM @lineas);
    IF ISNULL(@unidades, 0) = 0 RETURN;

    DECLARE @limite INT, @gracia INT, @pagado DATE, @estado NVARCHAR(12), @dueno INT;
    SELECT @dueno = m.customer_id, @pagado = m.paid_until, @estado = m.status, @limite = p.daily_limit, @gracia = p.grace_days
      FROM dbo.customer_memberships m WITH (UPDLOCK, HOLDLOCK)
      JOIN dbo.membership_plans p ON p.id = m.plan_id
     WHERE m.id = @canje;

    IF @dueno IS NULL OR @dueno <> ISNULL(@customer_id, -1)
        THROW 51000, 'La membresia no es del cliente de esta venta. La venta no se registro.', 1;
    IF @estado <> N'ACTIVE' OR @pagado IS NULL OR DATEADD(DAY, @gracia, @pagado) < @hoy
        THROW 51000, 'La membresia vencio: renuevala para dar el beneficio. La venta no se registro.', 1;

    DECLARE @usados INT = (SELECT ISNULL(SUM(units), 0) FROM dbo.membership_redemptions WITH (UPDLOCK, HOLDLOCK)
                            WHERE membership_id = @canje AND redeem_date = @hoy AND voided_at IS NULL);
    IF @usados + @unidades > @limite
        THROW 51000, 'El cliente ya uso su beneficio de hoy. La venta no se registro.', 1;

    INSERT INTO dbo.membership_redemptions (membership_id, redeem_date, units, product_id, product_name, amount, sale_id, sale_detail_id, register_id)
    SELECT @canje, @hoy, l.qty, d.product_id, pr.nombre, l.amount, @sale_id, d.id, @register_id
      FROM @lineas l
      JOIN #map mp ON mp.line_no = l.line_no
      JOIN dbo.sale_detail d ON d.id = mp.sale_detail_id
      JOIN dbo.products pr ON pr.id = d.product_id;
END;
GO
