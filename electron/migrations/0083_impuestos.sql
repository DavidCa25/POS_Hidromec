/* ============================================================
   0083 — impuestos

   Generada con scripts/db/generar-migracion.mjs desde los archivos
   canonicos de sql/. No editar a mano: regenerar.

   Idempotente: todos los objetos usan CREATE OR ALTER, y los tipos
   comprueban su existencia antes de crearse. Se puede reejecutar.

   Incluye el bloque de esquema sql/schema/changes/0083_impuestos.sql (tablas,
   columnas, seed). Cada paso de ese bloque comprueba su existencia.
   ============================================================ */

/* ========== ESQUEMA: sql/schema/changes/0083_impuestos.sql ========== */
/* ============================================================
   0083 — Impuestos además del IVA (esquema)

   CAT_impuestos           el catálogo: IEPS por tasa o por cuota, e
                           impuestos locales (hospedaje). Se activan, se
                           corrigen las tasas cuando cambia la ley y se
                           agregan los propios. El IVA NO vive aquí: sigue en
                           products.tasa_iva / objeto_impuesto, como siempre.
   product_impuestos       qué impuestos lleva cada producto. Para uno por
                           cuota, cuántas unidades de la cuota trae UNA pieza
                           («Coca 600 ml» = 0.6 litros).
   sale_detail.base_neta   la foto al vender: el precio sin NINGÚN impuesto
                           (lo que de verdad gana el negocio) y cuánto fue de
   sale_detail.otros_impuestos  otros impuestos. NULL = el renglón solo
                           llevaba IVA: los reportes usan la cuenta de antes.
   sale_detail_impuestos   el desglose por impuesto de cada renglón vendido,
                           con la tasa o cuota de ese día.

   El precio de Wybix INCLUYE todos los impuestos. Para un renglón:
     P = (B·(1 + ΣTasaIEPS) + ΣCuotaIEPS)·(1 + IVA) + B·ΣTasaLocal + ΣCuotaLocal
   El IEPS forma parte de la base del IVA; un impuesto local, no.

   Las tasas sembradas son las conocidas al escribir esto; las cuotas (pesos
   por litro, por cigarro) cambian cada año y se siembran APAGADAS y sin
   valor, para que el negocio capture la vigente. Ninguna se enciende sola en
   un producto: solo existe el catálogo.

   Aditiva: nada existente cambia de valor.
   ============================================================ */

IF OBJECT_ID(N'dbo.CAT_impuestos', N'U') IS NULL
CREATE TABLE dbo.CAT_impuestos (
    id           INT IDENTITY(1, 1) NOT NULL CONSTRAINT PK_CAT_impuestos PRIMARY KEY CLUSTERED,
    clave        VARCHAR(40)    NOT NULL,
    nombre       NVARCHAR(80)   NOT NULL,
    clase        VARCHAR(10)    NOT NULL,
    factor       VARCHAR(6)     NOT NULL,
    tasa         DECIMAL(9, 6)  NULL,
    cuota        DECIMAL(12, 4) NULL,
    unidad       NVARCHAR(20)   NULL,
    en_base_iva  BIT            NOT NULL CONSTRAINT DF_CAT_impuestos_base_iva DEFAULT ((1)),
    nota         NVARCHAR(200)  NULL,
    activo       BIT            NOT NULL CONSTRAINT DF_CAT_impuestos_activo DEFAULT ((1)),
    sistema      BIT            NOT NULL CONSTRAINT DF_CAT_impuestos_sistema DEFAULT ((0)),
    actualizado_en DATETIME2(0) NOT NULL CONSTRAINT DF_CAT_impuestos_actualizado DEFAULT (SYSDATETIME()),
    CONSTRAINT UX_CAT_impuestos_clave UNIQUE (clave),
    CONSTRAINT CK_CAT_impuestos_clase CHECK (clase IN ('IEPS', 'LOCAL')),
    CONSTRAINT CK_CAT_impuestos_factor CHECK (factor IN ('Tasa', 'Cuota')),
    CONSTRAINT CK_CAT_impuestos_valor CHECK ((factor = 'Tasa' AND cuota IS NULL AND (tasa IS NULL OR (tasa > 0 AND tasa <= 5)))
                                          OR (factor = 'Cuota' AND tasa IS NULL AND (cuota IS NULL OR cuota > 0))),
    /* Encendido sin valor no se puede: un producto calcularía con nada. */
    CONSTRAINT CK_CAT_impuestos_activo CHECK (activo = 0 OR tasa IS NOT NULL OR cuota IS NOT NULL)
);
GO

IF OBJECT_ID(N'dbo.product_impuestos', N'U') IS NULL
CREATE TABLE dbo.product_impuestos (
    product_id   INT            NOT NULL,
    impuesto_id  INT            NOT NULL,
    cantidad     DECIMAL(12, 4) NULL,
    CONSTRAINT PK_product_impuestos PRIMARY KEY CLUSTERED (product_id, impuesto_id),
    CONSTRAINT FK_product_impuestos_producto FOREIGN KEY (product_id) REFERENCES dbo.products (id),
    CONSTRAINT FK_product_impuestos_impuesto FOREIGN KEY (impuesto_id) REFERENCES dbo.CAT_impuestos (id),
    CONSTRAINT CK_product_impuestos_cantidad CHECK (cantidad IS NULL OR cantidad > 0)
);
GO

IF COL_LENGTH(N'dbo.sale_detail', N'base_neta') IS NULL
    ALTER TABLE dbo.sale_detail ADD base_neta DECIMAL(14, 4) NULL;
GO
IF COL_LENGTH(N'dbo.sale_detail', N'otros_impuestos') IS NULL
    ALTER TABLE dbo.sale_detail ADD otros_impuestos DECIMAL(14, 4) NULL;
GO

IF OBJECT_ID(N'dbo.sale_detail_impuestos', N'U') IS NULL
CREATE TABLE dbo.sale_detail_impuestos (
    id              INT IDENTITY(1, 1) NOT NULL CONSTRAINT PK_sale_detail_impuestos PRIMARY KEY CLUSTERED,
    sale_detail_id  INT            NOT NULL,
    impuesto_id     INT            NOT NULL,
    nombre          NVARCHAR(80)   NOT NULL,
    clase           VARCHAR(10)    NOT NULL,
    factor          VARCHAR(6)     NOT NULL,
    tasa            DECIMAL(9, 6)  NULL,
    cuota           DECIMAL(12, 4) NULL,
    cantidad        DECIMAL(14, 4) NULL,
    base            DECIMAL(14, 4) NOT NULL,
    importe         DECIMAL(14, 4) NOT NULL,
    CONSTRAINT FK_sale_detail_impuestos_detalle FOREIGN KEY (sale_detail_id) REFERENCES dbo.sale_detail (id),
    CONSTRAINT FK_sale_detail_impuestos_impuesto FOREIGN KEY (impuesto_id) REFERENCES dbo.CAT_impuestos (id)
);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_sale_detail_impuestos_detalle' AND object_id = OBJECT_ID(N'dbo.sale_detail_impuestos'))
CREATE INDEX IX_sale_detail_impuestos_detalle ON dbo.sale_detail_impuestos (sale_detail_id) INCLUDE (impuesto_id, importe);
GO

/* ---------------------------------------------------------- semilla */
MERGE dbo.CAT_impuestos AS t
USING (VALUES
  ('IEPS_ALIMENTOS',        N'IEPS alimentos no básicos (alta densidad calórica)', 'IEPS',  'Tasa',  0.080000, NULL, NULL,        1, N'Botanas, dulces, chocolates, galletas, pan dulce empacado… con 275 kcal o más por cada 100 g.', 1),
  ('IEPS_ALCOHOL_14',       N'IEPS bebidas alcohólicas y cerveza hasta 14°',       'IEPS',  'Tasa',  0.265000, NULL, NULL,        1, N'Cerveza, vino de mesa, sidra y bebidas con hasta 14° G.L.', 1),
  ('IEPS_ALCOHOL_20',       N'IEPS bebidas alcohólicas de más de 14° hasta 20°',   'IEPS',  'Tasa',  0.300000, NULL, NULL,        1, N'Vinos generosos, licores suaves.', 1),
  ('IEPS_ALCOHOL_MAS_20',   N'IEPS bebidas alcohólicas de más de 20°',             'IEPS',  'Tasa',  0.530000, NULL, NULL,        1, N'Tequila, mezcal, whisky, ron, vodka…', 1),
  ('IEPS_ENERGIZANTES',     N'IEPS bebidas energizantes',                          'IEPS',  'Tasa',  0.250000, NULL, NULL,        1, NULL, 1),
  ('IEPS_PLAGUICIDAS_1_2',  N'IEPS plaguicidas categorías 1 y 2',                  'IEPS',  'Tasa',  0.090000, NULL, NULL,        1, N'Según la categoría de toxicidad de la etiqueta.', 1),
  ('IEPS_PLAGUICIDAS_3',    N'IEPS plaguicidas categoría 3',                       'IEPS',  'Tasa',  0.070000, NULL, NULL,        1, NULL, 1),
  ('IEPS_PLAGUICIDAS_4',    N'IEPS plaguicidas categoría 4',                       'IEPS',  'Tasa',  0.060000, NULL, NULL,        1, NULL, 1),
  ('IEPS_BEBIDAS_AZUCAR',   N'IEPS bebidas saborizadas con azúcar',                'IEPS',  'Cuota', NULL,     NULL, N'litro',    0, N'Refrescos, jugos y aguas con azúcar añadida. Pesos por litro: captura la cuota vigente del año.', 1),
  ('IEPS_TABACO',           N'IEPS tabacos labrados (tasa)',                       'IEPS',  'Tasa',  NULL,     NULL, NULL,        0, N'Además lleva una cuota por cigarro: créala aparte. Captura la tasa vigente del año.', 1),
  ('IEPS_TABACO_CUOTA',     N'IEPS cigarros (cuota por cigarro)',                  'IEPS',  'Cuota', NULL,     NULL, N'cigarro',  0, N'Pesos por cigarro: captura la cuota vigente del año.', 1),
  ('LOCAL_HOSPEDAJE',       N'Impuesto sobre hospedaje (estatal)',                 'LOCAL', 'Tasa',  NULL,     NULL, NULL,        0, N'Entre 2% y 5% según el estado. No forma parte de la base del IVA.', 1)
) AS s (clave, nombre, clase, factor, tasa, cuota, unidad, activo, nota, sistema)
   ON t.clave = s.clave
WHEN NOT MATCHED THEN
  INSERT (clave, nombre, clase, factor, tasa, cuota, unidad, en_base_iva, nota, activo, sistema)
  VALUES (s.clave, s.nombre, s.clase, s.factor, s.tasa, s.cuota, s.unidad, CASE WHEN s.clase = 'LOCAL' THEN 0 ELSE 1 END, s.nota, s.activo, s.sistema);
GO

/* ---------- sp_cloud_daily_profit (SQL_STORED_PROCEDURE) ---------- */
/* sp_cloud_daily_profit
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
CREATE OR ALTER PROCEDURE dbo.sp_cloud_daily_profit
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @hoy DATE = CAST(GETDATE() AS DATE);

    /* 0062: la misma utilidad que Estadísticas y el Estado de resultados.
       Antes restaba `products.last_cost`, columna que no existe, a un precio
       con IVA. Ahora: venta SIN IVA menos el costo congelado del renglón. */
    DECLARE @base DECIMAL(18, 4), @costo DECIMAL(18, 4);
    SELECT @base = ISNULL(SUM(x.base), 0), @costo = ISNULL(SUM(x.costo), 0)
    FROM dbo.sales s
    JOIN dbo.sale_detail sd ON sd.sale_id = s.id
    JOIN dbo.products p ON p.id = sd.product_id
    CROSS APPLY (SELECT
        /* 0083: con IEPS u otro impuesto, la base sin NINGÚN impuesto de la foto. */
        COALESCE(sd.base_neta, CASE WHEN ISNULL(sd.tax_object, '02') = '02'
             THEN sd.subtotal / (1 + ISNULL(sd.tax_rate, ISNULL(p.tasa_iva, 0)))
             ELSE sd.subtotal END) AS base,
        sd.quantity * COALESCE(sd.unit_cost, p.cost, 0) AS costo) x
    WHERE s.datee >= @hoy
      AND s.datee <  DATEADD(DAY, 1, @hoy);

    /* 0069: lo que las plataformas descuentan (promociones, reembolsos y
       comisión, sin IVA).
         · confirmado: de liquidaciones ya confirmadas, repartido en hoy;
         · estimado: las ventas de hoy pagadas en plataforma que ninguna
           liquidación tiene aún, al porcentaje de la ÚLTIMA liquidación
           confirmada de esa plataforma. Sin liquidación previa no se estima.
       Las retenciones no son gasto: no se restan. */
    DECLARE @confirmado DECIMAL(18, 4) = ISNULL((
        SELECT SUM(a.discount_base + a.refund_base + a.fee_base)
          FROM dbo.platform_settlement_allocations a
          JOIN dbo.platform_settlements t ON t.id = a.settlement_id AND t.status = 'CONFIRMADA'
         WHERE a.alloc_date = @hoy), 0);

    DECLARE @estimado DECIMAL(18, 4) = ISNULL((
        SELECT SUM(CAST(ISNULL(sp.amount, s.total) AS DECIMAL(18, 4)) * r.tasa)
          FROM dbo.sales s
          JOIN dbo.platform_channels pc ON pc.channel_id = JSON_VALUE(s.commercial_snapshot, '$.channel')
          LEFT JOIN dbo.sale_payments sp ON sp.sale_id = s.id AND sp.payment_method = 'PLATAFORMA'
          CROSS APPLY (SELECT TOP (1)
                    (t.marketing / (1 + t.iva_rate) + t.refunds / (1 + t.iva_rate) + t.other_adjustments
                     + t.service_fees / (1 + t.iva_rate)) / t.gross_sales AS tasa
                 FROM dbo.platform_settlements t
                WHERE t.platform = pc.platform AND t.status = 'CONFIRMADA' AND t.gross_sales > 0
                ORDER BY t.period_to DESC, t.id DESC) r
         WHERE s.datee >= @hoy AND s.datee < DATEADD(DAY, 1, @hoy)
           AND (sp.id IS NOT NULL OR (s.payment_method = 'PLATAFORMA' AND NOT EXISTS (SELECT 1 FROM dbo.sale_payments x WHERE x.sale_id = s.id)))
           AND NOT EXISTS (SELECT 1 FROM dbo.platform_settlement_allocations a
                             JOIN dbo.platform_settlements t ON t.id = a.settlement_id AND t.status = 'CONFIRMADA'
                            WHERE a.sale_id = s.id)), 0);

    SELECT
        CAST(@base - @costo - @confirmado - @estimado AS DECIMAL(18, 4)) AS utilidad,
        -- Venta sin IVA: base del margen %
        @base AS venta_bruta,
        CAST(@confirmado AS DECIMAL(18, 2)) AS plataformas_confirmado,
        CAST(@estimado AS DECIMAL(18, 2)) AS plataformas_estimado;
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
-- Utilidad = (precio cobrado SIN IVA) - (costo del renglón).
-- 0062: el costo es el CONGELADO al vender (sale_detail.unit_cost), no el
-- costo de hoy: cambiar un costo ya no reescribe la utilidad de días pasados.
-- La tasa de IVA también es la congelada del renglón. Los renglones viejos
-- sin costo o sin tasa usan los del producto (misma regla que
-- sp_income_statement).
-- 0069: menos lo que las plataformas descontaron (promociones, reembolsos y
-- comision sin IVA) de las liquidaciones confirmadas, en el dia de la venta.
CREATE OR ALTER PROCEDURE dbo.sp_get_profit_overview
    @from_date DATE = NULL,
    @to_date   DATE = NULL
