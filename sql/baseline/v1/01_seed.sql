/*
 * Wybix — Baseline V1 · Seed estructural
 *
 * SOLO filas sin las cuales el producto no arranca. Nada de datos de demo,
 * nada de datos de usuario, ningun catalogo de ejemplo, ningun usuario por
 * defecto: el alta del primer administrador y de `business_config` es
 * responsabilidad de `sp_setup_inicial`, ya en manos del cliente.
 *
 * Ambos INSERT son idempotentes y no fuerzan valores de IDENTITY: sobre una
 * base recien creada la columna arranca en 1 por si misma.
 */

/* Multicaja. `sp_register_sale` resuelve la caja contra esta tabla; sin al
 * menos un register no se puede registrar una venta. */
IF NOT EXISTS (SELECT 1 FROM dbo.registers WHERE code = 'C1')
    INSERT INTO dbo.registers (code, name, is_active) VALUES ('C1', 'Caja 1', 1);
GO

/* Política comercial inicial: solo precio base, sin ofertas activas. */
IF OBJECT_ID(N'dbo.commercial_policy','U') IS NOT NULL AND NOT EXISTS(SELECT 1 FROM dbo.commercial_policy WHERE id=1)
INSERT dbo.commercial_policy(id,version,payload) VALUES(1,0,N'{"version":0,"channels":[{"id":"LOCAL","name":"Mostrador","active":true,"inheritBase":true}],"prices":[],"promotions":[],"combos":[]}');
GO

/* Y su fila de arriendo, LIBRE.
 *
 * El invariante del arriendo de caja es que TODA caja tiene su fila en
 * `register_assignments`: es lo que permite que reclamarla sea un UPDATE sobre
 * la clave primaria -una sola sentencia, un solo candado- en vez de un INSERT
 * condicional con su carrera. `sp_add_register` la crea en la misma
 * transaccion que la caja, y la migracion 0014 la sembro para las que ya
 * existian.
 *
 * Falta el tercer camino, y es justo el de una instalacion nueva: aqui la
 * Caja 1 nace del seed, no de `sp_add_register`, y 0014 ya viaja marcada como
 * aplicada en el template, asi que no vuelve a ejecutarse. Sin esta linea, el
 * unico register de una instalacion recien entregada seria el unico sin fila.
 *
 * `machine_id` vacio no coincide con ninguna maquina real y `released_at`
 * puesto la deja disponible: la primera caja que la reclame se la lleva. */
IF NOT EXISTS (SELECT 1 FROM dbo.register_assignments a
               JOIN dbo.registers r ON r.id = a.register_id WHERE r.code = 'C1')
    INSERT INTO dbo.register_assignments
        (register_id, machine_id, machine_name, claimed_at, heartbeat_at, lease_until, released_at, released_by)
    SELECT r.id, N'', NULL, SYSUTCDATETIME(), SYSUTCDATETIME(), SYSUTCDATETIME(), SYSUTCDATETIME(), N'INICIAL'
    FROM dbo.registers r WHERE r.code = 'C1';
GO

/* Singleton de configuracion de WhatsApp. `sp_WA_UpdateConfiguracion` hace
 * UPDATE sin upsert: si la fila no existe, el modulo queda inerte sin avisar.
 * Se siembra desactivada (Activo = 0), que es como viaja hoy en template.bak. */
IF NOT EXISTS (SELECT 1 FROM dbo.WA_Configuracion)
    INSERT INTO dbo.WA_Configuracion (SucursalId, Activo, AutoEnviarTicket)
    VALUES (NULL, 0, 1);
GO

/* Unidades de medida (anadidas por la migracion 0002, Wybix Core). Sin ellas
 * products.base_uom no puede resolverse: FK_products_base_uom. Mismo MERGE
 * idempotente que la migracion; el baseline V2 lo hereda tal cual. */
IF OBJECT_ID(N'dbo.uoms', 'U') IS NOT NULL
MERGE dbo.uoms AS t
USING (VALUES
    (N'pza', N'Pieza',       N'COUNT',  1,          1, 10),
    (N'g',   N'Gramo',       N'WEIGHT', 1,          1, 20),
    (N'kg',  N'Kilogramo',   N'WEIGHT', 1000,       0, 21),
    (N'mg',  N'Miligramo',   N'WEIGHT', 0.001,      0, 22),
    (N'oz',  N'Onza',        N'WEIGHT', 28.349523,  0, 23),
    (N'lb',  N'Libra',       N'WEIGHT', 453.59237,  0, 24),
    (N'ml',  N'Mililitro',   N'VOLUME', 1,          1, 30),
    (N'L',   N'Litro',       N'VOLUME', 1000,       0, 31),
    (N'cl',  N'Centilitro',  N'VOLUME', 10,         0, 32),
    (N'cm',  N'Centimetro',  N'LENGTH', 1,          1, 40),
    (N'm',   N'Metro',       N'LENGTH', 100,        0, 41),
    (N'mm',  N'Milimetro',   N'LENGTH', 0.1,        0, 42),
    (N'in',  N'Pulgada',     N'LENGTH', 2.54,       0, 43),
    (N'ft',  N'Pie',         N'LENGTH', 30.48,      0, 44)
) AS s (code, name, dimension, factor_to_base, is_base, sort_order)
ON t.code = s.code
WHEN NOT MATCHED THEN
    INSERT (code, name, dimension, factor_to_base, is_base, sort_order)
    VALUES (s.code, s.name, s.dimension, s.factor_to_base, s.is_base, s.sort_order);
