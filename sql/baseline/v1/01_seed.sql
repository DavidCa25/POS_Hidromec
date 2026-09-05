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
