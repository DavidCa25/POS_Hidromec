/* sp_service_order_list
 * Definicion canonica. Modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* El tablero de ordenes: lo que hay y como va.
 *
 * `@estados` es una lista separada por comas -'ABIERTA,EN_PROCESO'- y no un
 * solo valor, porque la pregunta real del mostrador es "que tengo dentro", y
 * eso son varios estados a la vez. Un parametro por estado habria sido cinco
 * parametros booleanos que nadie recuerda en que orden van.
 *
 * Trae los totales y el estado economico calculados por fila. Pedirselos
 * despues, uno a uno, convertiria una lista de treinta ordenes en treinta
 * consultas.
 */
CREATE OR ALTER PROCEDURE dbo.sp_service_order_list
    @estados         NVARCHAR(200) = NULL,
    @customer_id     INT = NULL,
    @professional_id INT = NULL,
    @desde           DATE = NULL,
    @hasta           DATE = NULL,
    @busqueda        NVARCHAR(100) = NULL,
    @top             INT = 200
AS
BEGIN
    SET NOCOUNT ON;

    SET @busqueda = NULLIF(LTRIM(RTRIM(@busqueda)), '');
    SET @top = CASE WHEN @top IS NULL OR @top <= 0 THEN 200 ELSE @top END;

    DECLARE @filtro TABLE (estado NVARCHAR(20) PRIMARY KEY);
    IF @estados IS NOT NULL AND LTRIM(RTRIM(@estados)) <> ''
        INSERT INTO @filtro (estado)
        SELECT DISTINCT LTRIM(RTRIM(value)) FROM STRING_SPLIT(@estados, ',')
         WHERE LTRIM(RTRIM(value)) <> '';

    SELECT TOP (@top)
           o.id, o.folio, o.status,
           o.customer_id, c.customerName AS customer_name,
           o.customer_asset_id, a.label AS asset_label, a.identifier AS asset_identifier,
           o.opened_at, o.promised_at, o.closed_at,
           o.quote_version, o.authorized_version,
           CONVERT(BIT, CASE WHEN o.authorized_version IS NULL
                              OR o.quote_version > o.authorized_version
                             THEN 1 ELSE 0 END) AS needs_reauthorization,
           o.sale_id,
           ISNULL(t.total, 0) AS total,
           CASE WHEN o.sale_id IS NULL THEN 'SIN_COBRAR'
                WHEN ISNULL(s.balance, 0) > 0 THEN 'POR_COBRAR'
                ELSE 'PAGADA' END AS economic_status,
           ISNULL(t.lineas, 0) AS lines_count,
           ISNULL(t.hechas, 0) AS lines_done,
           /* En hexadecimal: los ocho bytes crudos no cruzan intactos el puente
              de contextos de Electron. Ver `sp_service_order_get`. */
           CONVERT(VARCHAR(18), CONVERT(BINARY(8), o.rowver), 1) AS rowver
      FROM dbo.service_orders o
      JOIN dbo.customers c ON c.id = o.customer_id
      LEFT JOIN dbo.customer_assets a ON a.id = o.customer_asset_id
      LEFT JOIN dbo.sales s ON s.id = o.sale_id
      OUTER APPLY (
            SELECT SUM(l.line_total) AS total,
                   COUNT(*) AS lineas,
                   SUM(CASE WHEN l.status = 'HECHA' THEN 1 ELSE 0 END) AS hechas
              FROM dbo.service_order_lines l
             WHERE l.order_id = o.id AND l.status <> 'CANCELADA') t
     WHERE (NOT EXISTS (SELECT 1 FROM @filtro) OR o.status IN (SELECT estado FROM @filtro))
       AND (@customer_id IS NULL OR o.customer_id = @customer_id)
       AND (@desde IS NULL OR o.opened_at >= @desde)
       AND (@hasta IS NULL OR o.opened_at < DATEADD(DAY, 1, @hasta))
       AND (@professional_id IS NULL
            OR EXISTS (SELECT 1 FROM dbo.service_order_lines l
                        WHERE l.order_id = o.id AND l.professional_id = @professional_id))
       AND (@busqueda IS NULL
            OR o.folio LIKE '%' + @busqueda + '%'
            OR c.customerName LIKE '%' + @busqueda + '%'
            OR a.label LIKE '%' + @busqueda + '%'
            OR a.identifier LIKE '%' + @busqueda + '%')
     ORDER BY o.opened_at DESC, o.id DESC;
END
GO
