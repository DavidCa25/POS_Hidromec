/* ============================================================
   0007 — completar procedures desde template

   Generada con scripts/db/generar-migracion.mjs desde los archivos
   canonicos de sql/. No editar a mano: regenerar.

   Idempotente: todos los objetos usan CREATE OR ALTER, y los tipos
   comprueban su existencia antes de crearse. Se puede reejecutar.

   NO toca tablas ni datos. Solo objetos programables.
   ============================================================ */

/* ---------- ProductImportType (USER_TABLE_TYPE) ---------- */
/* ProductImportType
 * Tipo de tabla. SQL Server no conserva el texto original de un tipo, asi
 * que este DDL se reconstruye desde sys.columns. Es equivalente, no literal.
 * Un tipo NO admite CREATE OR ALTER: se comprueba antes de crearlo.
 */
IF TYPE_ID(N'dbo.ProductImportType') IS NULL
BEGIN
  CREATE TYPE dbo.ProductImportType AS TABLE (
    part_number NVARCHAR(100) NULL,
    name NVARCHAR(100) NULL,
    brand_name NVARCHAR(150) NULL,
    category_name NVARCHAR(150) NULL,
    price DECIMAL(10, 2) NULL,
    stock DECIMAL(12, 2) NULL,
    bar_code NVARCHAR(100) NULL,
    clave_prod_serv NVARCHAR(8) NULL,
    clave_unidad NVARCHAR(5) NULL,
    objeto_impuesto NVARCHAR(2) NULL,
    tasa_iva DECIMAL(5, 4) NULL
  );
END;

/* ---------- sp_authorize_supervisor (SQL_STORED_PROCEDURE) ---------- */
/* sp_authorize_supervisor
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* 3) Autorizar supervisor (valida usuario+contraseña con rol admin/supervisor) */
CREATE OR ALTER PROCEDURE dbo.sp_authorize_supervisor
    @usuario NVARCHAR(50), @password NVARCHAR(255)
AS
BEGIN
    SET NOCOUNT ON;
    SELECT TOP 1 id, usuario, rol
    FROM dbo.users
    WHERE usuario = @usuario
      AND active = 1
      AND rol IN ('admin', 'supervisor')
      AND password_hash = CONVERT(NVARCHAR(255), HASHBYTES('SHA2_256', @password), 2);
END
GO

/* ---------- sp_cash_summary (SQL_STORED_PROCEDURE) ---------- */
/* sp_cash_summary
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* Resumen de caja de los ultimos @days dias + pagos a proveedores */
CREATE OR ALTER PROCEDURE dbo.sp_cash_summary
    @days INT = 30
AS
BEGIN
    SET NOCOUNT ON;
    SELECT
        ISNULL(SUM(CASE WHEN typee = 'WITHDRAW' THEN amount ELSE 0 END), 0) AS salidas,
        ISNULL(SUM(CASE WHEN typee <> 'WITHDRAW' THEN amount ELSE 0 END), 0) AS entradas,
        COUNT(*) AS movimientos,
        (SELECT ISNULL(SUM(amount), 0) FROM supplier_payments
          WHERE datee >= DATEADD(DAY, -@days, CAST(GETDATE() AS DATE))) AS pagos_proveedores
    FROM cash_movements
    WHERE datee >= DATEADD(DAY, -@days, CAST(GETDATE() AS DATE));
END
GO

/* ---------- sp_cashier_risk (SQL_STORED_PROCEDURE) ---------- */
/* sp_cashier_risk
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* 5) Índice de riesgo por cajero (semáforo bajo/medio/alto) */
CREATE OR ALTER PROCEDURE dbo.sp_cashier_risk
    @from DATE = NULL, @to DATE = NULL
