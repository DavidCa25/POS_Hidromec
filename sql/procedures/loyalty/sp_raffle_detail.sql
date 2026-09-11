/* sp_raffle_detail
 * Definicion canonica. Mantener este archivo y generar una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* ---- Una rifa con sus participaciones, sus sorteos y sus ganadores.

   Tres resultsets:
     1 la rifa y sus conteos
     2 participaciones (las ultimas primero, con su caja de origen)
     3 ganadores de todos los sorteos, con la evidencia de cada uno

   Las participaciones se limitan: una rifa de un mes puede tener miles y la
   pantalla no necesita pintarlas todas para responder "¿cuantas llevo y de
   que cajas salieron?". */
CREATE OR ALTER PROCEDURE [dbo].[sp_raffle_detail]
    @raffle_id INT,
    @top_entries INT = 200
AS
BEGIN
    SET NOCOUNT ON;
    IF ISNULL(@top_entries, 0) < 1 SET @top_entries = 200;

    SELECT r.id, r.name, r.description, r.prize, r.starts_at, r.ends_at,
           r.status, r.winners_count, r.code_prefix, r.created_at,
           (SELECT COUNT(*) FROM dbo.raffle_entries e WHERE e.raffle_id = r.id AND e.status = 'VALID') AS participaciones,
           (SELECT COUNT(DISTINCT e.customer_id) FROM dbo.raffle_entries e WHERE e.raffle_id = r.id AND e.customer_id IS NOT NULL) AS clientes,
           (SELECT COUNT(DISTINCT e.register_id) FROM dbo.raffle_entries e WHERE e.raffle_id = r.id) AS cajas
    FROM dbo.raffle_definitions r
    WHERE r.id = @raffle_id;

    SELECT TOP (@top_entries)
           e.id, e.entry_number,
           CONCAT(rf.code_prefix, '-', RIGHT(CONCAT('0000000', CAST(e.entry_number AS NVARCHAR(20))), 8)) AS boleto,
           e.customer_id, c.customerName AS cliente,
           e.sale_id, e.register_id, rg.name AS caja, e.machine_id,
           e.campaign_id, cp.name AS campana,
           e.status, e.created_at
    FROM dbo.raffle_entries e
    JOIN dbo.raffle_definitions rf ON rf.id = e.raffle_id
    LEFT JOIN dbo.customers c ON c.id = e.customer_id
    LEFT JOIN dbo.registers rg ON rg.id = e.register_id
    LEFT JOIN dbo.campaigns cp ON cp.id = e.campaign_id
    WHERE e.raffle_id = @raffle_id
    ORDER BY e.entry_number DESC;

    SELECT w.id AS winner_id, w.draw_id, w.position, w.status, w.delivered_at, w.notes,
           e.entry_number,
           CONCAT(rf.code_prefix, '-', RIGHT(CONCAT('0000000', CAST(e.entry_number AS NVARCHAR(20))), 8)) AS boleto,
           e.customer_id, c.customerName AS cliente, e.sale_id,
           d.drawn_at, d.entries_count, d.max_entry_id, d.algorithm, d.algorithm_version, d.seed,
           u.usuario AS sorteado_por
    FROM dbo.raffle_winners w
    JOIN dbo.raffle_draws d ON d.id = w.draw_id
    JOIN dbo.raffle_entries e ON e.id = w.entry_id
    JOIN dbo.raffle_definitions rf ON rf.id = d.raffle_id
    LEFT JOIN dbo.customers c ON c.id = e.customer_id
    LEFT JOIN dbo.users u ON u.id = d.drawn_by_user_id
    WHERE d.raffle_id = @raffle_id
    ORDER BY d.id DESC, w.position;
END
GO
