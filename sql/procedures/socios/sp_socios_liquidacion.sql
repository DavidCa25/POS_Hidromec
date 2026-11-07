/* sp_socios_liquidacion
 * Definicion canonica. Mantener este archivo y generar una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* ====================== sp_socios_liquidacion (0079) ======================
   Una liquidacion (@id) o la lista de todas (@id NULL, la mas nueva
   primero).
     @id:   recordset 1 = la liquidacion; recordset 2 = sus lineas.
     NULL:  una fila por liquidacion con sus totales.
   ======================================================================= */
CREATE OR ALTER PROCEDURE dbo.sp_socios_liquidacion
    @id INT = NULL
AS
BEGIN
    SET NOCOUNT ON;

    IF @id IS NULL
    BEGIN
        SELECT q.id, q.desde, q.hasta, q.created_at, u.usuario AS usuario,
               SUM(l.resultado) AS resultado, SUM(l.saldo_final) AS saldo_final
          FROM dbo.socios_liquidaciones q
          LEFT JOIN dbo.socios_liquidacion_lineas l ON l.liquidacion_id = q.id
          LEFT JOIN dbo.users u ON u.id = q.user_id
         GROUP BY q.id, q.desde, q.hasta, q.created_at, u.usuario
         ORDER BY q.hasta DESC;
        RETURN;
    END

    SELECT q.id, q.desde, q.hasta, q.created_at, u.usuario AS usuario
      FROM dbo.socios_liquidaciones q
      LEFT JOIN dbo.users u ON u.id = q.user_id
     WHERE q.id = @id;

    SELECT l.socio_id, s.nombre, l.vendido, l.costo, l.ganancia, l.gastos, l.anticipos,
           l.aportaciones, l.retiros, l.faltantes, l.resultado, l.saldo_inicial, l.saldo_final
      FROM dbo.socios_liquidacion_lineas l
      JOIN dbo.socios s ON s.id = l.socio_id
     WHERE l.liquidacion_id = @id
     ORDER BY s.orden, s.id;
END
GO