AS
BEGIN
    SET NOCOUNT ON;
    IF @from IS NULL SET @from = DATEADD(DAY, -30, CAST(GETDATE() AS DATE));
    IF @to   IS NULL SET @to   = CAST(GETDATE() AS DATE);

    ;WITH agg AS (
        SELECT u.id AS user_id, u.usuario AS cajero,
            SUM(CASE WHEN e.event_type = 'VOID_SALE'      THEN 1 ELSE 0 END) AS anuladas,
            SUM(CASE WHEN e.event_type = 'REFUND'         THEN 1 ELSE 0 END) AS devoluciones,
            SUM(CASE WHEN e.event_type = 'DRAWER_NO_SALE' THEN 1 ELSE 0 END) AS cajon_sin_venta,
            SUM(CASE WHEN e.event_type = 'ITEM_REMOVED'   THEN 1 ELSE 0 END) AS eliminados,
            SUM(CASE WHEN e.event_type IN ('DISCOUNT','PRICE_CHANGE') THEN 1 ELSE 0 END) AS descuentos,
            SUM(ISNULL(e.amount, 0)) AS monto_riesgo
        FROM dbo.users u
        LEFT JOIN dbo.security_events e
            ON e.user_id = u.id AND e.datee >= @from AND e.datee < DATEADD(DAY, 1, @to)
        WHERE u.rol IN ('cajero','supervisor','admin')
        GROUP BY u.id, u.usuario
    ),
    scored AS (
        SELECT *,
            (anuladas*8 + devoluciones*6 + cajon_sin_venta*5 + eliminados*3 + descuentos*4) AS raw
        FROM agg
    )
    SELECT user_id, cajero, anuladas, devoluciones, cajon_sin_venta, eliminados, descuentos, monto_riesgo,
        CASE WHEN raw > 100 THEN 100 ELSE raw END AS score,
        CASE WHEN raw >= 60 THEN 'alto' WHEN raw >= 30 THEN 'medio' ELSE 'bajo' END AS nivel
    FROM scored
    ORDER BY raw DESC;
END
GO

/* ---------- sp_customers_kpis (SQL_STORED_PROCEDURE) ---------- */
/* sp_customers_kpis
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* KPIs de clientes */
CREATE OR ALTER PROCEDURE dbo.sp_customers_kpis
AS
BEGIN
    SET NOCOUNT ON;
    SELECT
        (SELECT COUNT(*) FROM customers WHERE active = 1) AS activos,
        (SELECT COUNT(*) FROM customers
          WHERE created_at >= DATEADD(DAY, -30, CAST(GETDATE() AS DATE))) AS nuevos_30d,
        (SELECT COUNT(DISTINCT customer_id) FROM sales WHERE customer_id IS NOT NULL) AS con_compras;
END
GO

/* ---------- sp_dead_products (SQL_STORED_PROCEDURE) ---------- */
/* sp_dead_products
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* Productos sin rotacion (activos, sin ninguna venta) */
CREATE OR ALTER PROCEDURE dbo.sp_dead_products
    @limit INT = 20
AS
BEGIN
    SET NOCOUNT ON;
    SELECT TOP (@limit)
        p.id,
        p.nombre,
        p.stock,
        p.price
    FROM products p
    WHERE p.active = 1
      AND NOT EXISTS (SELECT 1 FROM sale_detail sd WHERE sd.product_id = p.id)
    ORDER BY p.nombre;
END
GO

