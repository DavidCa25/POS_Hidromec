/* sp_salon_get
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* ======================================================================
   PROCEDIMIENTOS
   ====================================================================== */

/* El total de una cuenta: lineas activas, precio base mas sus opciones. */
CREATE OR ALTER PROCEDURE dbo.sp_salon_get
AS
BEGIN
    SET NOCOUNT ON;

    SELECT id, nombre, orden
      FROM dbo.salon_areas
     WHERE activa = 1
     ORDER BY orden, nombre;

    /* El estado visible son tres palabras: LIBRE, ABIERTA, POR_COBRAR. Lo
       demas -comandas en preparacion, listas por entregar- es contexto que
       ayuda al mesero, no un estado mas de la mesa. */
    SELECT m.id, m.area_id, m.nombre, m.capacidad, m.orden,
           c.id AS cuenta_id,
           CASE WHEN c.id IS NULL THEN 'LIBRE' ELSE c.estado END AS estado,
           c.abierta_en,
           DATEDIFF(MINUTE, c.abierta_en, SYSDATETIME()) AS minutos,
           ISNULL(t.total, 0) AS total,
           ISNULL(t.lineas, 0) AS lineas,
           ISNULL(k.pendientes, 0) AS comandas_pendientes,
           ISNULL(k.listas, 0) AS comandas_listas
      FROM dbo.salon_mesas m
      LEFT JOIN dbo.hosp_cuentas c
             ON c.mesa_id = m.id AND c.estado IN ('ABIERTA', 'POR_COBRAR')
      OUTER APPLY (
            SELECT SUM(l.cantidad * (l.precio_unitario + ISNULL(o.delta, 0))) AS total,
                   COUNT(*) AS lineas
              FROM dbo.hosp_orden_lineas l
              OUTER APPLY (SELECT SUM(x.price_delta * x.quantity) AS delta
                             FROM dbo.hosp_orden_linea_opciones x WHERE x.linea_id = l.id) o
             WHERE l.cuenta_id = c.id AND l.estado = 'ACTIVA') t
      OUTER APPLY (
            SELECT SUM(CASE WHEN x.estado IN ('NUEVA', 'PREPARANDO') THEN 1 ELSE 0 END) AS pendientes,
                   SUM(CASE WHEN x.estado = 'LISTA' THEN 1 ELSE 0 END) AS listas
              FROM dbo.comandas x WHERE x.cuenta_id = c.id) k
     WHERE m.activa = 1
     ORDER BY m.orden, m.nombre;
END
GO
