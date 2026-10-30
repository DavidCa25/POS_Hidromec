/* sp_platform_settlement_candidates
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* ================= sp_platform_settlement_candidates (0069) =================
   LA UNICA RESPUESTA a "que ventas de la caja pueden ser de esta
   liquidacion". La usan emparejar, consultar y confirmar; por eso llena la
   tabla #candidatas que crea quien la llama, en vez de devolver filas:

     CREATE TABLE #candidatas (sale_id INT PRIMARY KEY, datee DATETIME2(0),
        dia DATE, amount DECIMAL(14,2), reference NVARCHAR(100) COLLATE DATABASE_DEFAULT,
        nref NVARCHAR(100) COLLATE DATABASE_DEFAULT, channel_id NVARCHAR(64) COLLATE DATABASE_DEFAULT, channel_name NVARCHAR(120) COLLATE DATABASE_DEFAULT,
        mapped BIT, in_period BIT);

   COLLATE DATABASE_DEFAULT: una tabla # nace con la intercalacion de
   tempdb (la del servidor), que no siempre es la de la base.

   Una venta es candidata si:
     · se pago (toda o en parte) con PLATAFORMA; el importe es esa parte;
     · su canal es de ESTA plataforma (mapped = 1) o no es de ninguna
       (Mostrador o un canal sin ligar: la caja no supo de donde vino);
     · cae en el periodo, o a un dia de el (in_period = 0): un pedido de las
       23:58 puede entrar a la caja al dia siguiente;
     · no esta ya en otra liquidacion viva de cualquier plataforma.
   nref es la referencia normalizada (sin '#', espacios ni guiones, en
   mayusculas), la misma regla que se aplica al id del pedido.
   ==================================================================== */
CREATE OR ALTER PROCEDURE dbo.sp_platform_settlement_candidates
    @settlement_id INT
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @platform VARCHAR(12), @desde DATE, @hasta DATE;
    SELECT @platform = platform, @desde = period_from, @hasta = period_to
      FROM dbo.platform_settlements WHERE id = @settlement_id;
    IF @platform IS NULL RETURN;

    INSERT INTO #candidatas (sale_id, datee, dia, amount, reference, nref, channel_id, channel_name, mapped, in_period)
    SELECT s.id, s.datee, CAST(s.datee AS DATE),
           CAST(ISNULL(p.amount, s.total) AS DECIMAL(14, 2)),
           p.reference,
           NULLIF(UPPER(REPLACE(REPLACE(REPLACE(LTRIM(RTRIM(p.reference)), N'#', N''), N' ', N''), N'-', N'')), N''),
           JSON_VALUE(s.commercial_snapshot, '$.channel'),
           JSON_VALUE(s.commercial_snapshot, '$.channelName'),
           CASE WHEN pc.platform = @platform THEN 1 ELSE 0 END,
           CASE WHEN s.datee >= @desde AND s.datee < DATEADD(DAY, 1, @hasta) THEN 1 ELSE 0 END
      FROM dbo.sales s
      LEFT JOIN dbo.sale_payments p ON p.sale_id = s.id AND p.payment_method = 'PLATAFORMA'
      LEFT JOIN dbo.platform_channels pc ON pc.channel_id = JSON_VALUE(s.commercial_snapshot, '$.channel')
     WHERE s.datee >= DATEADD(DAY, -1, @desde) AND s.datee < DATEADD(DAY, 2, @hasta)
       AND (p.id IS NOT NULL
            OR (s.payment_method = 'PLATAFORMA' AND NOT EXISTS (SELECT 1 FROM dbo.sale_payments x WHERE x.sale_id = s.id)))
       AND (pc.platform IS NULL OR pc.platform = @platform)
       AND NOT EXISTS (SELECT 1 FROM dbo.platform_settlement_orders o
                         JOIN dbo.platform_settlements t ON t.id = o.settlement_id
                        WHERE o.sale_id = s.id AND t.id <> @settlement_id AND t.status <> 'CANCELADA')
       AND NOT EXISTS (SELECT 1 FROM dbo.platform_settlement_allocations a
                         JOIN dbo.platform_settlements t ON t.id = a.settlement_id
                        WHERE a.sale_id = s.id AND t.id <> @settlement_id AND t.status = 'CONFIRMADA');
END
GO
