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
