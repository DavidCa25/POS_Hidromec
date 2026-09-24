/* sp_appointment_get
 * Definicion canonica. Modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* Una cita, con todo lo que la pantalla necesita para pintarla y avisar.
 *
 * LOS AVISOS VIENEN CON LA CITA
 * -----------------------------
 * `fuera_de_horario` y `en_ausencia` no impiden nada: una cita un sabado por
 * la tarde, o en mitad de unas vacaciones, pasa constantemente y casi siempre
 * a proposito. Lo que no puede pasar es que nadie se entere. Se calculan al
 * leer y no se guardan, porque el horario puede cambiar despues de agendar y
 * entonces un aviso guardado seria falso.
 */
CREATE OR ALTER PROCEDURE dbo.sp_appointment_get
    @id INT
AS
BEGIN
    SET NOCOUNT ON;

    SELECT a.id, a.customer_id, c.customerName AS customer_name,
           c.phone AS customer_phone, c.mobile AS customer_mobile,
           a.customer_asset_id, ca.label AS asset_label, ca.identifier AS asset_identifier,
           a.professional_id, pr.full_name AS professional_name, pr.color AS professional_color,
           a.service_product_id, p.nombre AS service_name, s.duration_minutes,
           a.starts_at, a.ends_at, a.status,
           a.service_order_id, o.folio AS order_folio, o.status AS order_status,
           a.rescheduled_from_id, a.notes,
           a.created_at, a.created_by, u.usuario AS created_by_name, a.updated_at,

           /* Fuera del horario semanal de esa persona. */
           CONVERT(BIT, CASE
             WHEN a.professional_id IS NULL THEN 0
             WHEN NOT EXISTS (SELECT 1 FROM dbo.professional_schedules sc
                               WHERE sc.professional_id = a.professional_id AND sc.active = 1)
                  THEN 0   -- sin horario declarado no hay nada que contradecir
             WHEN EXISTS (SELECT 1 FROM dbo.professional_schedules sc
                           WHERE sc.professional_id = a.professional_id
                             AND sc.active = 1
                             AND sc.weekday = DATEPART(WEEKDAY, a.starts_at)
                             AND sc.starts_at <= CONVERT(TIME(0), a.starts_at)
                             AND sc.ends_at   >= CONVERT(TIME(0), a.ends_at))
                  THEN 0
             ELSE 1 END) AS fuera_de_horario,

           /* Dentro de una ausencia declarada. */
           CONVERT(BIT, CASE
             WHEN a.professional_id IS NULL THEN 0
             WHEN EXISTS (SELECT 1 FROM dbo.professional_time_off t
                           WHERE t.professional_id = a.professional_id
                             AND t.starts_at < a.ends_at AND a.starts_at < t.ends_at)
                  THEN 1 ELSE 0 END) AS en_ausencia,

           /* Otra cita de la misma persona a la misma hora. */
           (SELECT COUNT(*) FROM dbo.appointments b
             WHERE b.professional_id = a.professional_id
               AND b.id <> a.id
               AND b.status IN ('AGENDADA', 'CONFIRMADA')
               AND b.starts_at < a.ends_at AND a.starts_at < b.ends_at) AS citas_encimadas
      FROM dbo.appointments a
      JOIN dbo.customers c ON c.id = a.customer_id
      LEFT JOIN dbo.customer_assets ca ON ca.id = a.customer_asset_id
      LEFT JOIN dbo.professionals pr ON pr.id = a.professional_id
      LEFT JOIN dbo.services s ON s.product_id = a.service_product_id
      LEFT JOIN dbo.products p ON p.id = a.service_product_id
      LEFT JOIN dbo.service_orders o ON o.id = a.service_order_id
      LEFT JOIN dbo.users u ON u.id = a.created_by
     WHERE a.id = @id;
END
GO