GO

/* Modelo de seguridad (migracion 0029). La aplicacion tolera que falten
 * (usa valores por omision), pero una instalacion nueva debe quedar igual
 * que una actualizada: mismas filas, mismos valores iniciales. */
IF OBJECT_ID(N'dbo.database_metadata', 'U') IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM dbo.database_metadata WHERE clave = 'security_model_version')
    INSERT INTO dbo.database_metadata (clave, valor) VALUES ('security_model_version', '1');
IF OBJECT_ID(N'dbo.database_metadata', 'U') IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM dbo.database_metadata WHERE clave = 'security_revision')
    INSERT INTO dbo.database_metadata (clave, valor) VALUES ('security_revision', '1');
GO

/* Catalogo de tipos de movimiento de caja (migracion 0049). OBLIGATORIO:
 * cash_movements.typee tiene llave foranea a esta tabla, asi que sin estas
 * filas la primera venta en efectivo de una instalacion nueva fallaria.
 * Mismo MERGE que la migracion. */
IF OBJECT_ID(N'dbo.cash_movement_types', 'U') IS NOT NULL
MERGE dbo.cash_movement_types AS t
USING (VALUES
    ('OPENING',          N'Fondo inicial',                 'FONDO',        10),
    ('SALE',             N'Venta en efectivo',             'VENTAS',       20),
    ('SALE_ADJ',         N'Ajuste de venta',               'AJUSTES',      30),
    ('PAYMENT',          N'Abono de cliente en efectivo',  'ABONOS',       40),
    ('DEPOSIT',          N'Entrada de efectivo',           'ENTRADAS',     50),
    ('REFUND',           N'Devolucion en efectivo',        'DEVOLUCIONES', 60),
    ('WITHDRAW',         N'Retiro de caja',                'RETIROS',      70),
    ('SUPPLIER_PAYMENT', N'Pago a proveedor en efectivo',  'PROVEEDORES',  80),
    ('EXPENSE',          N'Egreso en efectivo',            'EGRESOS',      90),
    /* 0079 socios y propinas */
    ('PARTNER_OUT',      N'Retiro de socio',               'RETIROS',      72),
    ('PARTNER_IN',       N'Aportacion de socio',           'ENTRADAS',     52),
    ('TIP',              N'Propina en efectivo',           'ENTRADAS',     54),
    ('TIP_PAYOUT',       N'Pago de propinas',              'RETIROS',      74)
) AS s (code, label, grupo, sort_order)
ON t.code = s.code
WHEN NOT MATCHED THEN
    INSERT (code, label, grupo, sort_order) VALUES (s.code, s.label, s.grupo, s.sort_order);
GO

/* Conceptos de egreso iniciales (migracion 0049). "Pago al personal" es del
 * sistema: sin el no se puede registrar un pago al personal. El resto es un
 * punto de partida que cada negocio edita. */
IF OBJECT_ID(N'dbo.expense_categories', 'U') IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM dbo.expense_categories)
    INSERT INTO dbo.expense_categories (name, kind, is_system, sort_order) VALUES
        (N'Pago al personal', 'PERSONAL', 1, 10),
        (N'Renta',            'GENERAL',  0, 20),
        (N'Luz',              'GENERAL',  0, 30),
        (N'Agua',             'GENERAL',  0, 40),
        (N'Gas',              'GENERAL',  0, 50),
        (N'Internet',         'GENERAL',  0, 60),
        (N'Publicidad',       'GENERAL',  0, 70),
        (N'Limpieza',         'GENERAL',  0, 80),
        (N'Mantenimiento',    'GENERAL',  0, 90),
        (N'Otros',            'GENERAL',  0, 1000);
GO

/* Concepto del sistema para comisiones, promociones y retenciones de las
 * plataformas de entrega (0069): sin el no se puede confirmar una
 * liquidacion. Las bases que ya existian lo reciben de la migracion. */
IF OBJECT_ID(N'dbo.expense_categories', 'U') IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM dbo.expense_categories WHERE kind = 'PLATAFORMA')
    INSERT INTO dbo.expense_categories (name, kind, is_system, sort_order)
    VALUES (N'Comisiones de plataforma', 'PLATAFORMA', 1, 15);
GO

/* Singleton de puntos (0064). `sp_loyalty_points_config_save` hace UPDATE
 * sobre id = 1: sin la fila, encender los puntos no guarda nada. Nace apagada,
 * igual que en una base actualizada. */
IF OBJECT_ID(N'dbo.loyalty_points_config', 'U') IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM dbo.loyalty_points_config)
    INSERT INTO dbo.loyalty_points_config (id, enabled) VALUES (1, 0);
GO

/* Singleton del menu en linea (0067), con sus valores por omision. */
IF OBJECT_ID(N'dbo.menu_en_linea_config', 'U') IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM dbo.menu_en_linea_config WHERE id = 1)
    INSERT INTO dbo.menu_en_linea_config (id) VALUES (1);
GO

/* Catalogo de impuestos ademas del IVA (0083). Mismo MERGE que la migracion:
 * las tasas conocidas encendidas; las cuotas y el hospedaje, apagados y sin
 * valor (los captura el negocio). Sin esto, una instalacion nueva tendria la
 * 0083 registrada y el catalogo vacio. */
IF OBJECT_ID(N'dbo.CAT_impuestos', 'U') IS NOT NULL
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
