/* sp_propinas_historial
 * Definicion canonica. Mantener este archivo y generar una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* ====================== sp_propinas_historial (0079) ======================
   Las propinas de un rango de dias y como se repartieron.

   recordset 1  las propinas (con quien atendio y si ya se repartio)
   recordset 2  los repartos
   recordset 3  las lineas de esos repartos
   ======================================================================= */
CREATE OR ALTER PROCEDURE dbo.sp_propinas_historial
    @desde DATE,
    @hasta DATE,
    @register_id INT = NULL
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @fin DATETIME2(0) = DATEADD(DAY, 1, CAST(@hasta AS DATETIME2(0)));

    SELECT p.id, p.sale_id, p.monto, p.metodo, p.user_id, u.usuario, p.register_id, p.fecha, p.reparto_id
      FROM dbo.propinas p JOIN dbo.users u ON u.id = p.user_id
     WHERE p.fecha >= @desde AND p.fecha < @fin
       AND (@register_id IS NULL OR p.register_id = @register_id)
     ORDER BY p.fecha DESC;

    SELECT r.id, r.register_id, r.desde, r.hasta, r.modo, r.total, r.comision, r.neto, r.created_at, u.usuario
      FROM dbo.propinas_repartos r LEFT JOIN dbo.users u ON u.id = r.user_id
     WHERE r.created_at >= @desde AND r.created_at < @fin
       AND (@register_id IS NULL OR r.register_id = @register_id)
     ORDER BY r.created_at DESC;

    SELECT l.reparto_id, l.user_id, u.usuario, l.horas, l.monto
      FROM dbo.propinas_reparto_lineas l
      JOIN dbo.propinas_repartos r ON r.id = l.reparto_id
      JOIN dbo.users u ON u.id = l.user_id
     WHERE r.created_at >= @desde AND r.created_at < @fin
       AND (@register_id IS NULL OR r.register_id = @register_id)
     ORDER BY l.reparto_id DESC, l.monto DESC;
END
GO