AS
BEGIN
    SET NOCOUNT ON;

    IF @from_date IS NULL SET @from_date = DATEADD(DAY, -6, CAST(GETDATE() AS DATE));
    IF @to_date   IS NULL SET @to_date   = CAST(GETDATE() AS DATE);

    ;WITH v AS (
    SELECT
        CAST(s.datee AS DATE) AS datee,
        SUM(
            /* 0083: con IEPS u otro impuesto, la base sin NINGÚN impuesto de la foto. */
            COALESCE(sd.base_neta, CASE WHEN ISNULL(sd.tax_object, '02') = '02'
                 THEN sd.subtotal / (1 + ISNULL(sd.tax_rate, ISNULL(p.tasa_iva, 0)))
                 ELSE sd.subtotal END)
          - sd.quantity * COALESCE(sd.unit_cost, p.cost, 0)
        ) AS profit
    FROM dbo.sales s
    INNER JOIN dbo.sale_detail sd ON sd.sale_id = s.id
    INNER JOIN dbo.products p     ON p.id = sd.product_id
    WHERE s.datee >= @from_date
      AND s.datee <  DATEADD(DAY, 1, @to_date)
    GROUP BY CAST(s.datee AS DATE)),
    pa AS (
    SELECT a.alloc_date, SUM(a.discount_base + a.refund_base + a.fee_base) AS descontado
      FROM dbo.platform_settlement_allocations a
      JOIN dbo.platform_settlements t ON t.id = a.settlement_id AND t.status = 'CONFIRMADA'
     WHERE a.alloc_date BETWEEN @from_date AND @to_date
     GROUP BY a.alloc_date)
    SELECT v.datee, CAST(v.profit - ISNULL(pa.descontado, 0) AS DECIMAL(18, 4)) AS profit
      FROM v LEFT JOIN pa ON pa.alloc_date = v.datee
     ORDER BY v.datee;
END;
GO

/* ---------- sp_get_weekly_profit (SQL_STORED_PROCEDURE) ---------- */
/* sp_get_weekly_profit
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
-- =============================================
-- Author:		<David Casillas>
-- Create date: <06-12-2025>
-- Description:	<Obtener una utilidad por semana>
-- =============================================
CREATE OR ALTER PROCEDURE dbo.sp_get_weekly_profit
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @from DATE = DATEADD(DAY, -6, CAST(GETDATE() AS DATE));
    DECLARE @to   DATE = DATEADD(DAY,  1, CAST(GETDATE() AS DATE));

    ;WITH daily AS (
        SELECT
            CAST(s.datee AS DATE)                           AS sale_date,
            /* 0062: venta sin IVA y costo CONGELADO del renglón (antes: venta con
               IVA contra el costo de hoy del producto). */
            /* 0083: con IEPS u otro impuesto, la base sin NINGÚN impuesto de la foto. */
            SUM(COALESCE(d.base_neta, CASE WHEN ISNULL(d.tax_object, '02') = '02'
                     THEN d.subtotal / (1 + ISNULL(d.tax_rate, ISNULL(p.tasa_iva, 0)))
                     ELSE d.subtotal END))                 AS total_sales,
            SUM(d.quantity * COALESCE(d.unit_cost, p.cost, 0)) AS total_cost
        FROM sales        AS s
        JOIN sale_detail  AS d ON d.sale_id   = s.id
        JOIN products     AS p ON p.id        = d.product_id
        WHERE s.datee >= @from
          AND s.datee <  @to
        GROUP BY CAST(s.datee AS DATE)
    )
    /* 0069: lo que las plataformas descontaron (promociones y reembolsos
       bajan la venta; la comision sin IVA, la utilidad), de las liquidaciones
       confirmadas, en el dia de la venta. */
    , pa AS (
        SELECT a.alloc_date, SUM(a.discount_base + a.refund_base) AS descuento, SUM(a.fee_base) AS comision
          FROM dbo.platform_settlement_allocations a
          JOIN dbo.platform_settlements t ON t.id = a.settlement_id AND t.status = 'CONFIRMADA'
         WHERE a.alloc_date >= @from AND a.alloc_date < @to
         GROUP BY a.alloc_date
    )
    SELECT
        d.sale_date,
        d.total_sales - ISNULL(pa.descuento, 0) AS total_sales,
        d.total_cost,
        (d.total_sales - ISNULL(pa.descuento, 0) - d.total_cost - ISNULL(pa.comision, 0)) AS profit
    FROM daily d
    LEFT JOIN pa ON pa.alloc_date = d.sale_date
    ORDER BY d.sale_date;
END;
GO

/* ---------- sp_impuesto_guardar (SQL_STORED_PROCEDURE) ---------- */
/* sp_impuesto_guardar
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* ====================== sp_impuesto_guardar (0083) ======================
   Crea (@id NULL) o corrige un impuesto del catálogo. Cambiar una tasa o
   una cuota vale para las ventas de AHORA en adelante: las pasadas guardaron
   la suya en sale_detail_impuestos.

   De uno del sistema se corrige el valor, la nota y si está encendido; el
   nombre, la clase y el factor no (son la definición que se sembró).
   No se borra: se apaga. Apagarlo deja de calcularlo en las ventas nuevas
   aunque siga marcado en los productos.
   ======================================================================= */
CREATE OR ALTER PROCEDURE dbo.sp_impuesto_guardar
    @id          INT = NULL,
    @nombre      NVARCHAR(80),
    @clase       VARCHAR(10),
    @factor      VARCHAR(6),
    @tasa        DECIMAL(9, 6) = NULL,
    @cuota       DECIMAL(12, 4) = NULL,
    @unidad      NVARCHAR(20) = NULL,
    @en_base_iva BIT = NULL,
    @nota        NVARCHAR(200) = NULL,
    @activo      BIT = 1
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    /* De uno del sistema manda su definición, no la que llegue. */
    IF @id IS NOT NULL
        SELECT @nombre = nombre, @clase = clase, @factor = factor, @unidad = unidad, @en_base_iva = en_base_iva
          FROM dbo.CAT_impuestos WHERE id = @id AND sistema = 1;

    SET @nombre = LTRIM(RTRIM(ISNULL(@nombre, N'')));
    IF @factor = 'Tasa' SET @cuota = NULL;
    IF @factor = 'Cuota' SET @tasa = NULL;
    IF @nombre = N'' THROW 51000, 'El impuesto necesita un nombre.', 1;
    IF @clase NOT IN ('IEPS', 'LOCAL') THROW 51000, 'Clase de impuesto desconocida.', 1;
    IF @factor NOT IN ('Tasa', 'Cuota') THROW 51000, 'El impuesto es por tasa o por cuota.', 1;
    IF @tasa IS NOT NULL AND (@tasa <= 0 OR @tasa > 5) THROW 51000, 'La tasa va de 0.01% a 500%.', 1;
    IF @cuota IS NOT NULL AND @cuota <= 0 THROW 51000, 'La cuota debe ser mayor a cero.', 1;
    IF @activo = 1 AND @tasa IS NULL AND @cuota IS NULL
        THROW 51000, 'Para encenderlo, captura su tasa o su cuota.', 1;

    IF @id IS NULL
    BEGIN
        IF EXISTS (SELECT 1 FROM dbo.CAT_impuestos WHERE nombre = @nombre)
            THROW 51000, 'Ya hay un impuesto con ese nombre.', 1;
        INSERT INTO dbo.CAT_impuestos (clave, nombre, clase, factor, tasa, cuota, unidad, en_base_iva, nota, activo, sistema)
        VALUES (CONCAT('TMP_', REPLACE(CONVERT(VARCHAR(36), NEWID()), '-', '')), @nombre, @clase, @factor, @tasa, @cuota, NULLIF(LTRIM(RTRIM(@unidad)), N''),
                ISNULL(@en_base_iva, CASE WHEN @clase = 'LOCAL' THEN 0 ELSE 1 END), NULLIF(LTRIM(RTRIM(@nota)), N''), @activo, 0);
        SET @id = SCOPE_IDENTITY();
        UPDATE dbo.CAT_impuestos SET clave = CONCAT('PROPIO_', @id) WHERE id = @id;
    END
    ELSE
    BEGIN
        IF NOT EXISTS (SELECT 1 FROM dbo.CAT_impuestos WHERE id = @id) THROW 51000, 'Ese impuesto no existe.', 1;
        IF EXISTS (SELECT 1 FROM dbo.CAT_impuestos WHERE nombre = @nombre AND id <> @id)
            THROW 51000, 'Ya hay un impuesto con ese nombre.', 1;
        UPDATE dbo.CAT_impuestos
           SET nombre = @nombre, clase = @clase, factor = @factor, tasa = @tasa, cuota = @cuota,
               unidad = NULLIF(LTRIM(RTRIM(@unidad)), N''),
               en_base_iva = ISNULL(@en_base_iva, en_base_iva),
               nota = NULLIF(LTRIM(RTRIM(@nota)), N''),
               activo = @activo,
               actualizado_en = SYSDATETIME()
         WHERE id = @id;
    END

    SELECT @id AS id;
END
GO

/* ---------- sp_impuestos_listar (SQL_STORED_PROCEDURE) ---------- */
/* sp_impuestos_listar
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* ====================== sp_impuestos_listar (0083) ======================
   El catálogo de impuestos además del IVA. @todos = 0: solo los encendidos
   (lo que se puede poner en un producto); 1: todos, para Configuración.
   `productos` dice en cuántos productos está: uno usado no se borra.
   ======================================================================= */
CREATE OR ALTER PROCEDURE dbo.sp_impuestos_listar
    @todos BIT = 0
AS
BEGIN
    SET NOCOUNT ON;
    SELECT i.id, i.clave, i.nombre, i.clase, i.factor, i.tasa, i.cuota, i.unidad, i.en_base_iva, i.nota,
           i.activo, i.sistema, i.actualizado_en,
           (SELECT COUNT(*) FROM dbo.product_impuestos pi WHERE pi.impuesto_id = i.id) AS productos
      FROM dbo.CAT_impuestos i
     WHERE @todos = 1 OR i.activo = 1
     ORDER BY i.clase, i.activo DESC, i.nombre;
END
GO

/* ---------- sp_income_statement (SQL_STORED_PROCEDURE) ---------- */
/* sp_income_statement
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* ===================== sp_income_statement (0062) =====================
   ESTADO DE RESULTADOS de un periodo: cuánto ganó de verdad el negocio.

       Ventas netas (sin IVA, menos devoluciones)
     − Costo de lo vendido (el costo CONGELADO de cada renglón al venderse)
     = Utilidad bruta
     − Mermas de producto terminado (lo que se tiró)
     − Faltantes de inventario por conteo (valuados al costo actual)
     − Egresos (renta, luz, servicios...) y pagos al personal
     − Comisiones de plataforma, sin IVA (0069)
     = Utilidad de operación

   0069 · Liquidaciones de plataforma. Lo que Uber Eats, Didi o Rappi
   descuentan del depósito entra por las liquidaciones CONFIRMADAS, repartido
   entre sus ventas (platform_settlement_allocations), en el día de la venta:
     · promociones pagadas por el negocio y reembolsos: bajan la venta neta
       (y su IVA baja el IVA trasladado);
     · comisión / tasa de servicio: gasto, sin IVA (el IVA es acreditable);
     · retenciones ISR / IVA: se informan, NO son gasto.
   El egreso de comisión que crea la liquidación (concepto PLATAFORMA) no se
   suma con los demás egresos: ya está en el reparto, contaría doble.

   Lo que NO es gasto aquí, a propósito:
     · Las COMPRAS: son inventario. Se vuelven costo cuando se venden.
     · Los pagos a proveedores: pagan esas compras.
     · La merma DE PRODUCCIÓN: ya está dentro del costo de cada pieza buena
       (sp_production_finish reparte el costo de la tanda entre las buenas).
   Las ventas a crédito cuentan el día que se venden, no el día que se cobran.

   Precio con IVA: sale_detail guarda el precio cobrado (con IVA si el
   producto es objeto '02'). La base sin IVA se saca con la tasa congelada
   del renglón; los renglones viejos sin tasa usan la del producto.
   Costo: sale_detail.unit_cost (congelado al vender). Los renglones viejos
   sin costo usan el costo actual del producto y se cuentan aparte para que
   el dueño sepa cuánto de la utilidad es estimado.

     1  resumen          periodo pedido y periodo anterior del mismo largo
     2  egresos          por concepto (GENERAL / PERSONAL)
     3  categorías       ventas, costo, utilidad y margen por categoría
     4  días             serie diaria (ventas netas, costo, gastos, utilidad)
     5  productos        los 15 que más utilidad dejaron
     6  productos        los que se vendieron por debajo del costo
     7  canales          venta neta, costo, plataforma y utilidad por canal
   ==================================================================== */
CREATE OR ALTER PROCEDURE dbo.sp_income_statement
    @desde DATE = NULL,
    @hasta DATE = NULL