/* ---------- sp_get_profit_overview (SQL_STORED_PROCEDURE) ---------- */
/* sp_get_profit_overview
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
-- Utilidad por día (pestaña "Caja y utilidad" de Estadísticas).
-- Utilidad = (precio de venta SIN IVA) - (costo del producto).
-- El costo (last_cost) vive en product_suppliers (por proveedor); se toma el del proveedor default.
-- Si un producto no tiene costo registrado, se asume 0 (la utilidad sale como venta completa).

CREATE OR ALTER PROCEDURE dbo.sp_get_profit_overview
    @from_date DATE = NULL,
    @to_date   DATE = NULL
AS
BEGIN
    SET NOCOUNT ON;

    IF @from_date IS NULL SET @from_date = DATEADD(DAY, -6, CAST(GETDATE() AS DATE));
    IF @to_date   IS NULL SET @to_date   = CAST(GETDATE() AS DATE);

    SELECT
        CAST(s.datee AS DATE) AS datee,
        SUM(
            sd.quantity *
            ( sd.unitary_price / (1 + ISNULL(p.tasa_iva, 0.16)) - ISNULL(ps.last_cost, 0) )
        ) AS profit
    FROM dbo.sales s
    INNER JOIN dbo.sale_detail sd ON sd.sale_id = s.id
    INNER JOIN dbo.products p     ON p.id = sd.product_id
    OUTER APPLY (
        SELECT TOP 1 x.last_cost
        FROM dbo.product_suppliers x
        WHERE x.product_id = p.id AND x.active = 1
        ORDER BY x.is_default DESC
    ) ps
    WHERE s.datee >= @from_date
      AND s.datee <  DATEADD(DAY, 1, @to_date)
    GROUP BY CAST(s.datee AS DATE)
    ORDER BY CAST(s.datee AS DATE);
END;
GO

/* ---------- sp_get_supplier_account_detail (SQL_STORED_PROCEDURE) ---------- */
/* sp_get_supplier_account_detail
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
CREATE OR ALTER PROCEDURE dbo.sp_get_supplier_account_detail
    @supplier_id INT
AS
BEGIN
    SET NOCOUNT ON;

    -- 1) Compras con saldo pendiente
    SELECT
        p.id            AS purchase_id,
        p.datee,
        p.total,
        p.balance,
        p.payment_status
    FROM purchase p
    WHERE p.supplier_id = @supplier_id
      AND p.balance > 0
    ORDER BY p.datee ASC;

    -- 2) Pagos hechos al proveedor
    SELECT
        sp.id,
        sp.purchase_id,
        sp.datee,
        sp.amount,
        sp.payment_method,
        sp.note
    FROM supplier_payments sp
    WHERE sp.supplier_id = @supplier_id
    ORDER BY sp.datee DESC;
END
GO

/* ---------- sp_get_supplier_payments (SQL_STORED_PROCEDURE) ---------- */
/* sp_get_supplier_payments
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
CREATE OR ALTER PROCEDURE dbo.sp_get_supplier_payments
    @supplier_id INT
AS
BEGIN
    SET NOCOUNT ON;
    SELECT
        sp.id,
        sp.purchase_id,
        sp.datee,
        sp.amount,
        sp.payment_method,
        sp.note
    FROM supplier_payments sp
    WHERE sp.supplier_id = @supplier_id
    ORDER BY sp.datee DESC;
END
GO

/* ---------- sp_get_suppliers_account (SQL_STORED_PROCEDURE) ---------- */
/* sp_get_suppliers_account
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
CREATE OR ALTER PROCEDURE dbo.sp_get_suppliers_account
AS
BEGIN
    SET NOCOUNT ON;
    SELECT
        s.id                     AS supplier_id,
        s.nombre,
        s.telefono,
        s.correo,
        s.rfc,
        ISNULL(pg.total_paid, 0) AS total_paid,
        pg.last_payment
    FROM CAT_suppliers s
    LEFT JOIN (
        SELECT supplier_id, SUM(amount) AS total_paid, MAX(datee) AS last_payment
        FROM supplier_payments
        GROUP BY supplier_id
    ) pg ON pg.supplier_id = s.id
    WHERE ISNULL(s.activo, 1) = 1
    ORDER BY s.nombre ASC;
END
GO

/* ---------- sp_import_products (SQL_STORED_PROCEDURE) ---------- */
/* sp_import_products
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
CREATE OR ALTER PROCEDURE dbo.sp_import_products
    @Rows dbo.ProductImportType READONLY
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    BEGIN TRY
        BEGIN TRAN;

        /* 1) Normalizar filas validas (con part_number y nombre) y defaults */
        DECLARE @norm TABLE (
            part_number     NVARCHAR(100),
            name            NVARCHAR(100),
            brand_name      NVARCHAR(150),
            category_name   NVARCHAR(150),
            price           DECIMAL(10,2),
            stock           DECIMAL(12,2),
            bar_code        NVARCHAR(100),
            clave_prod_serv NVARCHAR(8),
            clave_unidad    NVARCHAR(5),
            objeto_impuesto NVARCHAR(2),
            tasa_iva        DECIMAL(5,4)
        );

        INSERT INTO @norm
        SELECT
            LTRIM(RTRIM(part_number)),
            LTRIM(RTRIM(name)),
            NULLIF(LTRIM(RTRIM(ISNULL(brand_name, ''))), ''),
            NULLIF(LTRIM(RTRIM(ISNULL(category_name, ''))), ''),
            ISNULL(price, 0),
            ISNULL(stock, 0),
            NULLIF(LTRIM(RTRIM(ISNULL(bar_code, ''))), ''),
            NULLIF(LTRIM(RTRIM(ISNULL(clave_prod_serv, ''))), ''),
            NULLIF(LTRIM(RTRIM(ISNULL(clave_unidad, ''))), ''),
            NULLIF(LTRIM(RTRIM(ISNULL(objeto_impuesto, ''))), ''),
            tasa_iva
        FROM @Rows
        WHERE LTRIM(RTRIM(ISNULL(part_number, ''))) <> ''
          AND LTRIM(RTRIM(ISNULL(name, ''))) <> '';

        /* Defaults: marca/categoria vacia y campos fiscales */
        UPDATE @norm SET brand_name      = 'SIN MARCA' WHERE brand_name IS NULL;
        UPDATE @norm SET category_name   = 'GENERAL'   WHERE category_name IS NULL;
        UPDATE @norm SET objeto_impuesto = '02'        WHERE objeto_impuesto IS NULL;
        UPDATE @norm SET tasa_iva        = 0.16        WHERE tasa_iva IS NULL;

        /* 2) Crear marcas faltantes */
        DECLARE @brands_before INT = (SELECT COUNT(*) FROM CAT_brands);
        INSERT INTO CAT_brands (namee)
        SELECT DISTINCT n.brand_name
        FROM @norm n
        WHERE NOT EXISTS (SELECT 1 FROM CAT_brands b WHERE b.namee = n.brand_name);
        DECLARE @brands_created INT = (SELECT COUNT(*) FROM CAT_brands) - @brands_before;

        /* 3) Crear categorias faltantes */
        DECLARE @cats_before INT = (SELECT COUNT(*) FROM CAT_categories);
        INSERT INTO CAT_categories (namee)
        SELECT DISTINCT n.category_name
        FROM @norm n
        WHERE NOT EXISTS (SELECT 1 FROM CAT_categories c WHERE c.namee = n.category_name);
        DECLARE @cats_created INT = (SELECT COUNT(*) FROM CAT_categories) - @cats_before;

        /* 4) Insertar productos.
              - Se omiten part_number/bar_code repetidos dentro del archivo
                (ROW_NUMBER) y los que ya existen en products (NOT EXISTS),
                para no romper por indices UNIQUE. */
        ;WITH dedup AS (
            SELECT *,
                   ROW_NUMBER() OVER (PARTITION BY part_number ORDER BY (SELECT 0)) AS rn_pn,
                   ROW_NUMBER() OVER (PARTITION BY bar_code    ORDER BY (SELECT 0)) AS rn_bc
            FROM @norm
        )
        INSERT INTO products
            (part_number, nombre, price, stock, active, category_id, brand_id,
             bar_code, clave_prod_serv, clave_unidad, objeto_impuesto, tasa_iva)
        SELECT
            d.part_number, d.name, d.price, d.stock, 1, c.id, b.id,
            d.bar_code, d.clave_prod_serv, d.clave_unidad, d.objeto_impuesto, d.tasa_iva
        FROM dedup d
        JOIN CAT_brands     b ON b.namee = d.brand_name
        JOIN CAT_categories c ON c.namee = d.category_name
        WHERE d.rn_pn = 1
          AND (d.bar_code IS NULL OR d.rn_bc = 1)
          AND NOT EXISTS (SELECT 1 FROM products p WHERE p.part_number = d.part_number)
          AND (d.bar_code IS NULL OR NOT EXISTS (SELECT 1 FROM products p WHERE p.bar_code = d.bar_code));

        DECLARE @inserted   INT = @@ROWCOUNT;
        DECLARE @total_rows INT = (SELECT COUNT(*) FROM @norm);
        DECLARE @skipped    INT = @total_rows - @inserted;

        COMMIT TRAN;

        SELECT
            @inserted        AS inserted,
            @skipped         AS skipped,
            @brands_created  AS brands_created,
            @cats_created    AS categories_created,
            @total_rows      AS total_rows;
    END TRY
    BEGIN CATCH
        IF XACT_STATE() <> 0 ROLLBACK TRAN;
        DECLARE @ErrMsg NVARCHAR(4000) = ERROR_MESSAGE();
        DECLARE @ErrSev INT = ERROR_SEVERITY();
        DECLARE @ErrSta INT = ERROR_STATE();
        RAISERROR(@ErrMsg, @ErrSev, @ErrSta);
    END CATCH
