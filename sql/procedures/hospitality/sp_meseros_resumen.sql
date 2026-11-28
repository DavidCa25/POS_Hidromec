/* sp_meseros_resumen
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* 0097 · LOS MESEROS DEL TURNO, PARA LA CAJA.

   Cada mesero que cobró algo en los turnos abiertos: mesas, cobrado,
   propinas, efectivo en su bolsa, lo entregado, lo que le falta entregar y
   la diferencia de sus entregas. Lo usa la pantalla de entregas y el corte
   (para avisar quién no ha entregado antes de cerrar). */
CREATE OR ALTER PROCEDURE dbo.sp_meseros_resumen
AS
BEGIN
    SET NOCOUNT ON;

    ;WITH c AS (
        SELECT c.mesero_id, COUNT(*) AS mesas, SUM(c.total) AS cobrado, SUM(c.propina) AS propinas, SUM(c.efectivo) AS en_bolsa
          FROM dbo.mesero_cobros c JOIN dbo.cash_closures z ON z.id = c.closure_id
         WHERE z.closed_at IS NULL
         GROUP BY c.mesero_id),
    e AS (
        SELECT e.mesero_id, SUM(e.esperado) AS esperado, SUM(e.entregado) AS entregado, SUM(e.diferencia) AS diferencia
          FROM dbo.mesero_entregas e JOIN dbo.cash_closures z ON z.id = e.closure_id
         WHERE z.closed_at IS NULL
         GROUP BY e.mesero_id)
    SELECT c.mesero_id, u.usuario, c.mesas,
           CAST(c.cobrado AS DECIMAL(12, 2)) AS cobrado,
           CAST(c.propinas AS DECIMAL(12, 2)) AS propinas,
           CAST(c.en_bolsa AS DECIMAL(12, 2)) AS en_bolsa,
           CAST(ISNULL(e.entregado, 0) AS DECIMAL(12, 2)) AS entregado,
           CAST(c.en_bolsa - ISNULL(e.esperado, 0) AS DECIMAL(12, 2)) AS por_entregar,
           CAST(ISNULL(e.diferencia, 0) AS DECIMAL(12, 2)) AS diferencia
      FROM c
      JOIN dbo.users u ON u.id = c.mesero_id
      LEFT JOIN e ON e.mesero_id = c.mesero_id
     ORDER BY CASE WHEN c.en_bolsa - ISNULL(e.esperado, 0) > 0 THEN 0 ELSE 1 END, u.usuario;
END;
GO
