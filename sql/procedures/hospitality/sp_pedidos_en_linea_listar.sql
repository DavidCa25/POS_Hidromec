/* sp_pedidos_en_linea_listar
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* 0067 · Los pedidos en linea y el estado que ve el cliente.

   estado_cliente se DERIVA de la cuenta y sus comandas (la misma regla que el
   seguimiento por QR), nunca se guarda a mano:
     RECIBIDO     esperando a la caja
     RECHAZADO    la caja no lo tomo (motivo)
     ACEPTADO     aceptado y sin nada en preparacion
     PREPARANDO   alguna comanda NUEVA o PREPARANDO
     LISTO        sus comandas estan listas
     ENTREGADO    se cobro (lo recogio) o se entregaron las comandas
     CANCELADO    la cuenta se cancelo

   @por_publicar = 1: solo los que cambiaron desde lo ultimo que supo la nube
   (de los ultimos dos dias). @id: uno solo. Sin filtros: los de hoy y los
   pendientes de cualquier dia, para la bandeja de la caja. */
CREATE OR ALTER PROCEDURE dbo.sp_pedidos_en_linea_listar
    @por_publicar BIT = 0,
    @id INT = NULL
AS
BEGIN
    SET NOCOUNT ON;
    ;WITH base AS (
        SELECT p.*, c.numero_dia, c.estado AS cuenta_estado,
               k.pendientes, k.listas, k.entregadas
          FROM dbo.pedidos_en_linea p
          LEFT JOIN dbo.hosp_cuentas c ON c.id = p.cuenta_id
          OUTER APPLY (SELECT SUM(CASE WHEN x.estado IN ('NUEVA', 'PREPARANDO') THEN 1 ELSE 0 END) AS pendientes,
                              SUM(CASE WHEN x.estado = 'LISTA' THEN 1 ELSE 0 END) AS listas,
                              SUM(CASE WHEN x.estado = 'ENTREGADA' THEN 1 ELSE 0 END) AS entregadas
                         FROM dbo.comandas x WHERE x.cuenta_id = p.cuenta_id AND x.estado <> 'CANCELADA') k
         WHERE (@id IS NULL OR p.id = @id)
    ), derivado AS (
        SELECT b.*,
               CASE
                 WHEN b.estado = 'PENDIENTE' THEN 'RECIBIDO'
                 WHEN b.estado = 'RECHAZADO' THEN 'RECHAZADO'
                 WHEN b.cuenta_estado = 'CANCELADA' THEN 'CANCELADO'
                 WHEN ISNULL(b.pendientes, 0) > 0 THEN 'PREPARANDO'
                 WHEN b.cuenta_estado = 'COBRADA' THEN 'ENTREGADO'
                 WHEN ISNULL(b.listas, 0) > 0 THEN 'LISTO'
                 WHEN ISNULL(b.entregadas, 0) > 0 THEN 'ENTREGADO'
                 ELSE 'ACEPTADO'
               END AS estado_cliente
          FROM base b
    )
    SELECT id, uuid, origen, cliente_nombre, cliente_telefono, nota, lineas, total_cliente,
           creado_en_nube, recibido_en, estado, decidido_en, decidido_por, motivo,
           cuenta_id, numero_dia, cuenta_estado, estado_cliente, estado_publicado,
           /* La espera se mide AQUI: las horas de la base son locales y el driver
              las entrega como si fueran UTC. */
           DATEDIFF(MINUTE, recibido_en, SYSDATETIME()) AS minutos_espera
      FROM derivado
     WHERE (@id IS NOT NULL)
        OR (@por_publicar = 1 AND estado_cliente <> ISNULL(estado_publicado, '') AND recibido_en >= DATEADD(DAY, -2, SYSDATETIME()))
        OR (@por_publicar = 0 AND (estado = 'PENDIENTE' OR recibido_en >= CAST(SYSDATETIME() AS DATE)))
     ORDER BY CASE WHEN estado = 'PENDIENTE' THEN 0 ELSE 1 END, recibido_en DESC;
END
GO
