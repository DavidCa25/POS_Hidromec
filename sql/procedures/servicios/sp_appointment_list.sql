/* sp_appointment_list
 * Definicion canonica. Modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* La Agenda de un rango: dia, semana o mes.
 *
 * SIEMPRE UN RANGO, NUNCA "TODO"
 * ------------------------------
 * Una agenda sin fechas es la tabla entera, y a los dos anos son decenas de
 * miles de filas para pintar una semana. El rango es obligatorio y el indice
 * esta hecho para el.
 *
 * Devuelve tambien las AUSENCIAS del rango, en su propio conjunto: la Agenda
 * tiene que pintar las vacaciones de alguien como un bloque, no como un hueco
 * libre donde se puede agendar.
 */
CREATE OR ALTER PROCEDURE dbo.sp_appointment_list
    @desde           DATETIME2(0),
    @hasta           DATETIME2(0),
    @professional_id INT = NULL,
    @estados         NVARCHAR(200) = NULL,
    @customer_id     INT = NULL
AS
BEGIN
    SET NOCOUNT ON;

    IF @desde IS NULL OR @hasta IS NULL OR @hasta <= @desde
    BEGIN
        RAISERROR('El rango de fechas es obligatorio y tiene que ir hacia adelante.', 16, 1);
        RETURN;
    END

    DECLARE @filtro TABLE (estado NVARCHAR(15) PRIMARY KEY);
    IF @estados IS NOT NULL AND LTRIM(RTRIM(@estados)) <> ''
        INSERT INTO @filtro (estado)
        SELECT DISTINCT LTRIM(RTRIM(value)) FROM STRING_SPLIT(@estados, ',')
         WHERE LTRIM(RTRIM(value)) <> '';

    SELECT a.id, a.customer_id, c.customerName AS customer_name,
           c.phone AS customer_phone, c.mobile AS customer_mobile,
           a.customer_asset_id, ca.label AS asset_label,
           a.professional_id, pr.full_name AS professional_name, pr.color AS professional_color,
           a.service_product_id, p.nombre AS service_name,
           a.starts_at, a.ends_at, a.status,
           a.service_order_id, o.folio AS order_folio,
           a.rescheduled_from_id, a.notes
      FROM dbo.appointments a
      JOIN dbo.customers c ON c.id = a.customer_id
      LEFT JOIN dbo.customer_assets ca ON ca.id = a.customer_asset_id
      LEFT JOIN dbo.professionals pr ON pr.id = a.professional_id
      LEFT JOIN dbo.products p ON p.id = a.service_product_id
      LEFT JOIN dbo.service_orders o ON o.id = a.service_order_id
     WHERE a.starts_at < @hasta
       AND a.ends_at > @desde
       AND (@professional_id IS NULL OR a.professional_id = @professional_id)
       AND (@customer_id IS NULL OR a.customer_id = @customer_id)
       AND (NOT EXISTS (SELECT 1 FROM @filtro) OR a.status IN (SELECT estado FROM @filtro))
     ORDER BY a.starts_at, a.id;

    /* Las ausencias del rango: bloques, no huecos. */
    SELECT t.id, t.professional_id, pr.full_name AS professional_name,
           t.starts_at, t.ends_at, t.reason
      FROM dbo.professional_time_off t
      JOIN dbo.professionals pr ON pr.id = t.professional_id
     WHERE t.starts_at < @hasta
       AND t.ends_at > @desde
       AND (@professional_id IS NULL OR t.professional_id = @professional_id)
     ORDER BY t.starts_at;
END
GO
