/* sp_get_customer_assets
 * Definicion canonica. Modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* Los activos de un cliente, o la busqueda por lo que los identifica.
 *
 * DOS FORMAS DE LLEGAR, PORQUE HAY DOS SITUACIONES
 * ------------------------------------------------
 * Con `@customer_id`: ya se sabe quien es y se elige cual de sus coches.
 * Con `@busqueda`: llega el coche y no llega el nombre. En un taller esto es
 * lo habitual, y obligar a encontrar antes al cliente convierte una busqueda
 * de placa en dos pantallas.
 *
 * Viene el nombre del cliente en la misma fila justamente por eso: quien busca
 * por placa necesita saber de quien es.
 */
CREATE OR ALTER PROCEDURE dbo.sp_get_customer_assets
    @customer_id  INT = NULL,
    @busqueda     NVARCHAR(60) = NULL,
    @solo_activos BIT = 1
AS
BEGIN
    SET NOCOUNT ON;

    SET @busqueda = NULLIF(LTRIM(RTRIM(@busqueda)), '');

    SELECT a.id, a.customer_id, c.customerName AS customer_name,
           a.kind, a.label, a.identifier, a.secondary_identifier,
           a.brand, a.model, a.year_or_age, a.color, a.notes, a.active,
           a.created_at, a.updated_at,
           (SELECT COUNT(*) FROM dbo.service_orders o WHERE o.customer_asset_id = a.id) AS orders_count
      FROM dbo.customer_assets a
      JOIN dbo.customers c ON c.id = a.customer_id
     WHERE (@solo_activos = 0 OR a.active = 1)
       AND (@customer_id IS NULL OR a.customer_id = @customer_id)
       AND (@busqueda IS NULL
            OR a.identifier LIKE '%' + @busqueda + '%'
            OR a.secondary_identifier LIKE '%' + @busqueda + '%'
            OR a.label LIKE '%' + @busqueda + '%')
     ORDER BY c.customerName, a.label;
END
GO
