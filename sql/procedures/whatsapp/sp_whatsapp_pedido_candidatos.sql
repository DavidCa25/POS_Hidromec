/* sp_whatsapp_pedido_candidatos
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* ============== sp_whatsapp_pedido_candidatos (0068) ==============
   Los pedidos de HOY que ya están listos y cuyo cliente dejó teléfono, a los
   que todavía hay que avisar. «Listo» es la MISMA regla que el seguimiento
   del teléfono (local-host/seguimiento.js): ninguna comanda pendiente y al
   menos una LISTA.

   Solo pedidos con número del día (mostrador); una mesa no se avisa. Solo
   si quedó listo hace menos de 20 minutos: un aviso tardío confunde más que
   ayuda (la caja estuvo apagada o sin internet).

   Entra:   sin renglón (nunca se intentó), ERROR con menos de 5 intentos y
            espera creciente (30 s por intento), o ENVIANDO abandonado
            (más de 2 minutos: el proceso murió a medio envío).
   No entra: ENVIADO u OMITIDO.

   PUNTO DE EXTENSIÓN: un pedido en línea (menú QR, 0067) que viva en
   hosp_cuentas con número del día y cliente entra aquí sin cambios. Si vive
   en otra tabla, se agrega su fuente con UNION ALL devolviendo las mismas
   columnas, y su propia bandera.
   ================================================================ */
CREATE OR ALTER PROCEDURE dbo.sp_whatsapp_pedido_candidatos
    @top INT = 20
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @ahora DATETIME2(0) = SYSDATETIME();

    SELECT TOP (@top)
           c.id AS cuenta_id, c.numero_dia, cu.phone AS telefono,
           a.id AS aviso_id, a.status, a.attempts, k.lista_en
      FROM dbo.hosp_cuentas c
      JOIN dbo.customers cu ON cu.id = c.customer_id
      CROSS APPLY (SELECT SUM(CASE WHEN x.estado IN ('NUEVA', 'PREPARANDO') THEN 1 ELSE 0 END) AS pendientes,
                          SUM(CASE WHEN x.estado = 'LISTA' THEN 1 ELSE 0 END) AS listas,
                          MAX(x.lista_en) AS lista_en
                     FROM dbo.comandas x
                    WHERE x.cuenta_id = c.id AND x.estado <> 'CANCELADA') k
      LEFT JOIN dbo.whatsapp_pedido_avisos a ON a.cuenta_id = c.id
     WHERE c.abierta_dia = CAST(@ahora AS DATE)
       AND c.numero_dia IS NOT NULL
       AND c.estado <> 'CANCELADA'
       AND LEN(LTRIM(RTRIM(ISNULL(cu.phone, N'')))) >= 10
       AND k.pendientes = 0 AND k.listas > 0
       AND k.lista_en > DATEADD(MINUTE, -20, @ahora)
       AND (a.cuenta_id IS NULL
            OR (a.status = N'ERROR' AND a.attempts < 5
                AND a.last_attempt_at < DATEADD(SECOND, -30 * a.attempts, @ahora))
            OR (a.status = N'ENVIANDO' AND a.last_attempt_at < DATEADD(MINUTE, -2, @ahora)))
     ORDER BY k.lista_en;
END;
GO