AS
BEGIN
    SET NOCOUNT ON;
    IF @hasta IS NULL SET @hasta = CAST(GETDATE() AS DATE);
    IF @desde IS NULL SET @desde = DATEFROMPARTS(YEAR(@hasta), MONTH(@hasta), 1);
    IF @desde > @hasta THROW 51000, 'La fecha inicial no puede ser posterior a la final.', 1;
    IF DATEDIFF(DAY, @desde, @hasta) > 366 THROW 51000, 'El periodo maximo es de un ano.', 1;

    DECLARE @dias INT = DATEDIFF(DAY, @desde, @hasta) + 1;
    DECLARE @ant_desde DATE = DATEADD(DAY, -@dias, @desde), @ant_hasta DATE = DATEADD(DAY, -1, @desde);

    /* --------- Renglones vendidos de los DOS periodos, ya con base y costo -------- */
    SELECT CAST(s.datee AS DATE) AS dia,
           CASE WHEN s.datee >= @desde THEN 1 ELSE 0 END AS actual,
           s.id AS sale_id, d.product_id, d.quantity,
           CAST(d.subtotal AS DECIMAL(14, 4)) AS cobrado,
           /* 0083: con IEPS u otro impuesto, la base sin NINGÚN impuesto de la foto. */
           CAST(COALESCE(d.base_neta, CASE WHEN ISNULL(d.tax_object, '02') = '02'
                     THEN d.subtotal / (1 + ISNULL(d.tax_rate, ISNULL(p.tasa_iva, 0)))
                     ELSE d.subtotal END) AS DECIMAL(14, 4)) AS base,
           CAST(d.quantity * COALESCE(d.unit_cost, p.cost, 0) AS DECIMAL(14, 4)) AS costo,
           CASE WHEN d.unit_cost IS NULL THEN 1 ELSE 0 END AS costo_estimado,
           TRY_CONVERT(DECIMAL(12, 2), JSON_VALUE(s.commercial_snapshot, '$.discount')) AS descuento_venta,
           ISNULL(JSON_VALUE(s.commercial_snapshot, '$.channel'), N'LOCAL') AS canal,
           JSON_VALUE(s.commercial_snapshot, '$.channelName') AS canal_nombre
      INTO #v
      FROM dbo.sales s
      JOIN dbo.sale_detail d ON d.sale_id = s.id
      JOIN dbo.products p ON p.id = d.product_id
     WHERE s.datee >= @ant_desde AND s.datee < DATEADD(DAY, 1, @hasta);

    /* --------- Devoluciones (por la fecha en que se devolvió) -------- */
    CREATE TABLE #r (dia DATE NOT NULL, actual BIT NOT NULL, cobrado DECIMAL(14, 4) NOT NULL,
                     base DECIMAL(14, 4) NOT NULL, costo DECIMAL(14, 4) NOT NULL, product_id INT NULL, quantity DECIMAL(12, 2) NULL,
                     canal NVARCHAR(64) COLLATE DATABASE_DEFAULT NULL);
    INSERT INTO #r (dia, actual, cobrado, base, costo, product_id, quantity, canal)
    SELECT CAST(f.datee AS DATE) AS dia,
           CASE WHEN f.datee >= @desde THEN 1 ELSE 0 END AS actual,
           CAST(COALESCE(rd.commercial_amount, rd.quantity * rd.unitary_price) AS DECIMAL(14, 4)) AS cobrado,
           /* 0083: si el renglón vendido tiene foto, la misma proporción base/cobrado. */
           CAST(COALESCE(rd.commercial_amount, rd.quantity * rd.unitary_price)
                * COALESCE(o.base_neta / NULLIF(o.subtotal, 0),
                           1.0 / CASE WHEN ISNULL(o.tax_object, '02') = '02' THEN 1 + ISNULL(o.tax_rate, ISNULL(p.tasa_iva, 0)) ELSE 1 END) AS DECIMAL(14, 4)) AS base,
           CAST(rd.quantity * COALESCE(o.unit_cost, p.cost, 0) AS DECIMAL(14, 4)) AS costo,
           rd.product_id, rd.quantity,
           ISNULL(JSON_VALUE(vs.commercial_snapshot, '$.channel'), N'LOCAL')
      FROM dbo.sale_refunds f
      JOIN dbo.sale_refund_detail rd ON rd.refund_id = f.id
      LEFT JOIN dbo.sales vs ON vs.id = f.sale_id
      JOIN dbo.products p ON p.id = rd.product_id
      OUTER APPLY (SELECT TOP 1 d.unit_cost, d.tax_rate, d.tax_object, d.base_neta, d.subtotal
                     FROM dbo.sale_detail d WHERE d.sale_id = f.sale_id AND d.product_id = rd.product_id
                    ORDER BY d.id) o
     WHERE f.datee >= @ant_desde AND f.datee < DATEADD(DAY, 1, @hasta);

    /* Devoluciones sin detalle por producto (las muy viejas): solo importe. */
    INSERT INTO #r (dia, actual, cobrado, base, costo, product_id, quantity, canal)
    SELECT CAST(f.datee AS DATE), CASE WHEN f.datee >= @desde THEN 1 ELSE 0 END,
           f.refund_total, f.refund_total / 1.16, 0, NULL, NULL,
           ISNULL(JSON_VALUE(vs.commercial_snapshot, '$.channel'), N'LOCAL')
      FROM dbo.sale_refunds f
      LEFT JOIN dbo.sales vs ON vs.id = f.sale_id
     WHERE f.datee >= @ant_desde AND f.datee < DATEADD(DAY, 1, @hasta)
       AND NOT EXISTS (SELECT 1 FROM dbo.sale_refund_detail rd WHERE rd.refund_id = f.id);

    /* --------- Mermas de producto terminado -------- */
    SELECT w.waste_date AS dia, CASE WHEN w.waste_date >= @desde THEN 1 ELSE 0 END AS actual,
           CAST(w.qty * COALESCE(w.unit_cost, p.cost, 0) AS DECIMAL(14, 4)) AS costo
      INTO #w
      FROM dbo.production_waste w
      JOIN dbo.products p ON p.id = w.product_id
     WHERE w.waste_date BETWEEN @ant_desde AND @hasta;

    /* --------- Ajustes por conteo físico (faltante +, sobrante -) -------- */
    SELECT CAST(m.datee AS DATE) AS dia, CASE WHEN m.datee >= @desde THEN 1 ELSE 0 END AS actual,
           CAST(CASE WHEN m.typee = 'salida' THEN 1 ELSE -1 END * m.quantity * COALESCE(m.unit_cost, p.cost, 0) AS DECIMAL(14, 4)) AS costo
      INTO #a
      FROM dbo.inventory_movements m
      JOIN dbo.products p ON p.id = m.product_id
     WHERE m.reference = 'CONTEO'
       AND m.datee >= @ant_desde AND m.datee < DATEADD(DAY, 1, @hasta);

    /* --------- Plataformas: el reparto de las liquidaciones confirmadas (0069) -------- */
    SELECT a.alloc_date AS dia, CASE WHEN a.alloc_date >= @desde THEN 1 ELSE 0 END AS actual,
           ISNULL(a.channel_id, N'LOCAL') AS canal, a.sale_id,
           a.discount_base + a.refund_base AS descuento_base,
           a.discount_iva + a.refund_iva AS descuento_iva,
           a.fee_base, a.fee_iva, a.withheld
      INTO #pa
      FROM dbo.platform_settlement_allocations a
      JOIN dbo.platform_settlements t ON t.id = a.settlement_id AND t.status = 'CONFIRMADA'
     WHERE a.alloc_date BETWEEN @ant_desde AND @hasta;

    /* --------- Egresos (no cancelados) -------- */
    SELECT e.expense_date AS dia, CASE WHEN e.expense_date >= @desde THEN 1 ELSE 0 END AS actual,
           ISNULL(c.kind, 'GENERAL') AS kind, ISNULL(c.name, N'Sin concepto') AS concepto, e.amount
      INTO #e
      FROM dbo.expenses e
      LEFT JOIN dbo.expense_categories c ON c.id = e.category_id
     WHERE e.voided_at IS NULL
       AND ISNULL(c.kind, 'GENERAL') <> 'PLATAFORMA'
       AND e.expense_date BETWEEN @ant_desde AND @hasta;

    /* =============================== 1 resumen =============================== */
    ;WITH per AS (SELECT 1 AS actual UNION ALL SELECT 0),
    x AS (
        SELECT per.actual,
               (SELECT ISNULL(SUM(cobrado), 0) FROM #v WHERE actual = per.actual) AS ventas_cobradas,
               (SELECT COUNT(DISTINCT sale_id) FROM #v WHERE actual = per.actual) AS tickets,
               (SELECT ISNULL(SUM(d), 0) FROM (SELECT MAX(descuento_venta) d FROM #v WHERE actual = per.actual GROUP BY sale_id) q) AS descuentos,
               (SELECT ISNULL(SUM(base), 0) FROM #v WHERE actual = per.actual) AS ventas_base,
               (SELECT ISNULL(SUM(cobrado), 0) FROM #r WHERE actual = per.actual) AS devoluciones_cobradas,
               (SELECT ISNULL(SUM(base), 0) FROM #r WHERE actual = per.actual) AS devoluciones_base,
               (SELECT ISNULL(SUM(costo), 0) FROM #v WHERE actual = per.actual) AS costo_vendido,
               (SELECT ISNULL(SUM(costo), 0) FROM #r WHERE actual = per.actual) AS costo_devuelto,
               (SELECT COUNT(*) FROM #v WHERE actual = per.actual AND costo_estimado = 1) AS renglones_costo_estimado,
               (SELECT ISNULL(SUM(base), 0) FROM #v WHERE actual = per.actual AND (costo_estimado = 1 OR costo = 0)) AS ventas_sin_costo_congelado,
               (SELECT ISNULL(SUM(costo), 0) FROM #w WHERE actual = per.actual) AS mermas,
               (SELECT ISNULL(SUM(costo), 0) FROM #a WHERE actual = per.actual) AS ajustes_inventario,
               (SELECT ISNULL(SUM(amount), 0) FROM #e WHERE actual = per.actual AND kind <> 'PERSONAL') AS egresos_generales,
               (SELECT ISNULL(SUM(amount), 0) FROM #e WHERE actual = per.actual AND kind = 'PERSONAL') AS pagos_personal,
               (SELECT ISNULL(SUM(descuento_base), 0) FROM #pa WHERE actual = per.actual) AS plat_desc_base,
               (SELECT ISNULL(SUM(descuento_iva), 0) FROM #pa WHERE actual = per.actual) AS plat_desc_iva,
               (SELECT ISNULL(SUM(fee_base), 0) FROM #pa WHERE actual = per.actual) AS plat_comision,
               (SELECT ISNULL(SUM(fee_iva), 0) FROM #pa WHERE actual = per.actual) AS plat_comision_iva,
               (SELECT ISNULL(SUM(withheld), 0) FROM #pa WHERE actual = per.actual) AS plat_retenciones
          FROM per)
    SELECT CASE WHEN actual = 1 THEN 'ACTUAL' ELSE 'ANTERIOR' END AS periodo,
           CASE WHEN actual = 1 THEN @desde ELSE @ant_desde END AS desde,
           CASE WHEN actual = 1 THEN @hasta ELSE @ant_hasta END AS hasta,
           tickets, descuentos,
           ventas_cobradas, devoluciones_cobradas,
           CAST((ventas_cobradas - devoluciones_cobradas) - (ventas_base - devoluciones_base) - plat_desc_iva AS DECIMAL(14, 2)) AS iva_trasladado,
           CAST(plat_desc_base AS DECIMAL(14, 2)) AS descuentos_plataforma,
           CAST(ventas_base - devoluciones_base - plat_desc_base AS DECIMAL(14, 2)) AS ventas_netas,
           CAST(costo_vendido - costo_devuelto AS DECIMAL(14, 2)) AS costo_ventas,
           CAST((ventas_base - devoluciones_base - plat_desc_base) - (costo_vendido - costo_devuelto) AS DECIMAL(14, 2)) AS utilidad_bruta,
           CAST(mermas AS DECIMAL(14, 2)) AS mermas,
           CAST(ajustes_inventario AS DECIMAL(14, 2)) AS ajustes_inventario,
           CAST(egresos_generales AS DECIMAL(14, 2)) AS egresos_generales,
           CAST(pagos_personal AS DECIMAL(14, 2)) AS pagos_personal,
           CAST(plat_comision AS DECIMAL(14, 2)) AS comisiones_plataforma,
           CAST(plat_comision_iva AS DECIMAL(14, 2)) AS iva_comisiones_plataforma,
           CAST(plat_retenciones AS DECIMAL(14, 2)) AS retenciones_plataforma,
           CAST((ventas_base - devoluciones_base - plat_desc_base) - (costo_vendido - costo_devuelto)
                - mermas - ajustes_inventario - egresos_generales - pagos_personal - plat_comision AS DECIMAL(14, 2)) AS utilidad_operacion,
           renglones_costo_estimado,
           CAST(ventas_sin_costo_congelado AS DECIMAL(14, 2)) AS ventas_sin_costo
      FROM x
     ORDER BY actual DESC;

    /* =============================== 2 egresos =============================== */
    SELECT kind, concepto, CAST(SUM(amount) AS DECIMAL(14, 2)) AS total, COUNT(*) AS movimientos,
           CAST(ISNULL((SELECT SUM(a.amount) FROM #e a WHERE a.actual = 0 AND a.kind = e.kind AND a.concepto = e.concepto), 0) AS DECIMAL(14, 2)) AS total_anterior
      FROM #e e
     WHERE actual = 1
     GROUP BY kind, concepto
     ORDER BY SUM(amount) DESC;

    /* ============================== 3 categorías ============================= */
    /* 0069: lo que la plataforma descontó de una venta se reparte entre sus
       renglones según su venta sin IVA: la promoción baja la venta neta de
       la categoría y la comisión baja su utilidad. */
    ;WITH vp AS (
        SELECT v.product_id, v.base, v.costo,
               CASE WHEN SUM(v.base) OVER (PARTITION BY v.sale_id) <> 0
                    THEN v.base / SUM(v.base) OVER (PARTITION BY v.sale_id) ELSE 0 END AS parte,
               ps.descuento, ps.comision
          FROM #v v
          LEFT JOIN (SELECT sale_id, SUM(descuento_base) AS descuento, SUM(fee_base) AS comision
                       FROM #pa WHERE sale_id IS NOT NULL GROUP BY sale_id) ps ON ps.sale_id = v.sale_id
         WHERE v.actual = 1),
    vc AS (
        SELECT product_id, base - ISNULL(descuento, 0) * parte AS neto, costo, ISNULL(comision, 0) * parte AS comision FROM vp)
    SELECT ISNULL(c.namee, N'Sin categoría') AS categoria,
           CAST(SUM(v.neto) AS DECIMAL(14, 2)) AS ventas_netas,
           CAST(SUM(v.costo) AS DECIMAL(14, 2)) AS costo,
           CAST(SUM(v.comision) AS DECIMAL(14, 2)) AS comisiones_plataforma,
           CAST(SUM(v.neto - v.costo - v.comision) AS DECIMAL(14, 2)) AS utilidad,
           CAST(CASE WHEN SUM(v.neto) > 0 THEN 100 * SUM(v.neto - v.costo - v.comision) / SUM(v.neto) END AS DECIMAL(7, 2)) AS margen
      FROM vc v
      JOIN dbo.products p ON p.id = v.product_id
      LEFT JOIN dbo.CAT_categories c ON c.id = p.category_id
     GROUP BY c.namee
     ORDER BY SUM(v.neto - v.costo - v.comision) DESC;

    /* ================================ 4 días ================================= */
    ;WITH n AS (SELECT TOP (@dias) ROW_NUMBER() OVER (ORDER BY (SELECT NULL)) - 1 AS i FROM sys.all_objects),
    f AS (SELECT DATEADD(DAY, i, @desde) AS dia FROM n)
    SELECT f.dia,
           CAST(ISNULL(v.base, 0) - ISNULL(r.base, 0) - ISNULL(pa.descuento, 0) AS DECIMAL(14, 2)) AS ventas_netas,
           CAST(ISNULL(v.costo, 0) - ISNULL(r.costo, 0) AS DECIMAL(14, 2)) AS costo_ventas,
           CAST(ISNULL(w.costo, 0) + ISNULL(a.costo, 0) + ISNULL(e.total, 0) + ISNULL(pa.comision, 0) AS DECIMAL(14, 2)) AS gastos,
           CAST(ISNULL(v.base, 0) - ISNULL(r.base, 0) - ISNULL(pa.descuento, 0) - ISNULL(v.costo, 0) + ISNULL(r.costo, 0)
                - ISNULL(w.costo, 0) - ISNULL(a.costo, 0) - ISNULL(e.total, 0) - ISNULL(pa.comision, 0) AS DECIMAL(14, 2)) AS utilidad
      FROM f
      LEFT JOIN (SELECT dia, SUM(base) base, SUM(costo) costo FROM #v WHERE actual = 1 GROUP BY dia) v ON v.dia = f.dia
      LEFT JOIN (SELECT dia, SUM(base) base, SUM(costo) costo FROM #r WHERE actual = 1 GROUP BY dia) r ON r.dia = f.dia
      LEFT JOIN (SELECT dia, SUM(costo) costo FROM #w WHERE actual = 1 GROUP BY dia) w ON w.dia = f.dia
      LEFT JOIN (SELECT dia, SUM(costo) costo FROM #a WHERE actual = 1 GROUP BY dia) a ON a.dia = f.dia
      LEFT JOIN (SELECT dia, SUM(amount) total FROM #e WHERE actual = 1 GROUP BY dia) e ON e.dia = f.dia
      LEFT JOIN (SELECT dia, SUM(descuento_base) descuento, SUM(fee_base) comision FROM #pa WHERE actual = 1 GROUP BY dia) pa ON pa.dia = f.dia
     ORDER BY f.dia;

    /* ============================== 5-6 productos ============================ */
    SELECT p.id, p.nombre AS producto, CAST(SUM(v.quantity) AS DECIMAL(14, 2)) AS cantidad,
           CAST(SUM(v.base) AS DECIMAL(14, 2)) AS ventas_netas, CAST(SUM(v.costo) AS DECIMAL(14, 2)) AS costo,
           CAST(SUM(v.base - v.costo) AS DECIMAL(14, 2)) AS utilidad,
           CAST(CASE WHEN SUM(v.base) > 0 THEN 100 * SUM(v.base - v.costo) / SUM(v.base) END AS DECIMAL(7, 2)) AS margen,
           MAX(v.costo_estimado) AS costo_estimado
      INTO #p
      FROM #v v JOIN dbo.products p ON p.id = v.product_id
     WHERE v.actual = 1
     GROUP BY p.id, p.nombre;

    SELECT TOP (15) * FROM #p ORDER BY utilidad DESC, producto;
    SELECT TOP (15) * FROM #p WHERE utilidad < 0 ORDER BY utilidad ASC, producto;

    /* ============================== 7 canales (0069) ========================== */
    /* El nombre: el de la política vigente; si el canal ya no existe, el que
       quedó en la venta. La plataforma, la que tenga ligada hoy. */
    SELECT c.id, c.name INTO #cn FROM dbo.commercial_policy p
     CROSS APPLY OPENJSON(p.payload, '$.channels') WITH (id NVARCHAR(64), name NVARCHAR(120)) c
     WHERE p.id = 1;
    ;WITH canales AS (
        SELECT canal FROM #v WHERE actual = 1 UNION SELECT canal FROM #r WHERE actual = 1
        UNION SELECT canal FROM #pa WHERE actual = 1),
    x AS (
        SELECT k.canal,
               (SELECT COUNT(DISTINCT sale_id) FROM #v WHERE actual = 1 AND canal = k.canal) AS tickets,
               (SELECT ISNULL(SUM(base), 0) FROM #v WHERE actual = 1 AND canal = k.canal) AS vb,
               (SELECT ISNULL(SUM(costo), 0) FROM #v WHERE actual = 1 AND canal = k.canal) AS vc,
               (SELECT ISNULL(SUM(base), 0) FROM #r WHERE actual = 1 AND canal = k.canal) AS rb,
               (SELECT ISNULL(SUM(costo), 0) FROM #r WHERE actual = 1 AND canal = k.canal) AS rc,
               (SELECT ISNULL(SUM(descuento_base), 0) FROM #pa WHERE actual = 1 AND canal = k.canal) AS pd,
               (SELECT ISNULL(SUM(fee_base), 0) FROM #pa WHERE actual = 1 AND canal = k.canal) AS pf,
               (SELECT ISNULL(SUM(withheld), 0) FROM #pa WHERE actual = 1 AND canal = k.canal) AS pr
          FROM canales k)
    SELECT x.canal,
           CASE WHEN x.canal = N'LOCAL' THEN N'Mostrador'
                ELSE COALESCE(n.name, (SELECT MAX(canal_nombre) FROM #v WHERE canal = x.canal), x.canal) END AS nombre,
           pc.platform AS plataforma,
           x.tickets,
           CAST(x.vb - x.rb AS DECIMAL(14, 2)) AS ventas,
           CAST(x.pd AS DECIMAL(14, 2)) AS descuentos_plataforma,
           CAST(x.vb - x.rb - x.pd AS DECIMAL(14, 2)) AS ventas_netas,
           CAST(x.vc - x.rc AS DECIMAL(14, 2)) AS costo,
           CAST(x.pf AS DECIMAL(14, 2)) AS comisiones_plataforma,
           CAST(x.vb - x.rb - x.pd - (x.vc - x.rc) - x.pf AS DECIMAL(14, 2)) AS utilidad,
           CAST(CASE WHEN x.vb - x.rb - x.pd > 0 THEN 100 * (x.vb - x.rb - x.pd - (x.vc - x.rc) - x.pf) / (x.vb - x.rb - x.pd) END AS DECIMAL(7, 2)) AS margen,
           CAST(x.pr AS DECIMAL(14, 2)) AS retenciones_plataforma,
           /* Canal de plataforma con ventas y sin ninguna liquidación en el
              periodo: su utilidad todavía es la del ticket, no la real. */
           CAST(CASE WHEN pc.platform IS NOT NULL AND x.pd = 0 AND x.pf = 0 THEN 1 ELSE 0 END AS BIT) AS sin_liquidar
      FROM x
      LEFT JOIN #cn n ON n.id = x.canal
      LEFT JOIN dbo.platform_channels pc ON pc.channel_id = x.canal
     ORDER BY CASE WHEN x.canal = N'LOCAL' THEN 0 ELSE 1 END, x.vb - x.rb DESC;
END;
GO

/* ---------- sp_producto_impuestos_get (SQL_STORED_PROCEDURE) ---------- */
/* sp_producto_impuestos_get
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* =================== sp_producto_impuestos_get (0083) ===================
   Los impuestos además del IVA que lleva un producto, con su valor de hoy.
   Incluye los apagados (marcados en el producto pero sin cobrarse) para que
   la pantalla lo diga en vez de esconderlo.
   ======================================================================= */
CREATE OR ALTER PROCEDURE dbo.sp_producto_impuestos_get
    @product_id INT
AS
BEGIN
    SET NOCOUNT ON;
    SELECT i.id, i.nombre, i.clase, i.factor, i.tasa, i.cuota, i.unidad, i.en_base_iva, i.activo, pi.cantidad
      FROM dbo.product_impuestos pi
      JOIN dbo.CAT_impuestos i ON i.id = pi.impuesto_id
     WHERE pi.product_id = @product_id
     ORDER BY i.clase, i.nombre;
END
GO

/* ---------- sp_producto_impuestos_guardar (SQL_STORED_PROCEDURE) ---------- */
/* sp_producto_impuestos_guardar
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* ================= sp_producto_impuestos_guardar (0083) =================
   Reemplaza los impuestos además del IVA de un producto.
   @impuestos  JSON: [{ "id": 3 }, { "id": 9, "cantidad": 0.6 }]
               cantidad = unidades de la cuota que trae UNA pieza (litros,
               cigarros); solo para los de cuota, y obligatoria en ellos.
   Un impuesto apagado se puede dejar marcado (no se cobra hasta encenderlo);
   uno nuevo apagado no se puede marcar.
   ======================================================================= */
CREATE OR ALTER PROCEDURE dbo.sp_producto_impuestos_guardar
    @product_id INT,
    @impuestos  NVARCHAR(MAX)
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    IF NOT EXISTS (SELECT 1 FROM dbo.products WHERE id = @product_id) THROW 51000, 'Ese producto no existe.', 1;
    IF ISJSON(ISNULL(@impuestos, N'[]')) = 0 THROW 51000, 'Lista de impuestos inválida.', 1;

    SELECT DISTINCT j.id, j.cantidad
      INTO #n
      FROM OPENJSON(ISNULL(@impuestos, N'[]')) WITH (id INT '$.id', cantidad DECIMAL(12, 4) '$.cantidad') j
     WHERE j.id IS NOT NULL;

    IF EXISTS (SELECT 1 FROM #n n LEFT JOIN dbo.CAT_impuestos i ON i.id = n.id WHERE i.id IS NULL)
        THROW 51000, 'Uno de los impuestos no existe.', 1;
    IF EXISTS (SELECT 1 FROM #n n JOIN dbo.CAT_impuestos i ON i.id = n.id
                WHERE i.activo = 0 AND NOT EXISTS (SELECT 1 FROM dbo.product_impuestos pi WHERE pi.product_id = @product_id AND pi.impuesto_id = n.id))
        THROW 51000, 'Ese impuesto está apagado: enciéndelo en Configuración → Impuestos.', 1;
    IF EXISTS (SELECT 1 FROM #n n JOIN dbo.CAT_impuestos i ON i.id = n.id WHERE i.factor = 'Cuota' AND (n.cantidad IS NULL OR n.cantidad <= 0))
        THROW 51000, 'Un impuesto por cuota necesita cuánto trae una pieza (por ejemplo, 0.6 litros).', 1;

    BEGIN TRAN;
        DELETE FROM dbo.product_impuestos WHERE product_id = @product_id;
        INSERT INTO dbo.product_impuestos (product_id, impuesto_id, cantidad)
        SELECT @product_id, n.id, CASE WHEN i.factor = 'Cuota' THEN n.cantidad END
          FROM #n n JOIN dbo.CAT_impuestos i ON i.id = n.id;
    COMMIT;

    EXEC dbo.sp_producto_impuestos_get @product_id = @product_id;
END
GO

/* ---------- sp_register_sale (SQL_STORED_PROCEDURE) ---------- */
/* sp_register_sale
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* ============================================================
   sp_register_sale — UNICA transaccion de venta de Wybix (Retail y Touch)

   La APP declara: que se vendio, cuanto, a que precio y que opciones eligio.
   La APP NO calcula inventario. Este procedure:

     lineas ─┬─ DIRECT  → requiere el propio producto
             ├─ RECIPE  → receta (variante por tamano, o base × SCALE)
             │            + modificadores ADD / REMOVE / SUBSTITUTE
             └─ NONE    → sin inventario
     ↓ agrupa requerimientos por producto
     ↓ bloquea products en orden ascendente de id (UPDLOCK, HOLDLOCK)
     ↓ valida stock → registra sale, sale_detail (con unit_cost), modifiers
     ↓ inventory_movements (ligados a la linea y al producto vendido)
     ↓ caja (solo efectivo contado, turno de la caja) → COMMIT

   Transicion ADITIVA: @SaleDetails (tipo v1) sigue funcionando tal cual;
   @SaleDetails2 / @SaleModifiers / @service_mode son opcionales.

   Errores dentro de la transaccion: se lanzan con RAISERROR (severidad 16),
   que dentro de un TRY transfiere al CATCH; ES EL CATCH quien hace el
   ROLLBACK. Una sola salida, un solo sitio donde se deshace todo.

   COMO INVOCARLO: directamente (EXEC / Command.Execute), como hace el IPC.
   NO se puede envolver en "INSERT ... EXEC": SQL Server prohibe el ROLLBACK
   dentro de esa construccion y sustituye cualquier error del procedure por
   "Cannot use the ROLLBACK statement within an INSERT-EXEC statement",
   ocultando la causa real (por ejemplo, que falto stock). Es una limitacion
   de INSERT-EXEC, no de este procedure.

   Concurrencia: transaccion corta, sin dispositivos dentro, bloqueo en orden
   consistente. Si SQL Server elige a esta sesion como victima de deadlock
   (1205) NADA quedo escrito: el IPC puede reintentar la misma intencion.
   ============================================================ */
CREATE OR ALTER PROCEDURE [dbo].[sp_register_sale]
    @user_id INT,
    @payment_method NVARCHAR(50),
    @SaleDetails dbo.SaleDetailType READONLY,
    @customer_id    INT = NULL,
    @due_date       DATE = NULL,
    @register_id    INT = NULL,
    @SaleDetails2   dbo.SaleDetailType2 READONLY,
    @SaleModifiers  dbo.SaleModifierType READONLY,
    @service_mode   NVARCHAR(10) = NULL,
    -- Identidad del equipo. Ver el bloque MULTICAJA mas abajo: NULO = no se
    -- exige nada, que es el contrato de MonoCaja y el de las versiones previas.
    @machine_id     NVARCHAR(64) = NULL,
    @machine_name   NVARCHAR(120) = NULL,
    -- MODO VENTA ESENCIAL (licencia sin suscripcion activa). Lo decide el
    -- proceso principal con la licencia firmada, nunca la pantalla. Se vende
    -- y se cobra igual, pero el inventario NO se administra: no se valida
    -- existencia, no se descuenta y no se crean movimientos. No se toca
    -- ningun producto (vendible, modo de inventario, recetas, stock): al
    -- renovar todo vuelve tal cual estaba. La venta queda marcada para poder
    -- avisar cuantas hubo y desde cuando.
    @venta_esencial BIT = 0,
    @commercial_quote UNIQUEIDENTIFIER = NULL,
    @commercial_payment_reference NVARCHAR(100) = NULL,
    @payments_json NVARCHAR(MAX) = NULL,
    @client_sale_key UNIQUEIDENTIFIER = NULL,
    @client_sale_hash VARCHAR(64) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    DECLARE @sale_id INT;
    DECLARE @total   DECIMAL(10,2);
    DECLARE @is_credit BIT;
    /* 0081: lo que queda a credito. Una venta CREDITO entera fia todo el
       total; una que paga una parte (pago dividido con CREDITO) fia solo el
       resto. Se fija al conocer el total. */
    DECLARE @credito DECIMAL(12,2) = NULL;
    DECLARE @errmsg NVARCHAR(400);

    /* Si este equipo dice quien es, SU caja es la que tiene arrendada. Caer a
       `TOP 1 ... ORDER BY id` significaria "la Caja 1", que es de otro equipo:
       el mismo error que hacia que la laptop validara la caja de la VM. */
    IF @register_id IS NULL AND NULLIF(LTRIM(RTRIM(ISNULL(@machine_id, N''))), N'') IS NOT NULL
        SELECT @register_id = a.register_id
        FROM dbo.register_assignments a
        WHERE a.machine_id = @machine_id
          AND a.released_at IS NULL
          AND a.lease_until > SYSUTCDATETIME();

    IF @register_id IS NULL
        SELECT TOP 1 @register_id = id FROM dbo.registers ORDER BY id;

    IF @client_sale_key IS NOT NULL AND EXISTS(SELECT 1 FROM dbo.sales WHERE client_sale_key=@client_sale_key) BEGIN
      IF @client_sale_hash IS NULL OR NOT EXISTS(SELECT 1 FROM dbo.sales WHERE client_sale_key=@client_sale_key AND client_sale_hash=@client_sale_hash AND useer_id=@user_id AND register_id=@register_id) THROW 51000,'La clave de venta ya pertenece a otro cobro.',1;
      SELECT id sale_id,total,payment_method,register_id,service_mode,CAST(CASE WHEN payment_method='CREDITO' THEN 1 ELSE 0 END AS BIT) is_credit FROM dbo.sales WHERE client_sale_key=@client_sale_key;
      RETURN;
    END;

    SET @is_credit =
      CASE WHEN @customer_id IS NOT NULL AND UPPER(@payment_method) = 'CREDITO' THEN 1 ELSE 0 END;

    /* Una venta A CREDITO sin cliente quedaba con @is_credit = 0 y se
       registraba como PAGADA: saldo 0, nadie a quien cobrarle. */
    IF UPPER(@payment_method) = 'CREDITO' AND @customer_id IS NULL
    BEGIN
        RAISERROR('Una venta a credito necesita el cliente.', 16, 1);
        RETURN;
    END


    /* ---------------- MULTICAJA: esta caja es de este equipo ----------------
       La proteccion NO puede vivir solo en el selector de la pantalla. El
       turno es de la CAJA (`cash_closures.register_id`), asi que dos equipos
       declarados C1 comparten turno y comparten corte: las ventas de ambos
       caen en el mismo arqueo. Eso es dinero, y tiene que rechazarse aqui,
       donde no hay UI que saltarse.

       `@machine_id` NULO = el que llama no dice quien es. Entonces NO se
       exige nada: es el contrato de siempre, el que usan las instalaciones de
       una sola caja, las pruebas y cualquier version anterior de la app.

       Cuando SI se identifica, la llamada ademas RENUEVA el arriendo. Vender
       es la senal de vida mas fuerte que existe: una caja que esta cobrando
       no puede perder su identidad porque un temporizador se estrangulo.
       Se comprueba ANTES de abrir transaccion: no hay nada que deshacer.
       ---------------------------------------------------------------------- */
    IF NULLIF(LTRIM(RTRIM(ISNULL(@machine_id, N''))), N'') IS NOT NULL
    BEGIN
        DECLARE @lease_res NVARCHAR(20), @lease_holder NVARCHAR(64),
                @lease_holder_name NVARCHAR(120), @lease_hasta DATETIME2(0);

        EXEC dbo.sp_register_lease_touch
            @register_id   = @register_id,
            @machine_id    = @machine_id,
            @machine_name  = @machine_name,
            @lease_seconds = 300,
            @resultado     = @lease_res OUTPUT,
            @holder_id     = @lease_holder OUTPUT,
            @holder_name   = @lease_holder_name OUTPUT,
            @lease_until   = @lease_hasta OUTPUT;

        IF @lease_res = N'OCUPADA'
        BEGIN
            /* Sin acentos a proposito: el texto de un error de SQL Server llega
               degradado a un byte por caracter y los acentos se pierden. */
            DECLARE @lease_quien NVARCHAR(120) =
                ISNULL(NULLIF(LTRIM(RTRIM(@lease_holder_name)), N''), N'otro equipo');
            RAISERROR('Esta caja la esta usando %s. Dos equipos no pueden operar la misma caja: cada una lleva su propio turno y su propio corte.', 16, 1, @lease_quien);
            RETURN;
        END
    END

    /* Sin turno abierto en ESTA caja no se vende, se cobre como se cobre.
       Antes solo se exigia para el efectivo, porque el turno hacia falta para
       colgar el movimiento de caja: una venta con tarjeta o a credito entraba
       sin turno y quedaba fuera del corte del dia. El turno no es un detalle
       del efectivo, es a quien pertenece la venta.
       Se comprueba ANTES de abrir transaccion: no hay nada que deshacer. */
    IF NOT EXISTS (
        SELECT 1 FROM dbo.cash_closures
        WHERE register_id = @register_id AND closed_at IS NULL)
    BEGIN
        RAISERROR('No hay un turno abierto en esta caja. Abre el turno antes de vender.', 16, 1);
        RETURN;
    END

    IF @service_mode IS NOT NULL
    BEGIN
        SET @service_mode = UPPER(LTRIM(RTRIM(@service_mode)));
        IF @service_mode = '' SET @service_mode = NULL;
        ELSE IF @service_mode NOT IN ('DINE_IN', 'TAKEAWAY')
        BEGIN
            RAISERROR('service_mode invalido: DINE_IN o TAKEAWAY.', 16, 1);
            RETURN;
        END
    END

    /* ---------------------------------------------------- 0) Lineas */
    IF EXISTS (SELECT line_no FROM @SaleDetails2 GROUP BY line_no HAVING COUNT(*) > 1)
    BEGIN
        RAISERROR('line_no repetido en el detalle de la venta.', 16, 1);
        RETURN;
    END

    CREATE TABLE #lines (
        line_no        INT NOT NULL PRIMARY KEY CLUSTERED,
        product_id     INT NOT NULL,
        product_name   NVARCHAR(100) NULL,
        quantity       DECIMAL(12,2) NOT NULL,
        unit_price     DECIMAL(10,2) NOT NULL,
        note           NVARCHAR(200) NULL,
        inventory_mode NVARCHAR(10) NULL,
        product_cost   DECIMAL(14,4) NULL,
        recipe_id      INT NULL,
        variant_option_id INT NULL,
        scale          DECIMAL(8,4) NOT NULL DEFAULT 1,
        unit_cost      DECIMAL(14,4) NULL
    );

    /* Las lineas v1 reciben line_no >= 100000 para no chocar con v2. */
    INSERT INTO #lines (line_no, product_id, quantity, unit_price, note)
    SELECT 100000 + ROW_NUMBER() OVER (ORDER BY (SELECT NULL)), product_id, ISNULL(quantity, 0), ISNULL(unit_price, 0), NULL
    FROM @SaleDetails
    UNION ALL
    SELECT line_no, product_id, quantity, unit_price, note
    FROM @SaleDetails2;

    IF NOT EXISTS (SELECT 1 FROM #lines)
    BEGIN
        RAISERROR('La venta no tiene partidas.', 16, 1);
        RETURN;
    END
    IF EXISTS (SELECT 1 FROM #lines WHERE quantity <= 0)
    BEGIN
        RAISERROR('Cada partida necesita una cantidad mayor a cero.', 16, 1);
        RETURN;
    END

    UPDATE l
       SET inventory_mode = p.inventory_mode,
           product_cost   = ISNULL(p.cost, 0),
           product_name   = p.nombre
    FROM #lines l
    JOIN dbo.products p ON p.id = l.product_id;

    IF EXISTS (SELECT 1 FROM #lines WHERE inventory_mode IS NULL)
    BEGIN
        RAISERROR('Un producto de la venta no existe.', 16, 1);
        RETURN;
    END

    /* Un producto dado de baja no vuelve a venderse.
       Las pantallas ya lo ocultan -sp_get_active_products y sp_get_menu_catalog
       filtran active = 1-, pero un catalogo cargado en memoria antes de la baja,
       o una caja secundaria que aun no lo sabe, llegan igual hasta aqui. La
       unica comprobacion que nadie puede saltarse es esta. */
    DECLARE @debaja NVARCHAR(100) = NULL;
    SELECT TOP 1 @debaja = p.nombre
    FROM #lines l
    JOIN dbo.products p ON p.id = l.product_id
    WHERE p.active = 0
    ORDER BY l.line_no;

    IF @debaja IS NOT NULL
    BEGIN
        SET @errmsg = N'El producto "' + @debaja + N'" esta dado de baja y ya no puede venderse.';
        RAISERROR(@errmsg, 16, 1);
        RETURN;
    END

    /* En Venta Esencial solo se vende lo COMERCIALMENTE vendible (sellable = 1).
       Un ingrediente o insumo no aparece en la venta, y aqui tampoco entra
       aunque alguien llame el canal a mano: la regla no depende de la
       pantalla. Fuera de Venta Esencial no cambia nada (una orden de servicio
       puede cobrar una refaccion que no se vende en mostrador, y en Venta
       Esencial Servicios esta en pausa). */
    IF ISNULL(@venta_esencial, 0) = 1
    BEGIN
        DECLARE @novendible NVARCHAR(100) = NULL;
        SELECT TOP 1 @novendible = p.nombre
        FROM #lines l
        JOIN dbo.products p ON p.id = l.product_id
        WHERE p.sellable = 0
        ORDER BY l.line_no;

        IF @novendible IS NOT NULL
        BEGIN
            SET @errmsg = N'"' + @novendible + N'" no es un producto de venta: no se puede cobrar en Venta Esencial.';
            RAISERROR(@errmsg, 16, 1);
            RETURN;
        END
    END

    /* ---------------------------------------------- 1) Modificadores */
    CREATE TABLE #mods (
        line_no INT NOT NULL,
        option_id INT NOT NULL,
        qty INT NOT NULL,
        group_id INT NULL,
        role NVARCHAR(15) NULL,
        effect NVARCHAR(12) NULL,
        ingredient_product_id INT NULL,
        replaces_product_id INT NULL,
        qty_base DECIMAL(14,4) NULL,
        qty_factor DECIMAL(8,4) NULL,
        price_delta DECIMAL(10,2) NULL,
        group_name NVARCHAR(80) NULL,
        option_name NVARCHAR(80) NULL
    );

    INSERT INTO #mods
    SELECT m.line_no, m.modifier_option_id, ISNULL(m.quantity, 1),
           o.group_id, g.role, o.effect, o.ingredient_product_id, o.replaces_product_id,
           o.qty_base, o.qty_factor, o.price_delta, g.name, o.name
    FROM @SaleModifiers m
    LEFT JOIN dbo.modifier_options o ON o.id = m.modifier_option_id AND o.active = 1
    LEFT JOIN dbo.modifier_groups g ON g.id = o.group_id AND g.active = 1;

    IF EXISTS (SELECT 1 FROM #mods WHERE group_id IS NULL)
    BEGIN RAISERROR('Un modificador no existe o esta inactivo.', 16, 1); RETURN; END
    IF EXISTS (SELECT 1 FROM #mods WHERE qty <= 0)
    BEGIN RAISERROR('La cantidad de un modificador debe ser mayor a cero.', 16, 1); RETURN; END
    IF EXISTS (SELECT 1 FROM #mods m LEFT JOIN #lines l ON l.line_no = m.line_no WHERE l.line_no IS NULL)
    BEGIN RAISERROR('Un modificador apunta a una partida inexistente.', 16, 1); RETURN; END
    IF EXISTS (
        SELECT 1 FROM #mods m JOIN #lines l ON l.line_no = m.line_no
        WHERE NOT EXISTS (SELECT 1 FROM dbo.product_modifier_groups pmg WHERE pmg.product_id = l.product_id AND pmg.group_id = m.group_id))
    BEGIN RAISERROR('Un modificador no corresponde al producto de su partida.', 16, 1); RETURN; END
    IF EXISTS (
        SELECT 1 FROM #mods m JOIN dbo.modifier_groups g ON g.id = m.group_id
        GROUP BY m.line_no, m.group_id, g.max_select
        HAVING COUNT(DISTINCT m.option_id) > g.max_select)
    BEGIN RAISERROR('Se eligieron mas opciones de las permitidas en un grupo de modificadores.', 16, 1); RETURN; END
    /* Grupos obligatorios: solo se exigen a las lineas v2 (las v1 no pueden declararlos). */
    IF EXISTS (
        SELECT 1
        FROM #lines l
        JOIN dbo.product_modifier_groups pmg ON pmg.product_id = l.product_id
        JOIN dbo.modifier_groups g ON g.id = pmg.group_id AND g.active = 1 AND g.required = 1
        WHERE l.line_no < 100000
          AND (SELECT COUNT(DISTINCT m.option_id) FROM #mods m WHERE m.line_no = l.line_no AND m.group_id = g.id)
              < CASE WHEN g.min_select > 0 THEN g.min_select ELSE 1 END)
    BEGIN
        SELECT TOP 1 @errmsg = CONCAT('Falta elegir "', g.name, '" para ', l.product_name, '.')
        FROM #lines l
        JOIN dbo.product_modifier_groups pmg ON pmg.product_id = l.product_id
        JOIN dbo.modifier_groups g ON g.id = pmg.group_id AND g.active = 1 AND g.required = 1
        WHERE l.line_no < 100000
          AND (SELECT COUNT(DISTINCT m.option_id) FROM #mods m WHERE m.line_no = l.line_no AND m.group_id = g.id)
              < CASE WHEN g.min_select > 0 THEN g.min_select ELSE 1 END
        ORDER BY l.line_no;
        RAISERROR(@errmsg, 16, 1);
        RETURN;
    END

    /* ------------------------------------------------- 2) Recetas */
    /* Receta de la variante elegida (SIZE) si existe; si no, la base. */
    UPDATE l SET recipe_id = r.id
    FROM #lines l
    CROSS APPLY (
        SELECT TOP 1 r.id
        FROM dbo.recipes r
        WHERE r.product_id = l.product_id AND r.active = 1
          AND (r.variant_option_id IS NULL
               OR r.variant_option_id IN (SELECT m.option_id FROM #mods m WHERE m.line_no = l.line_no AND m.role = 'SIZE'))
        ORDER BY CASE WHEN r.variant_option_id IS NULL THEN 1 ELSE 0 END
    ) r
    WHERE l.inventory_mode = 'RECIPE';

    /* ------------------------- 3) LA RECETA EFECTIVA -------------------------
       El calculo NO vive aqui: vive en `sp_resolver_receta_efectiva`, que es
       el mismo que usa `sp_check_availability`. Tenerlo escrito dos veces
       seria tener dos motores que empiezan iguales y terminan distintos, y el
       sintoma seria el peor posible: la pantalla dice que hay y el cobro dice
       que no.

       El contrato son tablas temporales. No puede ser una funcion -el
       constructor del baseline solo despliega procedimientos- ni devolver un
       resultset -`INSERT ... EXEC` prohibe el ROLLBACK que este procedimiento
       necesita-.
       ------------------------------------------------------------------------ */
    CREATE TABLE #ef_lineas (
        line_no INT NOT NULL PRIMARY KEY,
        product_id INT NOT NULL,
        inventory_mode NVARCHAR(10) NULL,
        recipe_id INT NULL,
        variant_option_id INT NULL,
        scale DECIMAL(8,4) NULL
    );
    CREATE TABLE #ef_opciones (
        line_no INT NOT NULL,
        modifier_option_id INT NOT NULL,
        qty INT NOT NULL
    );
    CREATE TABLE #ef_requerimientos (
        line_no INT NOT NULL,
        product_id INT NOT NULL,
        qty_per_unit DECIMAL(18,6) NOT NULL,
        origen NVARCHAR(12) NOT NULL,
        modifier_option_id INT NULL,
        recipe_id INT NULL
    );

    INSERT INTO #ef_lineas (line_no, product_id, inventory_mode, scale)
    SELECT line_no, product_id, inventory_mode, 1 FROM #lines;
    INSERT INTO #ef_opciones (line_no, modifier_option_id, qty)
    SELECT line_no, option_id, qty FROM #mods;

    EXEC dbo.sp_resolver_receta_efectiva;

    /* La receta que se uso queda en la linea: es lo que se guarda en el
       detalle para poder decir despues con que receta se preparo. */
    UPDATE l SET recipe_id = e.recipe_id, variant_option_id = e.variant_option_id, scale = e.scale
    FROM #lines l JOIN #ef_lineas e ON e.line_no = l.line_no;

    /* ------------------------------------------------------------------------
       CUANDO NO HAY RECETA, DECIR CUAL DE LAS TRES COSAS PASA.

       El mensaje era siempre el mismo -"no tiene receta configurada"- y en QA
       fue falso: los productos 5 y 7 SI tenian receta, pero solo la de la
       variante (`variant_option_id = 1`). Retail no mandaba ninguna opcion de
       tamano, el CROSS APPLY de arriba no encontraba nada, y la venta se
       rechazaba diciendo que faltaba algo que estaba ahi. Quien lea eso va a
       buscar el problema en el sitio equivocado.

       Son tres situaciones distintas y cada una se arregla en otro lugar:

         SIN RECETA        no hay ninguna fila en `recipes`  -> configurarla
         FALTA LA VARIANTE hay recetas, pero todas por variante y la venta no
                           eligio tamano                     -> elegirlo
         VARIANTE SIN RECETA se eligio un tamano que no tiene receta propia y
                           tampoco hay receta base           -> configurarla

       No se toca la resolucion: una receta puede depender de la variante y eso
       es correcto. Lo que cambia es lo que se cuenta cuando falla.
       ------------------------------------------------------------------------ */
    IF EXISTS (SELECT 1 FROM #lines WHERE inventory_mode = 'RECIPE' AND recipe_id IS NULL)
    BEGIN
        SELECT TOP 1 @errmsg =
            CASE
                WHEN NOT EXISTS (SELECT 1 FROM dbo.recipes r
                                  WHERE r.product_id = l.product_id AND r.active = 1)
                    THEN CONCAT('El producto "', l.product_name, '" no tiene receta configurada.')
                WHEN NOT EXISTS (SELECT 1 FROM #mods m
                                  WHERE m.line_no = l.line_no AND m.role = 'SIZE')
                    THEN CONCAT('Falta elegir el tamano de "', l.product_name,
                                '": su receta depende del tamano y la venta no indico ninguno.')
                ELSE CONCAT('El tamano elegido para "', l.product_name,
                            '" no tiene receta, y el producto no tiene receta base.')
            END
        FROM #lines l
        WHERE l.inventory_mode = 'RECIPE' AND l.recipe_id IS NULL
        ORDER BY l.line_no;
        RAISERROR(@errmsg, 16, 1);
        RETURN;
    END


    /* Los requerimientos efectivos pasan a la estructura que ya usaba el resto
       del procedimiento. `source` conserva su significado historico -lo leen
       los reembolsos y las alertas de reposicion-: 'SALE' cuando el producto
       se consume a si mismo, 'RECIPE' cuando sale de una receta o de un
       modificador. */
    CREATE TABLE #req (
        line_no INT NOT NULL,
        product_id INT NOT NULL,
        qty_per_unit DECIMAL(18,6) NOT NULL,
        source NVARCHAR(20) NOT NULL,
        origen NVARCHAR(12) NOT NULL,
        modifier_option_id INT NULL
    );

    INSERT INTO #req (line_no, product_id, qty_per_unit, source, origen, modifier_option_id)
    SELECT line_no, product_id, qty_per_unit,
           CASE WHEN origen = 'DIRECT' THEN 'SALE' ELSE 'RECIPE' END,
           origen, modifier_option_id
    FROM #ef_requerimientos;

    /* Una cotización proviene del proceso principal, nunca de precios enviados por UI.
       La lista de partidas/opciones debe coincidir exactamente. Su consumo es atómico abajo. */
    DECLARE @cq NVARCHAR(MAX) = NULL;
    IF @commercial_quote IS NOT NULL
    BEGIN
      SELECT @cq=payload FROM dbo.commercial_quotes WHERE id=@commercial_quote AND actor_id=@user_id
        AND ISNULL(register_id,-1)=ISNULL(@register_id,-1) AND sale_id IS NULL
        AND ((@commercial_payment_reference IS NULL AND payment_reference IS NULL AND expires_at>SYSUTCDATETIME())
          OR (@payment_method='TERMINAL_MP' AND payment_reference=@commercial_payment_reference));
      IF @cq IS NULL THROW 51000,'La cotización venció o pertenece a otra cuenta.',1;
      IF (SELECT COUNT(*) FROM OPENJSON(@cq,'$.lines'))<>(SELECT COUNT(*) FROM #lines)
        THROW 51000,'Las partidas no coinciden con la cotización.',1;
      IF EXISTS(SELECT 1 FROM OPENJSON(@cq,'$.lines') WITH(line_no INT, productId INT, qty DECIMAL(12,2), unitPrice DECIMAL(10,2)) c
        LEFT JOIN #lines l ON l.line_no=c.line_no WHERE l.line_no IS NULL OR l.product_id<>c.productId OR l.quantity<>c.qty OR l.unit_price<>c.unitPrice)
        THROW 51000,'El precio o cantidad no coincide con la cotización.',1;
      IF EXISTS(SELECT 1 FROM (SELECT line_no,option_id,qty FROM #mods EXCEPT
        SELECT c.line_no,m.optionId,m.quantity FROM OPENJSON(@cq,'$.lines') WITH(line_no INT,options NVARCHAR(MAX) AS JSON) c
        CROSS APPLY OPENJSON(c.options) WITH(optionId INT,quantity INT) m) x)
        OR EXISTS(SELECT 1 FROM (SELECT c.line_no,m.optionId,m.quantity FROM OPENJSON(@cq,'$.lines') WITH(line_no INT,options NVARCHAR(MAX) AS JSON) c
        CROSS APPLY OPENJSON(c.options) WITH(optionId INT,quantity INT) m EXCEPT SELECT line_no,option_id,qty FROM #mods) x)
        THROW 51000,'Las opciones no coinciden con la cotización.',1;
    END;

    /* ------------------------ PRECIO DE LOS MODIFICADORES --------------------
       El precio de las opciones lo decide SQL, no la pantalla.

       Hasta ahora la interfaz sumaba los `price_delta` y mandaba un
       `unit_price` ya calculado, y aqui se aceptaba tal cual. Es la unica
       parte del flujo donde la interfaz podia cobrar una cosa y el inventario
       aplicar otra: elegir leche de almendra -que SI se descuenta del
       almacen- y cobrar el precio de la normal.

       Se compara SOLO la parte que pertenece a los modificadores, y solo en
       las lineas que llevan alguno con precio. Una linea sin opciones no se
       toca: el precio de un producto suelto sigue siendo cosa de la pantalla,
       con sus politicas y sus excepciones.

       La tolerancia de un centavo absorbe el redondeo decimal; cualquier cosa
       mayor es una discrepancia de verdad.
       ------------------------------------------------------------------------ */
    IF @commercial_quote IS NULL AND EXISTS (SELECT 1 FROM #mods WHERE ISNULL(price_delta, 0) <> 0)
    BEGIN
        DECLARE @linea_mal INT, @esperado DECIMAL(10,2), @recibido DECIMAL(10,2), @prod NVARCHAR(100);

        SELECT TOP 1
               @linea_mal = l.line_no,
               @prod      = l.product_name,
               @recibido  = l.unit_price,
               @esperado  = CAST(p.price + d.delta AS DECIMAL(10,2))
        FROM #lines l
        JOIN dbo.products p ON p.id = l.product_id
        CROSS APPLY (SELECT delta = ISNULL(SUM(m.price_delta * m.qty), 0)
                       FROM #mods m WHERE m.line_no = l.line_no) d
        WHERE d.delta <> 0
          AND ABS(l.unit_price - (p.price + d.delta)) > 0.01
        ORDER BY l.line_no;

        IF @linea_mal IS NOT NULL
        BEGIN
            SET @errmsg = CONCAT(
                'El precio de "', @prod, '" no coincide con sus opciones: se esperaba ',
                CONVERT(NVARCHAR(30), @esperado), ' y llego ', CONVERT(NVARCHAR(30), @recibido),
                '. Vuelve a agregar el producto.');
            RAISERROR(@errmsg, 16, 1);
            RETURN;
        END
    END

    /* Costo de UNA unidad vendida de cada linea, al costo actual de los ingredientes. */
    UPDATE l
       SET unit_cost = CAST(
              CASE WHEN l.inventory_mode = 'NONE' THEN l.product_cost ELSE 0 END
            + ISNULL((SELECT SUM(r.qty_per_unit * ISNULL(p.cost, 0))
                        FROM #req r JOIN dbo.products p ON p.id = r.product_id
                       WHERE r.line_no = l.line_no), 0) AS DECIMAL(14,4))
    FROM #lines l;

    /* Necesidad total por producto, en orden de id (orden de bloqueo). */
    CREATE TABLE #need (
        product_id INT NOT NULL PRIMARY KEY CLUSTERED,
        qty DECIMAL(14,4) NOT NULL
    );
    INSERT INTO #need (product_id, qty)
    SELECT r.product_id, SUM(r.qty_per_unit * l.quantity)
    FROM #req r JOIN #lines l ON l.line_no = r.line_no
    GROUP BY r.product_id;

    CREATE TABLE #map (sale_detail_id INT NOT NULL, line_no INT NOT NULL);

    /* 0073 Venta suelta: los paquetes que esta venta abre (ver paso 3c). Se
       crea siempre, vacia, para que los pasos siguientes la lean sin
       preguntar si existe. */
    CREATE TABLE #vs_abrir (
        hijo   INT NOT NULL PRIMARY KEY CLUSTERED,
        padre  INT NOT NULL,
        piezas INT NOT NULL,
        abrir  INT NOT NULL
    );

    BEGIN TRY
        BEGIN TRAN;
        IF @client_sale_key IS NOT NULL BEGIN
          DECLARE @prior_id INT, @prior_hash VARCHAR(64);
          SELECT @prior_id=id,@prior_hash=client_sale_hash FROM dbo.sales WITH(UPDLOCK,HOLDLOCK) WHERE client_sale_key=@client_sale_key;
          IF @prior_id IS NOT NULL BEGIN
            IF @prior_hash IS NULL OR @client_sale_hash IS NULL OR @prior_hash<>@client_sale_hash THROW 51000,'La identidad del cobro ya pertenece a otra intencion.',1;
            COMMIT TRAN; SELECT id AS sale_id,total,payment_method,register_id,service_mode,CAST(0 AS BIT) AS is_credit FROM dbo.sales WHERE id=@prior_id; RETURN;
          END
        END
        DECLARE @sale_closure INT;
        SELECT TOP 1 @sale_closure=id FROM dbo.cash_closures WITH(UPDLOCK,HOLDLOCK) WHERE register_id=@register_id AND closed_at IS NULL ORDER BY id DESC;
        IF @sale_closure IS NULL THROW 51000,'Abre el turno de esta caja antes de vender.',1;
        IF @commercial_quote IS NOT NULL
        BEGIN
          IF NOT EXISTS(SELECT 1 FROM dbo.commercial_quotes WITH(UPDLOCK,HOLDLOCK) WHERE id=@commercial_quote
              AND sale_id IS NULL AND ((@commercial_payment_reference IS NULL AND payment_reference IS NULL AND expires_at>SYSUTCDATETIME() AND policy_version=(SELECT version FROM dbo.commercial_policy WITH(HOLDLOCK) WHERE id=1))
                OR (@payment_method='TERMINAL_MP' AND payment_reference=@commercial_payment_reference)))
            THROW 51000,'La cotización cambió o ya se utilizó. Revisa la cuenta.',1;
          IF @commercial_payment_reference IS NULL AND EXISTS(SELECT 1 FROM OPENJSON(@cq,'$.catalog') WITH(id INT,price DECIMAL(10,2)) c
             JOIN dbo.products p WITH(HOLDLOCK) ON p.id=c.id WHERE p.price<>c.price)
            THROW 51000,'Cambió el precio del catálogo. Revisa la cuenta.',1;
          IF @commercial_payment_reference IS NULL AND EXISTS(SELECT 1 FROM OPENJSON(@cq,'$.optionPrices') WITH(id INT,price DECIMAL(10,2)) c
             LEFT JOIN dbo.modifier_options o WITH(HOLDLOCK) ON o.id=c.id WHERE o.id IS NULL OR o.active=0 OR o.price_delta<>c.price)
            THROW 51000,'Cambió el precio de una opción. Revisa la cuenta.',1;
        END;

        /* 3c) 0073 Venta suelta: abrir paquetes.
           Un producto suelto (el cigarro) cuelga de su paquete (la cajetilla
           de 20) en dbo.venta_suelta. Si la venta pide mas piezas sueltas de
           las que hay, se abren los paquetes justos: paquete -N, suelto
           +N x piezas. Asi el stock sigue en piezas enteras y la validacion
           del paso 4 ya ve las piezas que salieron del paquete.
           Bloqueo: sueltos y paquetes juntos, en orden ascendente de id, el
           mismo orden del paso 4 (que despues los vuelve a pedir y ya los
           tiene). Sin el modulo o en Venta Esencial no se abre nada. */
        IF ISNULL(@venta_esencial, 0) = 0
           AND EXISTS (SELECT 1 FROM dbo.business_modules WHERE module_key = N'venta-suelta' AND enabled = 1)
           AND EXISTS (SELECT 1 FROM #need n JOIN dbo.venta_suelta v ON v.product_id = n.product_id)
        BEGIN
            CREATE TABLE #vs_lock (product_id INT NOT NULL PRIMARY KEY CLUSTERED);
            INSERT INTO #vs_lock (product_id)
            SELECT product_id FROM #need
            UNION
            SELECT v.parent_product_id FROM #need n JOIN dbo.venta_suelta v ON v.product_id = n.product_id;

            SELECT p.id AS product_id, p.stock, p.nombre
            INTO #vs_stk
            FROM #vs_lock AS l
            INNER LOOP JOIN dbo.products AS p WITH (UPDLOCK, HOLDLOCK) ON p.id = l.product_id
            OPTION (FORCE ORDER);

            INSERT INTO #vs_abrir (hijo, padre, piezas, abrir)
            SELECT v.product_id, v.parent_product_id, v.piezas,
                   CAST(CEILING((n.qty - h.stock) / v.piezas) AS INT)
            FROM #need n
            JOIN dbo.venta_suelta v ON v.product_id = n.product_id
            JOIN #vs_stk h ON h.product_id = n.product_id
            WHERE n.qty > h.stock;

            /* El paquete tambien puede venderse entero en la misma venta: lo
               que se abre sale de lo que sobra despues de eso. */
            DECLARE @vs_padre NVARCHAR(100) = NULL, @vs_hijo NVARCHAR(100) = NULL;
            SELECT TOP 1 @vs_padre = pp.nombre, @vs_hijo = ph.nombre
            FROM (SELECT padre, SUM(abrir) AS abrir FROM #vs_abrir GROUP BY padre) a
            JOIN #vs_stk pp ON pp.product_id = a.padre
            LEFT JOIN #need np ON np.product_id = a.padre
            CROSS APPLY (SELECT TOP 1 s.nombre FROM #vs_abrir x JOIN #vs_stk s ON s.product_id = x.hijo
                          WHERE x.padre = a.padre ORDER BY x.hijo) ph
            WHERE pp.stock - ISNULL(np.qty, 0) < a.abrir
            ORDER BY a.padre;
            IF @vs_padre IS NOT NULL
            BEGIN
                SET @errmsg = CONCAT('No alcanzan las piezas de ', @vs_hijo, ' y no hay ', @vs_padre, ' para abrir.');
                RAISERROR(@errmsg, 16, 1);
            END

            UPDATE p SET p.stock = p.stock - a.abrir
            FROM dbo.products p
            JOIN (SELECT padre, SUM(abrir) AS abrir FROM #vs_abrir GROUP BY padre) a ON a.padre = p.id;

            UPDATE p SET p.stock = p.stock + a.abrir * a.piezas
            FROM dbo.products p
            JOIN #vs_abrir a ON a.hijo = p.id;
        END

        /* 4) Bloqueo consistente y validacion de stock.
           LOOP JOIN + FORCE ORDER: se recorre #need por su clave y se toma el
           bloqueo de cada products en orden ascendente de id. */
        SELECT p.id AS product_id, p.stock, n.qty, p.nombre
        INTO #stk
        FROM #need AS n
        INNER LOOP JOIN dbo.products AS p WITH (UPDLOCK, HOLDLOCK) ON p.id = n.product_id
        OPTION (FORCE ORDER);

        DECLARE @pid INT = NULL, @stk DECIMAL(12,2), @rq DECIMAL(14,4), @pname NVARCHAR(100);
        SELECT TOP 1 @pid = product_id, @stk = stock, @rq = qty, @pname = nombre
        FROM #stk WHERE stock < qty ORDER BY product_id;

        IF @pid IS NOT NULL AND ISNULL(@venta_esencial, 0) = 0
        BEGIN
            SET @errmsg =
                CONCAT('No hay stock suficiente. ProductoId=', @pid,
                       ', Stock=', CONVERT(NVARCHAR(30), @stk),
                       ', Requerido=', CONVERT(NVARCHAR(30), @rq),
                       ' (', @pname, ')');
            /* El CATCH hace el ROLLBACK: ver nota de cabecera. */
            RAISERROR(@errmsg, 16, 1);
        END

        /* 5) Total */
        SELECT @total = SUM(quantity * unit_price) FROM #lines;
        DECLARE @cash_applied DECIMAL(12,2)=CASE WHEN @payment_method='EFECTIVO' THEN @total ELSE 0 END;
        DECLARE @pay TABLE(method NVARCHAR(50),amount DECIMAL(12,2),received DECIMAL(12,2),reference NVARCHAR(100));
        IF @payments_json IS NOT NULL BEGIN
          IF ISJSON(@payments_json)<>1 OR LEFT(LTRIM(@payments_json),1)<>'[' OR @payment_method='TERMINAL_MP' THROW 51000,'Distribucion de pagos invalida.',1;
          IF EXISTS(SELECT 1 FROM OPENJSON(@payments_json) j WHERE j.type<>5 OR TRY_CONVERT(DECIMAL(18,4),JSON_VALUE(j.value,'$.amount')) IS NULL OR TRY_CONVERT(DECIMAL(18,4),JSON_VALUE(j.value,'$.amount'))<>TRY_CONVERT(DECIMAL(12,2),JSON_VALUE(j.value,'$.amount')) OR (JSON_VALUE(j.value,'$.received') IS NOT NULL AND (TRY_CONVERT(DECIMAL(18,4),JSON_VALUE(j.value,'$.received')) IS NULL OR TRY_CONVERT(DECIMAL(18,4),JSON_VALUE(j.value,'$.received'))<>TRY_CONVERT(DECIMAL(12,2),JSON_VALUE(j.value,'$.received')))) OR LEN(JSON_VALUE(j.value,'$.reference'))>100) THROW 51000,'Importe o referencia de pago invalido.',1;
          INSERT @pay SELECT method,amount,CASE WHEN method='EFECTIVO' THEN ISNULL(received,amount) ELSE NULL END,reference FROM OPENJSON(@payments_json) WITH(method NVARCHAR(50),amount DECIMAL(12,2),received DECIMAL(12,2),reference NVARCHAR(100));
          IF (SELECT COUNT(*) FROM @pay) NOT BETWEEN 1 AND 4 OR EXISTS(SELECT 1 FROM @pay WHERE method IS NULL OR method NOT IN('EFECTIVO','TARJETA','TRANSFERENCIA','PLATAFORMA','CAMBIO','CREDITO') OR amount IS NULL OR amount<=0 OR (method='EFECTIVO' AND received<amount)) OR EXISTS(SELECT method FROM @pay GROUP BY method HAVING COUNT(*)>1) OR (SELECT SUM(amount) FROM @pay)<>@total THROW 51000,'Los pagos deben cubrir exactamente la venta, sin metodos duplicados.',1;
          /* 0065: CAMBIO paga con lo que una devolución apartó para el cambio. La
             referencia es esa devolución; se usa entera y una sola vez. */
          IF EXISTS(SELECT 1 FROM @pay p WHERE p.method='CAMBIO' AND NOT EXISTS(
               SELECT 1 FROM dbo.sale_refunds r WITH (UPDLOCK, HOLDLOCK)
                WHERE r.id=TRY_CONVERT(INT,p.reference) AND r.exchange_amount=p.amount AND r.exchange_sale_id IS NULL))
            THROW 51000,'Ese cambio ya se usó o no coincide con la devolución.',1;
          SELECT @cash_applied=ISNULL(SUM(CASE WHEN method='EFECTIVO' THEN amount ELSE 0 END),0) FROM @pay;
          /* 0081: una parte A CREDITO. La venta SIGUE SIENDO de credito
             (payment_method CREDITO, saldo = lo fiado): asi la ven los abonos,
             el limite del cliente, la cobranza y las devoluciones, que ya
             saben de ventas a credito con una parte pagada. Lo demas se cobra
             ahora y queda en sale_payments, como cualquier pago dividido. */
          SET @credito=(SELECT amount FROM @pay WHERE method='CREDITO');
          IF @credito IS NOT NULL
          BEGIN
            IF @customer_id IS NULL THROW 51000,'La parte a credito necesita el cliente.',1;
            SET @is_credit=1;
            SET @payment_method='CREDITO';
          END
          ELSE
            SET @payment_method=CASE WHEN (SELECT COUNT(*) FROM @pay)>1 THEN 'MIXTO' ELSE (SELECT TOP 1 method FROM @pay) END;
        END
        ELSE IF @payment_method='MIXTO' THROW 51000,'Falta la distribucion del pago mixto.',1;

        /* 5b) CREDITO: el cliente puede llevarselo fiado.
           La pantalla ya filtra, pero la regla vive AQUI, donde no hay pantalla
           que saltarse. La fila del cliente se bloquea: dos cajas vendiendole a
           la vez no pueden gastar dos veces el mismo disponible.

           Misma regla que sp_get_customers y sp_get_customers_with_credit_available:
             - activo, con limite, y sin riesgo alto (3);
             - sin ventas VENCIDAS: vencida = vencimiento + dias de gracia < hoy;
             - la deuda abierta mas esta venta no pasa del limite.
           Y si la venta no trae vencimiento, vence a los dias de plazo del cliente. */
        IF @is_credit = 1 AND @credito IS NULL SET @credito = @total;
        IF @is_credit = 1
        BEGIN
            DECLARE @cr_limite DECIMAL(12,2), @cr_activo BIT, @cr_riesgo TINYINT,
                    @cr_plazo INT, @cr_gracia INT, @cr_deuda DECIMAL(12,2), @cr_vencidas INT,
                    @cr_hoy DATE = CONVERT(date, GETDATE());

            SELECT @cr_limite = credit_limit, @cr_activo = active, @cr_riesgo = risk_level,
                   @cr_plazo = terms_days, @cr_gracia = grace_days
            FROM dbo.customers WITH (UPDLOCK, HOLDLOCK)
            WHERE id = @customer_id;

            IF @cr_limite IS NULL
                RAISERROR('El cliente de la venta a credito no existe.', 16, 1);
            IF @cr_activo = 0
                RAISERROR('El cliente esta inactivo: no se le puede vender a credito.', 16, 1);
            IF @cr_limite <= 0
                RAISERROR('Este cliente no tiene credito autorizado.', 16, 1);
            IF @cr_riesgo >= 3
                RAISERROR('Este cliente esta en riesgo alto: el credito nuevo esta suspendido.', 16, 1);

            SELECT @cr_deuda = ISNULL(SUM(balance), 0),
                   @cr_vencidas = ISNULL(SUM(CASE WHEN due_date IS NOT NULL
                                                   AND DATEADD(DAY, @cr_gracia, due_date) < @cr_hoy
                                                  THEN 1 ELSE 0 END), 0)
            FROM dbo.sales
            WHERE customer_id = @customer_id
              AND UPPER(payment_method) = 'CREDITO'
              AND balance > 0;

            IF @cr_vencidas > 0
                RAISERROR('Este cliente tiene ventas a credito vencidas. Registra un abono antes de volver a venderle a credito.', 16, 1);

            IF @cr_deuda + @credito > @cr_limite
            BEGIN
                SET @errmsg = CONCAT(CASE WHEN @credito < @total THEN 'Lo que queda a credito ($' ELSE 'La venta ($' END,
                                     FORMAT(@credito, 'N2', 'es-MX'),
                                     ') supera el credito disponible del cliente ($',
                                     FORMAT(CASE WHEN @cr_limite - @cr_deuda > 0 THEN @cr_limite - @cr_deuda ELSE 0 END, 'N2', 'es-MX'),
                                     ').');
                RAISERROR(@errmsg, 16, 1);
            END

            IF @due_date IS NULL AND @cr_plazo > 0
                SET @due_date = DATEADD(DAY, @cr_plazo, @cr_hoy);
        END

        /* 6) Venta */
        INSERT INTO sales (datee, useer_id, total, payment_method, customer_id, paid_amount, balance, due_date, register_id, service_mode, venta_esencial)
        VALUES (
          GETDATE(), @user_id, @total, @payment_method,
          @customer_id,
          CASE WHEN @is_credit = 1 THEN @total - @credito ELSE @total END,
          CASE WHEN @is_credit = 1 THEN @credito ELSE 0 END,
          @due_date,
          @register_id,
          @service_mode,
          ISNULL(@venta_esencial, 0)
        );

        SET @sale_id = SCOPE_IDENTITY();
        UPDATE dbo.sales SET client_sale_key=@client_sale_key,client_sale_hash=@client_sale_hash,closure_id=@sale_closure WHERE id=@sale_id;
        IF @payments_json IS NOT NULL INSERT dbo.sale_payments(sale_id,payment_method,amount,received,reference) SELECT @sale_id,method,amount,received,reference FROM @pay WHERE method<>'CREDITO';
        IF @payments_json IS NOT NULL
          UPDATE r SET exchange_sale_id=@sale_id FROM dbo.sale_refunds r JOIN @pay p ON p.method='CAMBIO' AND r.id=TRY_CONVERT(INT,p.reference);
        /* 0063: una venta de $0 (solo el beneficio del Club o un producto gratis) no tiene pago que registrar. */
        ELSE IF @is_credit=0 AND @total>0 INSERT dbo.sale_payments(sale_id,payment_method,amount) VALUES(@sale_id,@payment_method,@total);
        IF @commercial_quote IS NOT NULL BEGIN
          UPDATE dbo.commercial_quotes SET sale_id=@sale_id WHERE id=@commercial_quote;
          UPDATE dbo.sales SET commercial_snapshot=@cq WHERE id=@sale_id;
        END;

        /* El cupón de una cotización se consume DENTRO de la transacción de venta. */
        DECLARE @coupon_code NVARCHAR(24)=JSON_VALUE(@cq,'$.coupon.code'),@coupon_id INT;
        IF @coupon_code IS NOT NULL
        BEGIN
          /* 0064: también $ y %, que la cotización reparte entre los renglones. */
          IF ISNULL(TRY_CONVERT(DECIMAL(12,2),JSON_VALUE(@cq,'$.coupon.amountApplied')),0)<=0 THROW 51000,'El cupón no aplicó a ningún producto.',1;
          UPDATE ci SET uses_count=ci.uses_count+1,status=CASE WHEN ci.uses_count+1>=ci.uses_allowed THEN 'REDEEMED' ELSE ci.status END,sale_id=ISNULL(ci.sale_id,@sale_id)
          FROM dbo.coupon_instances ci JOIN dbo.coupon_definitions cd ON cd.id=ci.definition_id
          WHERE ci.code=@coupon_code AND ci.id=TRY_CONVERT(INT,JSON_VALUE(@cq,'$.coupon.instanceId')) AND (cd.kind IN ('AMOUNT','PERCENT') OR (cd.kind='FREE_PRODUCT' AND cd.product_id=TRY_CONVERT(INT,JSON_VALUE(@cq,'$.coupon.productId')))) AND ci.status='ISSUED' AND cd.active=1 AND ci.uses_count<ci.uses_allowed AND (ci.expires_at IS NULL OR ci.expires_at>=SYSDATETIME());
          IF @@ROWCOUNT<>1 THROW 51000,'El cupón venció o ya se utilizó. La venta no se registró.',1;
          SELECT @coupon_id=id FROM dbo.coupon_instances WHERE code=@coupon_code;
          INSERT dbo.loyalty_redemptions(kind,reward_instance_id,coupon_instance_id,sale_id,register_id,machine_id,amount_applied,created_at)
          VALUES('COUPON',NULL,@coupon_id,@sale_id,@register_id,@machine_id,TRY_CONVERT(DECIMAL(12,2),JSON_VALUE(@cq,'$.coupon.amountApplied')),SYSDATETIME());
        END;

        /* 7) Detalle (MERGE para recuperar line_no -> sale_detail_id) */
        /* `recipe_id` y `variant_option_id` dejan constancia de CON QUE receta
           se preparo esta linea. No son el historico completo -si manana
           cambian `recipe_lines`, la receta ya no dice lo mismo-, pero
           permiten responder "esto se hizo con la receta Grande" sin tener que
           deducirlo. El consumo real queda congelado en inventory_movements. */
        MERGE INTO dbo.sale_detail AS t
        USING (SELECT line_no, product_id, quantity, unit_price, unit_cost, inventory_mode, note,
                      recipe_id, variant_option_id FROM #lines) AS s
           ON 1 = 0
        WHEN NOT MATCHED THEN
            INSERT (sale_id, product_id, quantity, unitary_price, unit_cost, inventory_mode, note,
                    recipe_id, variant_option_id)
            VALUES (@sale_id, s.product_id, s.quantity, s.unit_price, s.unit_cost, s.inventory_mode, s.note,
                    s.recipe_id, s.variant_option_id)
        OUTPUT inserted.id, s.line_no INTO #map (sale_detail_id, line_no);
        UPDATE d SET tax_rate=p.tasa_iva,tax_object=p.objeto_impuesto FROM dbo.sale_detail d JOIN dbo.products p ON p.id=d.product_id WHERE d.sale_id=@sale_id;
        /* 0083: IEPS y demás impuestos del renglón, con su valor de hoy. */
        EXEC dbo.sp_venta_impuestos @sale_id = @sale_id;

        IF @cq IS NOT NULL UPDATE d SET commercial_snapshot=c.audit
          FROM dbo.sale_detail d JOIN #map m ON m.sale_detail_id=d.id
          JOIN OPENJSON(@cq,'$.lines') WITH(line_no INT,audit NVARCHAR(MAX) AS JSON) c ON c.line_no=m.line_no;

        /* El snapshot guarda lo que se COBRO y ahora tambien lo que el
           modificador HIZO fisicamente: que ingrediente metio, cual quito y
           con que cantidades. Antes solo quedaba el nombre y el precio, asi
           que auditar "por que esta venta consumio leche de almendra" obligaba
           a mirar la definicion ACTUAL de la opcion, que pudo cambiar.
           `price_delta` sale de `modifier_options`, no de lo que mando la
           pantalla: el precio canonico es el de la configuracion. */
        INSERT INTO dbo.sale_detail_modifiers (
            sale_detail_id, modifier_option_id, group_name, option_name, price_delta, quantity, effect,
            ingredient_product_id, replaces_product_id, qty_base_aplicado, qty_factor_aplicado)
        SELECT mp.sale_detail_id, m.option_id, m.group_name, m.option_name, ISNULL(m.price_delta, 0), m.qty, m.effect,
               m.ingredient_product_id, m.replaces_product_id, m.qty_base, m.qty_factor
        FROM #mods m
        JOIN #map mp ON mp.line_no = m.line_no;

        /* 8 y 9) Inventario. En Venta Esencial NO se administra: ni stock ni
              movimientos. La venta registrada es la evidencia. */
        IF ISNULL(@venta_esencial, 0) = 0
        BEGIN
        /* 8) Stock */
        UPDATE p
        SET p.stock = p.stock - n.qty
        FROM products p
        JOIN #need n ON n.product_id = p.id;

        /* 9) Movimientos: uno por linea e ingrediente, ligados a la linea y al
              producto vendido; units = unidades vendidas que cubre. */
        INSERT INTO inventory_movements
            (product_id, typee, reference, quantity, datee, descriptionn, source, sale_detail_id, unit_cost, sold_product_id, units)
        SELECT r.product_id,
               'salida',
               CAST(@sale_id AS NVARCHAR(50)),
               SUM(r.qty_per_unit) * l.quantity,
               GETDATE(),
               CASE WHEN MAX(r.source) = 'SALE' THEN 'Venta' ELSE CONCAT('Venta: ', l.product_name) END,
               MAX(r.source),
               mp.sale_detail_id,
               ISNULL(p.cost, 0),
               l.product_id,
               l.quantity
        FROM #req r
        JOIN #lines l ON l.line_no = r.line_no
        JOIN #map mp ON mp.line_no = r.line_no
        JOIN dbo.products p ON p.id = r.product_id
        GROUP BY r.line_no, r.product_id, l.quantity, l.product_name, l.product_id, mp.sale_detail_id, p.cost;

        /* 9b) 0073 Los paquetes abiertos (paso 3c): salida del paquete y
              entrada de sus piezas, con la venta como referencia. Fuente
              'APERTURA': la devolucion (que repone solo SALE/RECIPE) no los
              deshace; las piezas devueltas vuelven sueltas. */
        INSERT INTO inventory_movements
            (product_id, typee, reference, quantity, datee, descriptionn, source, unit_cost, sold_product_id)
        SELECT a.padre, 'salida', CAST(@sale_id AS NVARCHAR(50)), a.abrir, GETDATE(),
               CONCAT('Abierto para vender suelto: ', h.nombre), 'APERTURA', ISNULL(pp.cost, 0), a.hijo
        FROM #vs_abrir a
        JOIN dbo.products pp ON pp.id = a.padre
        JOIN dbo.products h ON h.id = a.hijo
        UNION ALL
        SELECT a.hijo, 'entrada', CAST(@sale_id AS NVARCHAR(50)), a.abrir * a.piezas, GETDATE(),
               CONCAT('Piezas de ', pp.nombre, ' abierto'), 'APERTURA',
               CAST(ISNULL(pp.cost, 0) / a.piezas AS DECIMAL(14, 4)), a.hijo
        FROM #vs_abrir a
        JOIN dbo.products pp ON pp.id = a.padre;
        END

        /* 10) Movimiento CAJA (solo EFECTIVO contado) - turno POR CAJA.
           0081: tambien la parte en efectivo de una venta con una parte a
           credito: ese dinero si entro al cajon. */
        IF @cash_applied > 0
        BEGIN
            DECLARE @closure_id_open INT;

            SELECT TOP(1) @closure_id_open = id
            FROM dbo.cash_closures WITH (UPDLOCK, HOLDLOCK)
            WHERE register_id = @register_id
              AND closed_at IS NULL
            ORDER BY opened_at DESC, id DESC;

            IF @closure_id_open IS NULL
            BEGIN
                RAISERROR('No hay un turno abierto en esta caja para registrar la venta en efectivo.',16,1);
            END

            INSERT INTO cash_movements
            (datee, userId, typee, reference_id, reference, amount, note, closure_id, register_id)
            VALUES
            (GETDATE(), @user_id, 'SALE', @sale_id, CONCAT('Venta ', @sale_id), @cash_applied, NULL, @closure_id_open, @register_id);
        END

        /* 11) Club (0063): membresías que se cobran en esta venta y el
           beneficio del día. Dentro de la transacción: si no procede, la
           venta no se registra. */
        EXEC dbo.sp_membership_apply_sale @sale_id = @sale_id, @customer_id = @customer_id,
             @user_id = @user_id, @register_id = @register_id, @quote = @cq;
        /* 12) Puntos y sellos (0064): el canje se descuenta aquí, con el
           saldo comprobado bajo candado. */
        EXEC dbo.sp_loyalty_points_apply_sale @sale_id = @sale_id, @customer_id = @customer_id,
             @user_id = @user_id, @quote = @cq;

        COMMIT TRAN;

        SELECT
            @sale_id        AS sale_id,
            @total          AS total,
            @payment_method AS payment_method,
            @is_credit      AS is_credit,
            @register_id    AS register_id,
            @service_mode   AS service_mode;

    END TRY
    BEGIN CATCH
        IF XACT_STATE() <> 0 ROLLBACK TRAN;
        DECLARE @msg NVARCHAR(4000) = ERROR_MESSAGE();
        DECLARE @num INT = ERROR_NUMBER();
        /* 1205 (deadlock) se re-lanza con su numero original en el mensaje
           para que el IPC lo reconozca y reintente la misma intencion. */
        IF @num = 1205 SET @msg = CONCAT('[1205] ', @msg);
        RAISERROR(@msg, 16, 1);
    END CATCH
END
GO

/* ---------- sp_update_sale (SQL_STORED_PROCEDURE) ---------- */
/* sp_update_sale
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* -------------------- sp_update_sale -------------------- */
CREATE OR ALTER PROCEDURE [dbo].[sp_update_sale]
  @sale_id INT,
  @user_id INT,
  @SaleDetails dbo.SaleDetailType READONLY,
  @note NVARCHAR(400) = NULL,
  -- 0049: la caja donde se cobra o se devuelve la diferencia. El turno se
  -- busca por caja, no por quien lo abrio (mismo criterio que la devolucion).
  @register_id INT = NULL,
  @machine_id NVARCHAR(64) = NULL,
  @machine_name NVARCHAR(120) = NULL
AS
BEGIN
  SET NOCOUNT ON;
  SET XACT_ABORT ON;

  IF @sale_id IS NULL OR @sale_id <= 0
  BEGIN
    RAISERROR('sale_id inválido.',16,1);
    RETURN;
  END

  BEGIN TRY
    BEGIN TRAN;

    IF EXISTS(SELECT 1 FROM dbo.sales WHERE id=@sale_id AND commercial_snapshot IS NOT NULL) THROW 51000,'Las ventas con ofertas se corrigen mediante devolución y una nueva venta.',1;
    IF EXISTS(SELECT 1 FROM dbo.sales WHERE id=@sale_id AND payment_method='MIXTO') THROW 51000,'Corrige un pago mixto mediante devolución y una nueva venta.',1;
    IF EXISTS (SELECT 1 FROM dbo.sale_refunds WHERE sale_id = @sale_id)
    BEGIN
      RAISERROR('No se puede actualizar: la venta ya tiene reembolsos.',16,1);
      ROLLBACK TRAN;
      RETURN;
    END

    /* La edicion recalcula stock por PRODUCTO vendido: solo vale para lineas
       DIRECT sin modificadores. Una venta con recetas se corrige con
       Reembolso / Cambio, que repone lo que realmente se consumio. */
    IF EXISTS (SELECT 1 FROM dbo.sale_detail d WHERE d.sale_id = @sale_id AND d.inventory_mode = 'RECIPE')
       OR EXISTS (SELECT 1 FROM dbo.sale_detail d JOIN dbo.sale_detail_modifiers m ON m.sale_detail_id = d.id WHERE d.sale_id = @sale_id)
       OR EXISTS (SELECT 1 FROM @SaleDetails n JOIN dbo.products p ON p.id = n.product_id WHERE p.inventory_mode = 'RECIPE')
    BEGIN
      RAISERROR('Esta venta contiene recetas o modificadores: usa Reembolso / Cambio en lugar de modificarla.',16,1);
      ROLLBACK TRAN;
      RETURN;
    END

    DECLARE @old_total DECIMAL(12,2);
    DECLARE @payment_method NVARCHAR(50);
    DECLARE @customer_id INT;
    DECLARE @paid_amount DECIMAL(12,2);
    DECLARE @balance DECIMAL(12,2);

    SELECT
      @old_total = s.total,
      @payment_method = s.payment_method,
      @customer_id = s.customer_id,
      @paid_amount = s.paid_amount,
      @balance = s.balance
    FROM dbo.sales s WITH (UPDLOCK, HOLDLOCK)
    WHERE s.id = @sale_id;

    IF @old_total IS NULL
    BEGIN
      RAISERROR('La venta no existe.',16,1);
      ROLLBACK TRAN;
      RETURN;
    END

    IF (@customer_id IS NOT NULL AND UPPER(@payment_method)='CREDITO')
       AND (ISNULL(@paid_amount,0) > 0 AND ISNULL(@balance,0) < ISNULL(@old_total,0))
    BEGIN
      RAISERROR('No se puede actualizar: venta a crédito con pagos registrados.',16,1);
      ROLLBACK TRAN;
      RETURN;
    END

    ;WITH n AS (
      SELECT product_id, SUM(quantity) AS qty, MAX(unit_price) AS unit_price
      FROM @SaleDetails
      GROUP BY product_id
    )
    SELECT * INTO #new FROM n;

    SELECT
      d.product_id,
      SUM(d.quantity) AS qty,
      MAX(d.unitary_price) AS unit_price,
      MAX(d.unit_cost) AS unit_cost
    INTO #old
    FROM dbo.sale_detail d
    WHERE d.sale_id = @sale_id
    GROUP BY d.product_id;

    /* Solo los productos con inventario directo mueven stock; NONE no. */
    ;WITH delta AS (
      SELECT
        COALESCE(o.product_id, n.product_id) AS product_id,
        ISNULL(o.qty,0) AS old_qty,
        ISNULL(n.qty,0) AS new_qty,
        CASE WHEN p.inventory_mode = 'DIRECT' THEN (ISNULL(o.qty,0) - ISNULL(n.qty,0)) ELSE 0 END AS stock_change
      FROM #old o
      FULL JOIN #new n ON n.product_id = o.product_id
      JOIN dbo.products p ON p.id = COALESCE(o.product_id, n.product_id)
    )
    SELECT * INTO #delta FROM delta;

    IF EXISTS (
      SELECT 1
      FROM #delta d
      JOIN dbo.products p WITH (UPDLOCK, HOLDLOCK) ON p.id = d.product_id
      WHERE d.stock_change < 0
        AND p.stock < ABS(d.stock_change)
    )
    BEGIN
      RAISERROR('No hay stock suficiente para aumentar cantidades en la venta.',16,1);
      ROLLBACK TRAN;
      RETURN;
    END

    UPDATE p
    SET p.stock = p.stock + d.stock_change
    FROM dbo.products p
    JOIN #delta d ON d.product_id = p.id;

    DECLARE @new_total DECIMAL(12,2);
    SELECT @new_total = ISNULL(SUM(qty * unit_price),0) FROM #new;

    DELETE FROM dbo.sale_detail WHERE sale_id = @sale_id;

    /* Se conserva el costo congelado de la linea original; una linea nueva
       toma el costo actual del producto. */
    INSERT INTO dbo.sale_detail (sale_id, product_id, quantity, unitary_price, unit_cost, inventory_mode)
    SELECT @sale_id, n.product_id, n.qty, n.unit_price, ISNULL(o.unit_cost, p.cost), p.inventory_mode
    FROM #new n
    JOIN dbo.products p ON p.id = n.product_id
    LEFT JOIN #old o ON o.product_id = n.product_id;

    /* 0083: el IVA del renglón (como en sp_register_sale) y los demás impuestos. */
    UPDATE d SET tax_rate = p.tasa_iva, tax_object = p.objeto_impuesto
      FROM dbo.sale_detail d JOIN dbo.products p ON p.id = d.product_id WHERE d.sale_id = @sale_id;
    EXEC dbo.sp_venta_impuestos @sale_id = @sale_id;

    INSERT INTO dbo.inventory_movements (product_id, typee, reference, quantity, datee, descriptionn, source, sold_product_id, units, unit_cost)
    SELECT
      d.product_id,
      CASE WHEN d.stock_change < 0 THEN 'salida' ELSE 'entrada' END,
      CAST(@sale_id AS NVARCHAR(50)),
      ABS(d.stock_change),
      GETDATE(),
      CONCAT('Ajuste venta ', @sale_id, COALESCE(CONCAT(' - ', @note), '')),
      'EDIT',
      d.product_id,
      ABS(d.stock_change),
      p.cost
    FROM #delta d
    JOIN dbo.products p ON p.id = d.product_id
    WHERE d.stock_change <> 0;

    UPDATE dbo.sales
    SET total = @new_total,
        paid_amount = CASE
            WHEN @customer_id IS NOT NULL AND UPPER(@payment_method)='CREDITO' THEN ISNULL(paid_amount,0)
            ELSE @new_total
        END,
        balance = CASE
            WHEN @customer_id IS NOT NULL AND UPPER(@payment_method)='CREDITO' THEN @new_total
            ELSE 0
        END
    WHERE id = @sale_id;

    IF (@customer_id IS NULL OR UPPER(@payment_method) <> 'CREDITO')
       AND UPPER(@payment_method)='EFECTIVO'
    BEGIN
      DECLARE @delta_total DECIMAL(12,2) = (@new_total - ISNULL(@old_total,0));

      /* Sin diferencia no se toca el cajon, y por lo tanto no hace falta ni
         caja ni turno: editar una venta sin cambiar su total no debe fallar
         porque la caja este cerrada. */
      IF @delta_total <> 0
      BEGIN
        DECLARE @caja INT, @closure_id_open INT;
        EXEC dbo.sp_resolve_cash_register
            @register_id = @register_id, @machine_id = @machine_id,
            @machine_name = @machine_name, @user_id = @user_id, @resolved = @caja OUTPUT;
        IF @caja IS NULL
          RAISERROR('No se pudo determinar la caja del ajuste. Abre el turno en esta caja e intenta de nuevo.',16,1);

        SELECT TOP(1) @closure_id_open = id
        FROM dbo.cash_closures WITH (UPDLOCK, HOLDLOCK)
        WHERE register_id = @caja AND closed_at IS NULL
        ORDER BY opened_at DESC, id DESC;

        IF @closure_id_open IS NULL
          RAISERROR('No hay turno abierto para registrar el ajuste en caja.',16,1);

        INSERT INTO dbo.cash_movements
          (datee, userId, typee, reference_id, reference, amount, note, closure_id, register_id)
        VALUES
          (GETDATE(), @user_id, 'SALE_ADJ', @sale_id,
           CONCAT('Ajuste Venta ', @sale_id),
           @delta_total,
           @note,
           @closure_id_open,
           @caja);
      END
    END

    UPDATE p SET amount=s.total FROM dbo.sale_payments p JOIN dbo.sales s ON s.id=p.sale_id WHERE s.id=@sale_id;
    COMMIT TRAN;

    SELECT
      @sale_id AS sale_id,
      @old_total AS old_total,
      @new_total AS new_total,
      (@new_total - @old_total) AS delta_total;

  END TRY
  BEGIN CATCH
    IF XACT_STATE() <> 0 ROLLBACK TRAN;
    DECLARE @msg NVARCHAR(4000) = ERROR_MESSAGE();
    RAISERROR(@msg,16,1);
  END CATCH
END
GO

/* ---------- sp_venta_impuestos (SQL_STORED_PROCEDURE) ---------- */
/* sp_venta_impuestos
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* ====================== sp_venta_impuestos (0083) ======================
   La foto de los impuestos que NO son IVA de una venta, renglón por renglón.
   La llaman sp_register_sale y sp_update_sale justo después de fijar el IVA
   del renglón. Es idempotente: borra la foto anterior de esa venta.

   El precio incluye todo. Con P el importe cobrado del renglón, q las piezas,
   v la tasa de IVA (0 si no es objeto '02'):
     Te = Σ tasas que van en la base del IVA (IEPS)
     Tl = Σ tasas que no (impuestos locales)
     Ce = Σ cuota × cantidad × q que van en la base del IVA
     Cl = Σ cuota × cantidad × q que no
     P  = (B·(1+Te) + Ce)·(1+v) + B·Tl + Cl
     B  = (P − Ce·(1+v) − Cl) / ((1+Te)·(1+v) + Tl)
   Si el precio no alcanza ni para las cuotas (B <= 0), el renglón se deja
   sin foto: los reportes usan la cuenta de antes y nada se inventa.
   Un renglón de un producto sin otros impuestos no se toca (base_neta NULL).
   ======================================================================= */
CREATE OR ALTER PROCEDURE dbo.sp_venta_impuestos
    @sale_id INT
AS
BEGIN
    SET NOCOUNT ON;

    DELETE x FROM dbo.sale_detail_impuestos x
      JOIN dbo.sale_detail d ON d.id = x.sale_detail_id
     WHERE d.sale_id = @sale_id;
    UPDATE dbo.sale_detail SET base_neta = NULL, otros_impuestos = NULL
     WHERE sale_id = @sale_id AND (base_neta IS NOT NULL OR otros_impuestos IS NOT NULL);

    /* Los impuestos activos de cada renglón, con su valor de hoy. */
    SELECT d.id AS sale_detail_id, d.quantity AS q, CAST(d.subtotal AS DECIMAL(14, 4)) AS p,
           CASE WHEN ISNULL(d.tax_object, '02') = '02' THEN ISNULL(d.tax_rate, 0) ELSE 0 END AS v,
           i.id AS impuesto_id, i.nombre, i.clase, i.factor, i.tasa, i.cuota, i.en_base_iva,
           CAST(CASE WHEN i.factor = 'Cuota' THEN ISNULL(pi.cantidad, 1) * d.quantity END AS DECIMAL(14, 4)) AS unidades
      INTO #l
      FROM dbo.sale_detail d
      JOIN dbo.product_impuestos pi ON pi.product_id = d.product_id
      JOIN dbo.CAT_impuestos i ON i.id = pi.impuesto_id AND i.activo = 1
     WHERE d.sale_id = @sale_id AND d.quantity > 0;

    IF NOT EXISTS (SELECT 1 FROM #l) RETURN;

    SELECT sale_detail_id, MAX(p) AS p, MAX(v) AS v,
           SUM(CASE WHEN factor = 'Tasa' AND en_base_iva = 1 THEN tasa ELSE 0 END) AS te,
           SUM(CASE WHEN factor = 'Tasa' AND en_base_iva = 0 THEN tasa ELSE 0 END) AS tl,
           SUM(CASE WHEN factor = 'Cuota' AND en_base_iva = 1 THEN cuota * unidades ELSE 0 END) AS ce,
           SUM(CASE WHEN factor = 'Cuota' AND en_base_iva = 0 THEN cuota * unidades ELSE 0 END) AS cl
      INTO #r
      FROM #l GROUP BY sale_detail_id;

    ALTER TABLE #r ADD b DECIMAL(14, 4) NULL;
    UPDATE #r SET b = CAST((p - ce * (1 + v) - cl) / ((1 + te) * (1 + v) + tl) AS DECIMAL(14, 4));
    DELETE FROM #r WHERE b IS NULL OR b <= 0;

    INSERT INTO dbo.sale_detail_impuestos (sale_detail_id, impuesto_id, nombre, clase, factor, tasa, cuota, cantidad, base, importe)
    SELECT l.sale_detail_id, l.impuesto_id, l.nombre, l.clase, l.factor, l.tasa, l.cuota, l.unidades, r.b,
           CAST(CASE WHEN l.factor = 'Tasa' THEN r.b * l.tasa ELSE l.cuota * l.unidades END AS DECIMAL(14, 4))
      FROM #l l JOIN #r r ON r.sale_detail_id = l.sale_detail_id;

    UPDATE d SET base_neta = r.b,
                 otros_impuestos = (SELECT SUM(x.importe) FROM dbo.sale_detail_impuestos x WHERE x.sale_detail_id = d.id)
      FROM dbo.sale_detail d JOIN #r r ON r.sale_detail_id = d.id;
END
GO
