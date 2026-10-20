SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* ===================== sp_loyalty_points_apply_remote (0064) =====================
   Lo que bajó de la nube (club_pull): la configuración de puntos, las
   tarjetas de sellos y los movimientos de puntos y sellos hechos en las
   demás sucursales. Con esto el saldo de un cliente es el mismo en todas.

   @payload = {
     points_config: { enabled, per_amount, points_per, visit_points, expiry_months, updated_local } | null,
     stamp_cards:   [{ uuid, name, stamps_required, reward_product_uuid, active, products: [uuid] }],
     ledger:        [{ uuid, customer_name, phone, program, card_uuid, delta, kind, reason, amount, note,
                       created_local, location_name }]
   }

   Reglas:
   · La configuración más reciente gana (por su hora local de guardado).
   · Un producto que esta sucursal no tiene (por uuid) se ignora.
   · El cliente se busca por teléfono (solo dígitos, últimos 10); si no
     existe aquí, se da de alta con su nombre y teléfono -igual que el Club-.
   · Un movimiento de una tarjeta que aquí no existe se ignora hasta que
     baje la tarjeta.
   Idempotente: un movimiento se reconoce por su uuid.
   ============================================================================ */
CREATE OR ALTER PROCEDURE dbo.sp_loyalty_points_apply_remote
    @payload NVARCHAR(MAX)
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;
    IF ISJSON(@payload) <> 1 THROW 51000, 'Datos de puntos invalidos.', 1;

    BEGIN TRAN;

    /* ---------------------------------------------------- configuración */
    DECLARE @cfg_hora DATETIME2(0) = TRY_CONVERT(DATETIME2(0), JSON_VALUE(@payload, '$.points_config.updated_local'));
    IF @cfg_hora IS NOT NULL AND @cfg_hora > (SELECT updated_at FROM dbo.loyalty_points_config WHERE id = 1)
        UPDATE dbo.loyalty_points_config
           SET enabled = ISNULL(TRY_CONVERT(BIT, JSON_VALUE(@payload, '$.points_config.enabled')), enabled),
               per_amount = NULLIF(TRY_CONVERT(DECIMAL(12,2), JSON_VALUE(@payload, '$.points_config.per_amount')), 0),
               points_per = ISNULL(TRY_CONVERT(INT, JSON_VALUE(@payload, '$.points_config.points_per')), points_per),
               visit_points = ISNULL(TRY_CONVERT(INT, JSON_VALUE(@payload, '$.points_config.visit_points')), 0),
               expiry_months = TRY_CONVERT(INT, JSON_VALUE(@payload, '$.points_config.expiry_months')),
               origin = N'REMOTE', updated_at = @cfg_hora
         WHERE id = 1;

    /* ---------------------------------------------------------- tarjetas */
    SELECT j.uuid, j.name, j.stamps_required, NULLIF(pr.id, -1) AS reward_product_id, j.active, j.products
      INTO #tarjetas
      FROM OPENJSON(@payload, '$.stamp_cards') WITH (
             uuid UNIQUEIDENTIFIER, name NVARCHAR(80), stamps_required INT, reward_product_uuid UNIQUEIDENTIFIER,
             active BIT, products NVARCHAR(MAX) AS JSON) j
      LEFT JOIN dbo.products pr ON pr.uuid = j.reward_product_uuid
     WHERE j.uuid IS NOT NULL AND j.name IS NOT NULL AND j.stamps_required BETWEEN 2 AND 100;

    UPDATE t SET name = x.name, stamps_required = x.stamps_required, reward_product_id = x.reward_product_id,
                 active = ISNULL(x.active, 1), updated_at = SYSDATETIME()
      FROM dbo.loyalty_stamp_cards t JOIN #tarjetas x ON x.uuid = t.uuid
     WHERE t.origin = N'REMOTE';

    INSERT INTO dbo.loyalty_stamp_cards (uuid, name, stamps_required, reward_product_id, active, origin)
    SELECT x.uuid, x.name, x.stamps_required, x.reward_product_id, ISNULL(x.active, 1), N'REMOTE'
      FROM #tarjetas x
     WHERE NOT EXISTS (SELECT 1 FROM dbo.loyalty_stamp_cards t WHERE t.uuid = x.uuid);

    DELETE cp FROM dbo.loyalty_stamp_card_products cp
      JOIN dbo.loyalty_stamp_cards t ON t.id = cp.card_id AND t.origin = N'REMOTE'
      JOIN #tarjetas x ON x.uuid = t.uuid
     WHERE NOT EXISTS (SELECT 1 FROM OPENJSON(x.products) v JOIN dbo.products pr ON pr.uuid = TRY_CONVERT(UNIQUEIDENTIFIER, v.value)
                        WHERE pr.id = cp.product_id);
    INSERT INTO dbo.loyalty_stamp_card_products (card_id, product_id)
    SELECT DISTINCT t.id, pr.id
      FROM #tarjetas x
      JOIN dbo.loyalty_stamp_cards t ON t.uuid = x.uuid AND t.origin = N'REMOTE'
     CROSS APPLY OPENJSON(x.products) v
      JOIN dbo.products pr ON pr.uuid = TRY_CONVERT(UNIQUEIDENTIFIER, v.value)
     WHERE NOT EXISTS (SELECT 1 FROM dbo.loyalty_stamp_card_products e WHERE e.card_id = t.id AND e.product_id = pr.id);

    /* ------------------------------------------------------- movimientos */
    SELECT j.uuid, NULLIF(LTRIM(RTRIM(j.customer_name)), N'') AS customer_name,
           RIGHT(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(ISNULL(j.phone, N''), N' ', N''), N'-', N''), N'(', N''), N')', N''), N'+', N''), N'.', N''), 10) AS tel,
           j.program, NULLIF(t.id, -1) AS card_id, j.delta, j.kind, j.reason, j.amount, j.note,
           TRY_CONVERT(DATETIME2(0), j.created_local) AS created_at, j.location_name, CAST(NULL AS INT) AS customer_id
      INTO #libro
      FROM OPENJSON(@payload, '$.ledger') WITH (
             uuid UNIQUEIDENTIFIER, customer_name NVARCHAR(120), phone NVARCHAR(40), program NVARCHAR(10),
             card_uuid UNIQUEIDENTIFIER, delta INT, kind NVARCHAR(10), reason NVARCHAR(12), amount DECIMAL(12,2),
             note NVARCHAR(200), created_local NVARCHAR(30), location_name NVARCHAR(120)) j
      LEFT JOIN dbo.loyalty_stamp_cards t ON t.uuid = j.card_uuid
     WHERE j.uuid IS NOT NULL AND ISNULL(j.delta, 0) <> 0
       AND j.program IN (N'POINTS', N'STAMPS') AND j.kind IN (N'EARN', N'REDEEM', N'REVERSE', N'EXPIRE', N'ADJUST')
       AND NOT EXISTS (SELECT 1 FROM dbo.loyalty_ledger l WHERE l.uuid = j.uuid);
    DELETE FROM #libro WHERE program = N'STAMPS' AND card_id IS NULL;

    /* El cliente por teléfono; si no está, se da de alta (uno por teléfono). */
    UPDATE x SET customer_id = c.id
      FROM #libro x
     CROSS APPLY (SELECT TOP 1 id FROM dbo.customers
                   WHERE LEN(x.tel) = 10
                     AND RIGHT(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(ISNULL(NULLIF(mobile, N''), ISNULL(phone, N'')), N' ', N''), N'-', N''), N'(', N''), N')', N''), N'+', N''), N'.', N''), 10) = x.tel
                   ORDER BY active DESC, id) c;
    INSERT INTO dbo.customers (customerName, phone, active)
    SELECT MIN(customer_name), tel, 1 FROM #libro
     WHERE customer_id IS NULL AND LEN(tel) = 10 AND customer_name IS NOT NULL
     GROUP BY tel;
    UPDATE x SET customer_id = c.id
      FROM #libro x
     CROSS APPLY (SELECT TOP 1 id FROM dbo.customers WHERE phone = x.tel ORDER BY id DESC) c
     WHERE x.customer_id IS NULL AND LEN(x.tel) = 10;

    INSERT INTO dbo.loyalty_ledger (uuid, customer_id, program, card_id, delta, kind, reason, amount, note, origin, location_name, created_at)
    SELECT x.uuid, x.customer_id, x.program, CASE WHEN x.program = N'STAMPS' THEN x.card_id END, x.delta, x.kind, x.reason, x.amount, x.note,
           N'REMOTE', x.location_name, ISNULL(x.created_at, SYSDATETIME())
      FROM #libro x
     WHERE x.customer_id IS NOT NULL;

    COMMIT TRAN;

    SELECT (SELECT COUNT(*) FROM #tarjetas) AS tarjetas, (SELECT COUNT(*) FROM #libro WHERE customer_id IS NOT NULL) AS movimientos;
END;
GO