END
GO

/* ---------- sp_log_security_event (SQL_STORED_PROCEDURE) ---------- */
/* sp_log_security_event
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* 2) Registrar un evento de seguridad */
CREATE OR ALTER PROCEDURE dbo.sp_log_security_event
    @user_id INT = NULL, @authorized_by INT = NULL, @register_id INT = NULL,
    @event_type NVARCHAR(40), @amount DECIMAL(18,2) = NULL,
    @detail NVARCHAR(400) = NULL, @sale_id INT = NULL
AS
BEGIN
    SET NOCOUNT ON;
    INSERT INTO dbo.security_events (user_id, authorized_by, register_id, event_type, amount, detail, sale_id)
    VALUES (@user_id, @authorized_by, @register_id, @event_type, @amount, @detail, @sale_id);
    SELECT SCOPE_IDENTITY() AS id;
END
GO

/* ---------- sp_register_purchase (SQL_STORED_PROCEDURE) ---------- */
/* sp_register_purchase
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
CREATE OR ALTER PROCEDURE dbo.sp_register_purchase
    @user_id     INT,
    @supplier_id INT,
    @subtotal    DECIMAL(10,2),
    @tax_rate    DECIMAL(5,2),
    @tax_amount  DECIMAL(10,2),
    @total       DECIMAL(10,2),
    @PurchaseDetails dbo.PurchaseDetailType READONLY
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    DECLARE @purchase_id    INT;
    DECLARE @product_id     INT;
    DECLARE @quantity       DECIMAL(12,2);
    DECLARE @unit_price     DECIMAL(10,2);
    DECLARE @profit_percent DECIMAL(5,2);
    DECLARE @tasa_venta     DECIMAL(6,4);
    DECLARE @obj            NVARCHAR(4);
    DECLARE @new_price      DECIMAL(10,2);

    IF (@supplier_id IS NULL)
    BEGIN
        RAISERROR('La compra requiere un proveedor.', 16, 1);
        RETURN;
    END

    BEGIN TRY
        BEGIN TRAN;

        -- Cabecera: proveedor unico de la compra
        INSERT INTO purchase (datee, useer_id, total, tax_rate, tax_amount, supplier_id, balance, payment_status)
        VALUES (GETDATE(), @user_id, @total, @tax_rate, @tax_amount, @supplier_id, @total, 'PENDIENTE');
        SET @purchase_id = SCOPE_IDENTITY();

        DECLARE purchase_cursor CURSOR LOCAL FAST_FORWARD FOR
            SELECT product_id, quantity, unit_price, profit_percent
            FROM @PurchaseDetails;

        OPEN purchase_cursor;
        FETCH NEXT FROM purchase_cursor
          INTO @product_id, @quantity, @unit_price, @profit_percent;

        WHILE @@FETCH_STATUS = 0
        BEGIN
            IF (@profit_percent IS NULL) SET @profit_percent = 0;
            IF (@profit_percent < 0)     SET @profit_percent = 0;

            -- Mismo proveedor en la linea (compatibilidad con sp_get_purchases)
            INSERT INTO purchase_detail (
                puchase_id, product_id, supplier_id, quantity, unitary_price, profit_percent
            )
            VALUES (
                @purchase_id, @product_id, @supplier_id, @quantity, @unit_price, @profit_percent
            );

            IF (@unit_price > 0)
            BEGIN
                -- Tasa de venta = tasa del producto (0 si no es objeto de IVA)
                SELECT @tasa_venta = ISNULL(tasa_iva, @tax_rate),
                       @obj        = ISNULL(objeto_impuesto, '02')
                FROM products WHERE id = @product_id;

                IF (@tasa_venta IS NULL) SET @tasa_venta = @tax_rate;
                IF (@obj <> '02')        SET @tasa_venta = 0;

                -- Costo SIN IVA -> precio de venta CON IVA
                SET @new_price =
                    ROUND(@unit_price * (1 + @tasa_venta) * (1 + (@profit_percent / 100.0)), 2);

                UPDATE products
                SET cost  = @unit_price,
                    price = @new_price,
                    stock = stock + @quantity
                WHERE id = @product_id;
            END
            ELSE
            BEGIN
                UPDATE products
                SET stock = stock + @quantity
                WHERE id = @product_id;
            END

            INSERT INTO inventory_movements (
                product_id, typee, reference, quantity, datee, descriptionn
            ) VALUES (
                @product_id, 'entrada', CAST(@purchase_id AS NVARCHAR(50)),
                @quantity, GETDATE(), 'Compra'
            );

            FETCH NEXT FROM purchase_cursor
              INTO @product_id, @quantity, @unit_price, @profit_percent;
        END;

        CLOSE purchase_cursor;
        DEALLOCATE purchase_cursor;

        COMMIT TRAN;
        SELECT @purchase_id AS purchase_id;
    END TRY
    BEGIN CATCH
        IF XACT_STATE() <> 0 ROLLBACK TRAN;
        DECLARE @ErrMsg NVARCHAR(4000) = ERROR_MESSAGE();
        DECLARE @ErrSev INT = ERROR_SEVERITY();
        DECLARE @ErrSta INT = ERROR_STATE();
        RAISERROR(@ErrMsg, @ErrSev, @ErrSta);
    END CATCH
END
GO

/* ---------- sp_reorder_suggestions (SQL_STORED_PROCEDURE) ---------- */
/* sp_reorder_suggestions
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
CREATE OR ALTER PROCEDURE sp_reorder_suggestions
  @dias_ventana   INT = 30,   -- ventana para medir la velocidad de venta
  @dias_alerta    INT = 7,    -- alerta si se acaba en <= estos días
  @dias_objetivo  INT = 30    -- pedir lo necesario para cubrir estos días
AS
BEGIN
  SET NOCOUNT ON;

  ;WITH ventas AS (
      SELECT sd.product_id, SUM(sd.quantity) AS vendido
      FROM sale_detail sd                          -- << CONFIRMA esta tabla
      INNER JOIN sales s ON s.id = sd.sale_id
      WHERE s.datee >= DATEADD(DAY, -@dias_ventana, CAST(GETDATE() AS DATE))
      GROUP BY sd.product_id
  )
  SELECT
      p.id,
      p.nombre,
      p.stock,
      v.vendido AS vendido_ventana,
      CAST(v.vendido * 1.0 / NULLIF(@dias_ventana, 0) AS DECIMAL(12,2)) AS prom_diario,
      CAST(p.stock / NULLIF(v.vendido * 1.0 / @dias_ventana, 0) AS INT)  AS dias_restantes,
      CASE
        WHEN CEILING(v.vendido * 1.0 / @dias_ventana * @dias_objetivo) - p.stock > 0
        THEN CEILING(v.vendido * 1.0 / @dias_ventana * @dias_objetivo) - p.stock
        ELSE 0
      END AS sugerido
  FROM products p
  INNER JOIN ventas v ON v.product_id = p.id
  WHERE p.active = 1
    AND v.vendido > 0
    AND (p.stock / NULLIF(v.vendido * 1.0 / @dias_ventana, 0)) <= @dias_alerta
  ORDER BY dias_restantes ASC;
END
GO

/* ---------- sp_sales_by_payment (SQL_STORED_PROCEDURE) ---------- */
/* sp_sales_by_payment
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* Ventas por metodo de pago en los ultimos @days dias */
CREATE OR ALTER PROCEDURE dbo.sp_sales_by_payment
    @days INT = 30
