/* sp_loyalty_catalog
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* ============================================================
   sp_loyalty_catalog — todo Fidelizacion en UNA consulta.

   La pantalla de administracion necesita campanas, recompensas, cupones,
   dinamicas, rifas y los numeros del panel a la vez. Pedirlos uno a uno
   serian seis viajes para pintar una sola pantalla, y con la base en otra
   maquina de la LAN eso se nota.

   Mismo criterio que `sp_get_menu_catalog`, que ya resolvia esto para Touch.

   Devuelve SIETE resultsets, en este orden:
     1 campanas            5 rifas (con su conteo de participaciones)
     2 recompensas         6 resumen para el panel
     3 cupones             7 productos elegibles (para las condiciones)
     4 dinamicas
   ============================================================ */
CREATE OR ALTER PROCEDURE [dbo].[sp_loyalty_catalog]
AS
BEGIN
    SET NOCOUNT ON;

    SELECT c.id, c.name, c.description, c.outcome,
           c.reward_definition_id, c.coupon_definition_id, c.dynamic_definition_id, c.raffle_id,
           c.quantity, c.per_amount,
           c.min_total, c.product_id, c.requires_customer, c.first_purchase_only,
           c.weekday_mask, c.time_from, c.time_to, c.starts_at, c.ends_at,
           c.priority, c.active, c.created_at,
           p.nombre AS product_name,
           /* Que otorga, ya resuelto: la pantalla no tiene que cruzar cuatro
              catalogos para escribir una linea de resumen. */
           COALESCE(rd.name, cd.name, dd.name, rf.name) AS outcome_name
    FROM dbo.campaigns c
    LEFT JOIN dbo.products p ON p.id = c.product_id
    LEFT JOIN dbo.reward_definitions rd ON rd.id = c.reward_definition_id
    LEFT JOIN dbo.coupon_definitions cd ON cd.id = c.coupon_definition_id
    LEFT JOIN dbo.dynamic_definitions dd ON dd.id = c.dynamic_definition_id
    LEFT JOIN dbo.raffle_definitions rf ON rf.id = c.raffle_id
    ORDER BY c.active DESC, c.priority, c.id;

    SELECT r.id, r.name, r.kind, r.product_id, r.amount, r.discount_pct, r.notes,
           r.valid_days, r.uses_allowed, r.active, r.created_at,
           p.nombre AS product_name,
           (SELECT COUNT(*) FROM dbo.reward_instances i WHERE i.definition_id = r.id) AS emitidas
    FROM dbo.reward_definitions r
    LEFT JOIN dbo.products p ON p.id = r.product_id
    ORDER BY r.active DESC, r.name;

    SELECT c.id, c.name, c.kind, c.amount, c.discount_pct, c.product_id,
           c.valid_days, c.uses_allowed, c.code_prefix, c.active, c.created_at,
           p.nombre AS product_name,
           (SELECT COUNT(*) FROM dbo.coupon_instances i WHERE i.definition_id = c.id) AS emitidos
    FROM dbo.coupon_definitions c
    LEFT JOIN dbo.products p ON p.id = c.product_id
    ORDER BY c.active DESC, c.name;

    SELECT d.id, d.name, d.type, d.description, d.target_value, d.tolerance,
           d.attempts_allowed, d.reward_definition_id, d.active, d.created_at,
           rd.name AS reward_name,
           (SELECT COUNT(*) FROM dbo.dynamic_attempts a WHERE a.definition_id = d.id) AS intentos,
           (SELECT COUNT(*) FROM dbo.dynamic_attempts a WHERE a.definition_id = d.id AND a.result = 'WIN') AS ganados
    FROM dbo.dynamic_definitions d
    LEFT JOIN dbo.reward_definitions rd ON rd.id = d.reward_definition_id
    ORDER BY d.active DESC, d.name;

    /* `tickets_total` viaja AQUI, no solo en el detalle: esta lista es la
       que alimenta el formulario de edicion y el boton de activar. Sin el,
       abrir una rifa ensenaba el campo vacio aunque estuviera guardado, y
       activarla lo borraba, porque activar vuelve a guardar la rifa entera
       con lo que tiene la lista. */
    SELECT r.id, r.name, r.description, r.prize, r.starts_at, r.ends_at,
           r.status, r.winners_count, r.code_prefix, r.tickets_total, r.created_at,
           r.closed_at, r.closed_entries_count,
           (SELECT COUNT(*) FROM dbo.raffle_entries e WHERE e.raffle_id = r.id AND e.status = 'VALID') AS participaciones,
           (SELECT COUNT(*) FROM dbo.raffle_draws d WHERE d.raffle_id = r.id) AS sorteos
    FROM dbo.raffle_definitions r
    ORDER BY CASE r.status WHEN 'OPEN' THEN 0 WHEN 'DRAFT' THEN 1 WHEN 'CLOSED' THEN 2 ELSE 3 END, r.id DESC;

    /* El panel. Numeros que se entienden de un vistazo, no un informe. */
    SELECT
        (SELECT COUNT(*) FROM dbo.campaigns WHERE active = 1) AS campanas_activas,
        (SELECT COUNT(*) FROM dbo.reward_instances WHERE status = 'ISSUED') AS recompensas_vigentes,
        (SELECT COUNT(*) FROM dbo.coupon_instances WHERE status = 'ISSUED') AS cupones_vigentes,
        (SELECT COUNT(*) FROM dbo.raffle_entries WHERE status = 'VALID') AS participaciones,
        (SELECT COUNT(*) FROM dbo.raffle_definitions WHERE status = 'OPEN') AS rifas_abiertas,
        (SELECT COUNT(*) FROM dbo.dynamic_attempts WHERE status = 'PENDING') AS dinamicas_pendientes,
        (SELECT COUNT(*) FROM dbo.loyalty_redemptions) AS redenciones,
        (SELECT ISNULL(loyalty_enabled, 0) FROM dbo.business_config WHERE id = (SELECT MIN(id) FROM dbo.business_config)) AS habilitado;

    /* Los productos vendibles, para condicionar una campana a uno concreto. */
    SELECT TOP 300 id, nombre AS name, price
    FROM dbo.products
    WHERE active = 1 AND sellable = 1
    ORDER BY nombre;
END
GO
