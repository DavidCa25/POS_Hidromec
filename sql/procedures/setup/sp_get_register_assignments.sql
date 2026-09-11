/* sp_get_register_assignments
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* ============================================================
   sp_get_register_assignments — el catalogo de cajas CON quien tiene cada una.

   Sustituye a `sp_get_registers` en la pantalla de Cajas. Devuelve las mismas
   columnas -para no romper a quien ya las lee- mas el estado del arriendo,
   resuelto aqui y no en la pantalla: el unico reloj valido es el del servidor,
   y una pantalla que reste fechas con la hora local dira "libre" o "ocupada"
   segun lo adelantado que ande ese equipo.

   `estado` se entrega ya masticado:
     LIBRE     nadie la tiene
     MIA       la tiene este equipo
     OCUPADA   la tiene otro equipo, ahora mismo
   ============================================================ */
CREATE OR ALTER PROCEDURE [dbo].[sp_get_register_assignments]
    @machine_id  NVARCHAR(64) = NULL,
    @only_active BIT = 0
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @now DATETIME2(0) = SYSUTCDATETIME();
    SET @machine_id = NULLIF(LTRIM(RTRIM(ISNULL(@machine_id, N''))), N'');

    SELECT
        r.id,
        r.code,
        r.name,
        r.is_active,
        r.created_at,
        CASE WHEN a.released_at IS NULL AND a.lease_until > @now THEN 1 ELSE 0 END AS tomada,
        CASE
            WHEN a.register_id IS NULL                                   THEN N'LIBRE'
            WHEN a.released_at IS NOT NULL OR a.lease_until <= @now      THEN N'LIBRE'
            WHEN @machine_id IS NOT NULL AND a.machine_id = @machine_id  THEN N'MIA'
            ELSE N'OCUPADA'
        END AS estado,
        CASE WHEN a.released_at IS NULL AND a.lease_until > @now THEN a.machine_id END       AS holder_machine_id,
        CASE WHEN a.released_at IS NULL AND a.lease_until > @now THEN a.machine_name END     AS holder_machine_name,
        CASE WHEN a.released_at IS NULL AND a.lease_until > @now THEN a.lease_until END      AS lease_until,
        CASE WHEN a.released_at IS NULL AND a.lease_until > @now
             THEN DATEDIFF(SECOND, @now, a.lease_until) END                                  AS segundos_restantes,
        a.heartbeat_at,
        /* Quien la tuvo por ultima vez, este tomada o no. Es lo que permite
           decir "la tenia CAJA-MOSTRADOR" cuando alguien pregunta por que no
           puede entrar, en vez de un hueco. */
        a.machine_name AS ultimo_equipo,
        a.released_by
    FROM dbo.registers r
    LEFT JOIN dbo.register_assignments a ON a.register_id = r.id
    WHERE (@only_active = 0 OR r.is_active = 1)
    ORDER BY r.id;
END
GO