AS
BEGIN
    SET NOCOUNT ON;
    SELECT
        payment_method,
        COUNT(*)     AS tickets,
        SUM(total)   AS total
    FROM sales
    WHERE datee >= DATEADD(DAY, -@days, CAST(GETDATE() AS DATE))
    GROUP BY payment_method
    ORDER BY SUM(total) DESC;
END
GO

/* ---------- sp_security_by_cashier (SQL_STORED_PROCEDURE) ---------- */
/* sp_security_by_cashier
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* 4) Resumen de eventos por cajero (para alertas) */
CREATE OR ALTER PROCEDURE dbo.sp_security_by_cashier
    @from DATE = NULL, @to DATE = NULL
AS
BEGIN
    SET NOCOUNT ON;
    IF @from IS NULL SET @from = DATEADD(DAY, -30, CAST(GETDATE() AS DATE));
    IF @to   IS NULL SET @to   = CAST(GETDATE() AS DATE);

    SELECT u.id AS user_id, u.usuario AS cajero,
        SUM(CASE WHEN e.event_type = 'VOID_SALE'      THEN 1 ELSE 0 END) AS anuladas,
        SUM(CASE WHEN e.event_type = 'REFUND'         THEN 1 ELSE 0 END) AS devoluciones,
        SUM(CASE WHEN e.event_type = 'DRAWER_NO_SALE' THEN 1 ELSE 0 END) AS cajon_sin_venta,
        SUM(CASE WHEN e.event_type = 'ITEM_REMOVED'   THEN 1 ELSE 0 END) AS eliminados,
        SUM(CASE WHEN e.event_type IN ('DISCOUNT','PRICE_CHANGE') THEN 1 ELSE 0 END) AS descuentos,
        SUM(CASE WHEN e.event_type = 'INV_ADJUST'     THEN 1 ELSE 0 END) AS ajustes_inv,
        SUM(ISNULL(e.amount, 0)) AS monto_riesgo
    FROM dbo.users u
    LEFT JOIN dbo.security_events e
        ON e.user_id = u.id AND e.datee >= @from AND e.datee < DATEADD(DAY, 1, @to)
    WHERE u.rol IN ('cajero','supervisor','admin')
    GROUP BY u.id, u.usuario
    ORDER BY monto_riesgo DESC;
