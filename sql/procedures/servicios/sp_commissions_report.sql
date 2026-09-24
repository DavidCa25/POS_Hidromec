/* sp_commissions_report
 * Definicion canonica. Modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* Cuanto genero cada persona en un periodo.
 *
 * ESTO NO ES NOMINA
 * -----------------
 * No hay pagos, ni periodos cerrados, ni descuentos, ni liquidaciones. Eso
 * quedo explicitamente fuera del alcance y meterlo a medias seria peor que no
 * tenerlo: una pantalla que dice "pagado" sin que nadie haya pagado nada es
 * una fuente de discusiones, no una herramienta.
 *
 * Lo que hay es el dato del que sale cualquier liquidacion: que trabajos se
 * cobraron, de quien eran y cuanto sumaban.
 *
 * SOLO CUENTA LO COBRADO
 * ----------------------
 * Una comision se devenga al cobrar la orden, no al terminarla. Un trabajo
 * hecho y sin cobrar no ha generado nada todavia, y ensenarlo como generado
 * seria prometer dinero que aun no entro.
 *
 * DOS CONJUNTOS: EL TOTAL POR PERSONA Y EL DETALLE
 * ------------------------------------------------
 * El primero es lo que se mira; el segundo es lo que se revisa cuando alguien
 * no esta de acuerdo con el primero.
 */
CREATE OR ALTER PROCEDURE dbo.sp_commissions_report
    @desde           DATE,
    @hasta           DATE,
    @professional_id INT = NULL
AS
BEGIN
    SET NOCOUNT ON;

    IF @desde IS NULL OR @hasta IS NULL
    BEGIN
        RAISERROR('Hacen falta las dos fechas.', 16, 1);
        RETURN;
    END

    DECLARE @fin DATETIME2(0) = DATEADD(DAY, 1, CONVERT(DATETIME2(0), @hasta));
    DECLARE @ini DATETIME2(0) = CONVERT(DATETIME2(0), @desde);

    SELECT pr.id AS professional_id,
           pr.full_name AS professional_name,
           pr.title,
           COUNT(*) AS lineas,
           COUNT(DISTINCT c.order_id) AS ordenes,
           SUM(c.base_amount) AS base,
           SUM(c.amount) AS comision
      FROM dbo.service_commissions c
      JOIN dbo.professionals pr ON pr.id = c.professional_id
     WHERE c.earned_at >= @ini AND c.earned_at < @fin
       AND (@professional_id IS NULL OR c.professional_id = @professional_id)
     GROUP BY pr.id, pr.full_name, pr.title
     ORDER BY SUM(c.amount) DESC;

    SELECT c.id, c.earned_at,
           c.professional_id, pr.full_name AS professional_name,
           c.order_id, o.folio AS order_folio,
           c.sale_id,
           l.name_snapshot AS concepto,
           l.quantity,
           c.base_amount, c.pct, c.amount,
           cu.customerName AS customer_name
      FROM dbo.service_commissions c
      JOIN dbo.professionals pr ON pr.id = c.professional_id
      JOIN dbo.service_orders o ON o.id = c.order_id
      JOIN dbo.service_order_lines l ON l.id = c.order_line_id
      JOIN dbo.customers cu ON cu.id = o.customer_id
     WHERE c.earned_at >= @ini AND c.earned_at < @fin
       AND (@professional_id IS NULL OR c.professional_id = @professional_id)
     ORDER BY c.earned_at DESC, c.id DESC;
END
GO
