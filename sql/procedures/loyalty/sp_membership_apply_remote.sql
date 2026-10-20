SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* ===================== sp_membership_apply_remote (0063) =====================
   Lo que bajó de la nube (club_pull): planes, membresías y canjes de las
   demás sucursales de la empresa. Con esto una caja sabe que Mariana renovó
   en otra sucursal, o que ya tomó su café de hoy allá.

   @payload = {
     plans:       [{ uuid, name, sale_product_uuid, period_days, daily_limit, grace_days, active, products: [uuid] }],
     memberships: [{ uuid, plan_uuid, customer_name, phone, status, paid_until }],
     redemptions: [{ uuid, membership_uuid, redeem_date, units, product_uuid, product_name, location_name, voided, doble }]
   }

   Reglas:
   · Un producto que esta sucursal no tiene (por uuid) se ignora.
   · El cliente se busca por teléfono (solo dígitos, últimos 10). Si no
     existe aquí, se da de alta con su nombre y teléfono.
   · paid_until: se queda el MAYOR de los dos. Una baja en la nube gana.
   · Un canje de esta misma caja solo actualiza su marca de doble.
   Idempotente: aplicar dos veces el mismo lote no cambia nada.
   ==================================================================== */
CREATE OR ALTER PROCEDURE dbo.sp_membership_apply_remote
    @payload NVARCHAR(MAX)
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;
    IF ISJSON(@payload) <> 1 THROW 51000, 'Datos del Club invalidos.', 1;

    BEGIN TRAN;

    /* ---------------------------------------------------------- planes */
    SELECT j.uuid, j.name, NULLIF(pr.id, -1) AS sale_product_id, j.period_days, j.daily_limit, j.grace_days, j.active, j.products
      INTO #planes
      FROM OPENJSON(@payload, '$.plans') WITH (
             uuid UNIQUEIDENTIFIER, name NVARCHAR(80), sale_product_uuid UNIQUEIDENTIFIER, period_days INT,
             daily_limit INT, grace_days INT, active BIT, products NVARCHAR(MAX) AS JSON) j
      LEFT JOIN dbo.products pr ON pr.uuid = j.sale_product_uuid
     WHERE j.uuid IS NOT NULL AND j.name IS NOT NULL;

    UPDATE p SET name = x.name, sale_product_id = ISNULL(x.sale_product_id, p.sale_product_id), period_days = x.period_days,
                 daily_limit = x.daily_limit, grace_days = x.grace_days, active = x.active
      FROM dbo.membership_plans p JOIN #planes x ON x.uuid = p.uuid
     WHERE p.origin = N'REMOTE';

    INSERT INTO dbo.membership_plans (uuid, name, sale_product_id, period_days, daily_limit, grace_days, active, origin)
    SELECT x.uuid, x.name, x.sale_product_id, x.period_days, x.daily_limit, x.grace_days, x.active, N'REMOTE'
      FROM #planes x
     WHERE NOT EXISTS (SELECT 1 FROM dbo.membership_plans p WHERE p.uuid = x.uuid)
       AND NOT EXISTS (SELECT 1 FROM dbo.membership_plans p WHERE p.sale_product_id = x.sale_product_id);

    INSERT INTO dbo.membership_plan_products (plan_id, product_id)
    SELECT DISTINCT p.id, pr.id
      FROM #planes x
      JOIN dbo.membership_plans p ON p.uuid = x.uuid AND p.origin = N'REMOTE'
      CROSS APPLY OPENJSON(x.products) v
      JOIN dbo.products pr ON pr.uuid = TRY_CONVERT(UNIQUEIDENTIFIER, v.value)
     WHERE NOT EXISTS (SELECT 1 FROM dbo.membership_plan_products e WHERE e.plan_id = p.id AND e.product_id = pr.id);

    /* ------------------------------------------------------ membresías */
    SELECT j.uuid, CONVERT(INT, p.id) AS plan_id, NULLIF(LTRIM(RTRIM(j.customer_name)), N'') AS customer_name,
           RIGHT(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(ISNULL(j.phone, N''), N' ', N''), N'-', N''), N'(', N''), N')', N''), N'+', N''), N'.', N''), 10) AS tel,
           j.status, j.paid_until
      INTO #socios
      FROM OPENJSON(@payload, '$.memberships') WITH (
             uuid UNIQUEIDENTIFIER, plan_uuid UNIQUEIDENTIFIER, customer_name NVARCHAR(120), phone NVARCHAR(40),
             status NVARCHAR(12), paid_until DATE) j
      JOIN dbo.membership_plans p ON p.uuid = j.plan_uuid
     WHERE j.uuid IS NOT NULL;

    /* Las que ya existen aquí (por uuid): pagado hasta el mayor, baja gana. */
    UPDATE m
       SET paid_until = CASE WHEN x.paid_until IS NOT NULL AND (m.paid_until IS NULL OR x.paid_until > m.paid_until) THEN x.paid_until ELSE m.paid_until END,
           status = CASE WHEN x.status = N'CANCELLED' THEN N'CANCELLED'
                         WHEN m.status = N'CANCELLED' AND x.paid_until > ISNULL(m.paid_until, '19000101') THEN N'ACTIVE'
                         ELSE m.status END,
           updated_at = SYSDATETIME()
      FROM dbo.customer_memberships m JOIN #socios x ON x.uuid = m.uuid
     WHERE ISNULL(x.paid_until, '19000101') <> ISNULL(m.paid_until, '19000101') OR x.status <> m.status;

    /* Las nuevas: el cliente por teléfono, o se da de alta. */
    DECLARE @u UNIQUEIDENTIFIER, @plan INT, @nombre NVARCHAR(120), @tel NVARCHAR(10), @st NVARCHAR(12), @hasta DATE, @cli INT;
    DECLARE c CURSOR LOCAL FAST_FORWARD FOR
        SELECT uuid, plan_id, customer_name, tel, status, paid_until FROM #socios x
         WHERE NOT EXISTS (SELECT 1 FROM dbo.customer_memberships m WHERE m.uuid = x.uuid);
    OPEN c;
    FETCH NEXT FROM c INTO @u, @plan, @nombre, @tel, @st, @hasta;
    WHILE @@FETCH_STATUS = 0
    BEGIN
        SET @cli = NULL;
        IF LEN(@tel) = 10
            SELECT TOP 1 @cli = id FROM dbo.customers
             WHERE RIGHT(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(ISNULL(NULLIF(mobile, N''), ISNULL(phone, N'')), N' ', N''), N'-', N''), N'(', N''), N')', N''), N'+', N''), N'.', N''), 10) = @tel
             ORDER BY active DESC, id;
        IF @cli IS NULL AND @nombre IS NOT NULL
        BEGIN
            INSERT INTO dbo.customers (customerName, phone, active) VALUES (@nombre, NULLIF(@tel, N''), 1);
            SET @cli = SCOPE_IDENTITY();
        END
        IF @cli IS NOT NULL
        BEGIN
            /* Afiliado en dos sucursales por separado: se queda la de aquí con lo mayor pagado. */
            IF EXISTS (SELECT 1 FROM dbo.customer_memberships WHERE customer_id = @cli AND plan_id = @plan)
                UPDATE dbo.customer_memberships
                   SET paid_until = CASE WHEN @hasta > ISNULL(paid_until, '19000101') THEN @hasta ELSE paid_until END, updated_at = SYSDATETIME()
                 WHERE customer_id = @cli AND plan_id = @plan;
            ELSE
                INSERT INTO dbo.customer_memberships (uuid, customer_id, plan_id, status, paid_until, origin)
                VALUES (@u, @cli, @plan, CASE WHEN @st = N'CANCELLED' THEN N'CANCELLED' ELSE N'ACTIVE' END, @hasta, N'REMOTE');
        END
        FETCH NEXT FROM c INTO @u, @plan, @nombre, @tel, @st, @hasta;
    END
    CLOSE c; DEALLOCATE c;

    /* ---------------------------------------------------------- canjes */
    SELECT j.uuid, CONVERT(INT, m.id) AS membership_id, j.redeem_date, j.units, NULLIF(pr.id, -1) AS product_id, j.product_name, j.location_name, j.voided, j.doble
      INTO #canjes
      FROM OPENJSON(@payload, '$.redemptions') WITH (
             uuid UNIQUEIDENTIFIER, membership_uuid UNIQUEIDENTIFIER, redeem_date DATE, units INT, product_uuid UNIQUEIDENTIFIER,
             product_name NVARCHAR(100), location_name NVARCHAR(120), voided BIT, doble BIT) j
      JOIN dbo.customer_memberships m ON m.uuid = j.membership_uuid
      LEFT JOIN dbo.products pr ON pr.uuid = j.product_uuid
     WHERE j.uuid IS NOT NULL AND j.redeem_date IS NOT NULL;

    /* Los de aquí y los ya bajados: la marca de doble y la anulación. */
    UPDATE r SET doble = ISNULL(x.doble, r.doble),
                 voided_at = CASE WHEN x.voided = 1 AND r.voided_at IS NULL THEN SYSDATETIME() ELSE r.voided_at END
      FROM dbo.membership_redemptions r JOIN #canjes x ON x.uuid = r.uuid
     WHERE r.doble <> ISNULL(x.doble, r.doble) OR (x.voided = 1 AND r.voided_at IS NULL);

    INSERT INTO dbo.membership_redemptions (uuid, membership_id, redeem_date, units, product_id, product_name, origin, location_name, voided_at, doble)
    SELECT x.uuid, x.membership_id, x.redeem_date, CASE WHEN x.units BETWEEN 1 AND 20 THEN x.units ELSE 1 END, x.product_id, x.product_name,
           N'REMOTE', x.location_name, CASE WHEN x.voided = 1 THEN SYSDATETIME() END, ISNULL(x.doble, 0)
      FROM #canjes x
     WHERE NOT EXISTS (SELECT 1 FROM dbo.membership_redemptions r WHERE r.uuid = x.uuid);

    COMMIT TRAN;

    SELECT (SELECT COUNT(*) FROM #planes) AS planes, (SELECT COUNT(*) FROM #socios) AS membresias, (SELECT COUNT(*) FROM #canjes) AS canjes;
END;
GO