END
GO

/* ---------- sp_setup_inicial (SQL_STORED_PROCEDURE) ---------- */
/* sp_setup_inicial
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
CREATE OR ALTER PROCEDURE [dbo].[sp_setup_inicial]
    @usuario        NVARCHAR(50),
    @password       NVARCHAR(255),
    @business_name  NVARCHAR(200),
    @address        NVARCHAR(300) = NULL,
    @phone          NVARCHAR(50)  = NULL,
    @rfc            NVARCHAR(50)  = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    IF EXISTS (SELECT 1 FROM dbo.users)
    BEGIN
        RAISERROR('El sistema ya fue configurado.', 16, 1);
        RETURN;
    END

    IF LEN(LTRIM(RTRIM(@usuario))) < 3
    BEGIN
        RAISERROR('El usuario debe tener al menos 3 caracteres.', 16, 1);
        RETURN;
    END

    IF LEN(@password) < 6
    BEGIN
        RAISERROR('La contrasena debe tener al menos 6 caracteres.', 16, 1);
        RETURN;
    END

    BEGIN TRY
        BEGIN TRAN;

        -- Mismo hash que sp_login_user y sp_add_user
        INSERT INTO dbo.users (usuario, password_hash, rol, active, creation_date)
        VALUES (
            @usuario,
            CONVERT(NVARCHAR(255), HASHBYTES('SHA2_256', @password), 2),
            N'admin',
            1,
            GETDATE()
        );

        DECLARE @user_id INT = SCOPE_IDENTITY();

        IF NOT EXISTS (SELECT 1 FROM dbo.business_config)
        BEGIN
            INSERT INTO dbo.business_config
                (business_name, address, phone, rfc, invoicing_enabled, updated_at)
            VALUES
                (@business_name, @address, @phone, @rfc, 0, GETDATE());
        END

        COMMIT TRAN;

        SELECT @user_id AS user_id, @usuario AS usuario;
    END TRY
    BEGIN CATCH
        IF XACT_STATE() <> 0 ROLLBACK TRAN;
        DECLARE @msg NVARCHAR(4000) = ERROR_MESSAGE();
        RAISERROR(@msg, 16, 1);
    END CATCH
END
GO

/* ---------- sp_setup_status (SQL_STORED_PROCEDURE) ---------- */
/* sp_setup_status
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* ============================================================
   Wybix - SPs del asistente de primer arranque
   Colocar en electron/migrations/
   Sin USE: el runner ya esta conectado a la base correcta.
   ============================================================ */

