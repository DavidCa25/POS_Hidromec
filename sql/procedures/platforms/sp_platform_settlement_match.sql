/* sp_platform_settlement_match
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* =================== sp_platform_settlement_match (0069) ===================
   Empareja los pedidos que reporto la plataforma con las ventas de la caja.
   Solo en BORRADOR. Lo emparejado a mano (MANUAL) se respeta; lo demas se
   rehace desde cero cada vez, asi que llamarlo dos veces da lo mismo.

     1  REFERENCIA  el numero de pedido capturado en la caja es el id del
                    pedido o su principio (la tablet de la plataforma ensena
                    los primeros caracteres). Solo si es inequivoco en los dos
                    sentidos.
     2  IMPORTE     mismo dia y mismo importe. Pedidos y ventas iguales del
                    mismo dia se emparejan en orden: da igual cual con cual.
     3  IMPORTE     a un dia de distancia y mismo importe, solo si la pareja
                    es unica en los dos sentidos.
   Los pedidos cancelados por la plataforma no se emparejan.
   ==================================================================== */
CREATE OR ALTER PROCEDURE dbo.sp_platform_settlement_match
    @settlement_id INT
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;
    IF NOT EXISTS (SELECT 1 FROM dbo.platform_settlements WHERE id = @settlement_id AND status = 'BORRADOR')
        THROW 51000, 'Solo se empareja una liquidacion en borrador.', 1;

    CREATE TABLE #candidatas (sale_id INT PRIMARY KEY, datee DATETIME2(0), dia DATE, amount DECIMAL(14, 2),
        reference NVARCHAR(100) COLLATE DATABASE_DEFAULT, nref NVARCHAR(100) COLLATE DATABASE_DEFAULT, channel_id NVARCHAR(64) COLLATE DATABASE_DEFAULT, channel_name NVARCHAR(120) COLLATE DATABASE_DEFAULT,
        mapped BIT, in_period BIT);
    EXEC dbo.sp_platform_settlement_candidates @settlement_id = @settlement_id;

    BEGIN TRAN;
    UPDATE dbo.platform_settlement_orders SET sale_id = NULL, match_kind = NULL
     WHERE settlement_id = @settlement_id AND match_kind <> 'MANUAL';
    /* Un MANUAL que ya no es candidata (otra liquidacion la tomo) se suelta. */
    UPDATE o SET sale_id = NULL, match_kind = NULL
      FROM dbo.platform_settlement_orders o
     WHERE o.settlement_id = @settlement_id AND o.match_kind = 'MANUAL'
       AND NOT EXISTS (SELECT 1 FROM #candidatas c WHERE c.sale_id = o.sale_id);
    DELETE c FROM #candidatas c
     WHERE EXISTS (SELECT 1 FROM dbo.platform_settlement_orders o WHERE o.settlement_id = @settlement_id AND o.sale_id = c.sale_id);

    /* ------------------------------------------------ 1 por referencia */
    ;WITH o AS (
        SELECT id, NULLIF(UPPER(REPLACE(REPLACE(REPLACE(LTRIM(RTRIM(platform_order_id)), N'#', N''), N' ', N''), N'-', N'')), N'') AS nid
          FROM dbo.platform_settlement_orders
         WHERE settlement_id = @settlement_id AND sale_id IS NULL AND cancelled = 0),
    par AS (
        SELECT o.id AS order_line, c.sale_id
          FROM o JOIN #candidatas c ON c.nref IS NOT NULL AND o.nid IS NOT NULL
           AND (c.nref = o.nid
                OR (LEN(c.nref) >= 4 AND LEFT(o.nid, LEN(c.nref)) = c.nref)
                OR (LEN(o.nid) >= 4 AND LEFT(c.nref, LEN(o.nid)) = o.nid))),
    unico AS (
        SELECT p.order_line, p.sale_id FROM par p
         WHERE (SELECT COUNT(*) FROM par x WHERE x.order_line = p.order_line) = 1
           AND (SELECT COUNT(*) FROM par x WHERE x.sale_id = p.sale_id) = 1)
    UPDATE t SET sale_id = u.sale_id, match_kind = 'REFERENCIA'
      FROM dbo.platform_settlement_orders t JOIN unico u ON u.order_line = t.id;
    DELETE c FROM #candidatas c
     WHERE EXISTS (SELECT 1 FROM dbo.platform_settlement_orders o WHERE o.settlement_id = @settlement_id AND o.sale_id = c.sale_id);

    /* ------------------------------------- 2 mismo dia, mismo importe */
    ;WITH o AS (
        SELECT id, CAST(order_at AS DATE) AS dia, sales_total,
               ROW_NUMBER() OVER (PARTITION BY CAST(order_at AS DATE), sales_total ORDER BY order_at, line_no) AS n
          FROM dbo.platform_settlement_orders
         WHERE settlement_id = @settlement_id AND sale_id IS NULL AND cancelled = 0 AND order_at IS NOT NULL),
    c AS (
        SELECT sale_id, dia, amount, ROW_NUMBER() OVER (PARTITION BY dia, amount ORDER BY datee, sale_id) AS n
          FROM #candidatas)
    UPDATE t SET sale_id = c.sale_id, match_kind = 'IMPORTE'
      FROM dbo.platform_settlement_orders t
      JOIN o ON o.id = t.id
      JOIN c ON c.dia = o.dia AND c.amount = o.sales_total AND c.n = o.n;
    DELETE c FROM #candidatas c
     WHERE EXISTS (SELECT 1 FROM dbo.platform_settlement_orders o WHERE o.settlement_id = @settlement_id AND o.sale_id = c.sale_id);

    /* --------------------------------- 3 un dia de distancia, unico */
    ;WITH par AS (
        SELECT t.id AS order_line, c.sale_id
          FROM dbo.platform_settlement_orders t
          JOIN #candidatas c ON c.amount = t.sales_total AND ABS(DATEDIFF(DAY, CAST(t.order_at AS DATE), c.dia)) = 1
         WHERE t.settlement_id = @settlement_id AND t.sale_id IS NULL AND t.cancelled = 0 AND t.order_at IS NOT NULL),
    unico AS (
        SELECT p.order_line, p.sale_id FROM par p
         WHERE (SELECT COUNT(*) FROM par x WHERE x.order_line = p.order_line) = 1
           AND (SELECT COUNT(*) FROM par x WHERE x.sale_id = p.sale_id) = 1)
    UPDATE t SET sale_id = u.sale_id, match_kind = 'IMPORTE'
      FROM dbo.platform_settlement_orders t JOIN unico u ON u.order_line = t.id;

    UPDATE dbo.platform_settlements SET updated_at = SYSDATETIME() WHERE id = @settlement_id;
    COMMIT TRAN;
END
GO
