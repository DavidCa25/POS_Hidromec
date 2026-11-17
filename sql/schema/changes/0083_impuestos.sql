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