CREATE OR ALTER PROCEDURE [dbo].[sp_setup_status]
AS
BEGIN
    SET NOCOUNT ON;
    SELECT
        (SELECT COUNT(*) FROM dbo.users WHERE active = 1)   AS usuarios,
        (SELECT COUNT(*) FROM dbo.business_config)          AS negocio_configurado;
END
GO

/* ---------- sp_supplier_save (SQL_STORED_PROCEDURE) ---------- */
/* sp_supplier_save
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
CREATE OR ALTER PROCEDURE dbo.sp_supplier_save
    @id       INT = NULL,
    @nombre   NVARCHAR(100),
    @telefono NVARCHAR(20)  = NULL,
    @correo   NVARCHAR(100) = NULL,
    @rfc      NVARCHAR(20)  = NULL
AS
BEGIN
    SET NOCOUNT ON;
    IF (@id IS NULL OR @id = 0)
    BEGIN
        INSERT INTO CAT_suppliers (nombre, telefono, correo, rfc)
        VALUES (@nombre, @telefono, @correo, @rfc);
        SELECT SCOPE_IDENTITY() AS id;
    END
    ELSE
    BEGIN
        UPDATE CAT_suppliers
        SET nombre = @nombre, telefono = @telefono, correo = @correo, rfc = @rfc
        WHERE id = @id;
        SELECT @id AS id;
    END
END
GO

/* ---------- sp_top_customers (SQL_STORED_PROCEDURE) ---------- */
/* sp_top_customers
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
CREATE OR ALTER PROCEDURE dbo.sp_top_customers
    @limit INT = 10
AS
BEGIN
    SET NOCOUNT ON;
    SELECT TOP (@limit)
        c.id,
        c.customerName AS nombre,
        COUNT(s.id)    AS compras,
        SUM(s.total)   AS total
    FROM sales s
    JOIN customers c ON c.id = s.customer_id
    WHERE s.customer_id IS NOT NULL
    GROUP BY c.id, c.customerName
    ORDER BY SUM(s.total) DESC;
END
GO
