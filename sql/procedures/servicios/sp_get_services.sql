/* sp_get_services
 * Definicion canonica. Modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* El catalogo de servicios, con lo que cada uno tiene de producto y de
 * servicio en una sola fila.
 *
 * Devuelve tambien cuantas personas lo hacen: la pantalla necesita distinguir
 * "lo hace cualquiera" -sin filas en `service_professionals`- de "lo hacen
 * estas tres", y sin el conteo tendria que pedir la matriz entera para
 * pintar una lista.
 */
CREATE OR ALTER PROCEDURE dbo.sp_get_services
    @solo_activos BIT = 1,
    @busqueda     NVARCHAR(100) = NULL
AS
BEGIN
    SET NOCOUNT ON;

    SELECT p.id AS product_id,
           p.part_number,
           p.nombre,
           p.price,
           p.tasa_iva,
           p.clave_prod_serv,
           p.clave_unidad,
           p.category_id,
           c.namee AS category_name,
           p.active,
           s.duration_minutes,
           s.requires_professional,
           s.default_commission_pct,
           s.schedulable,
           s.notes,
           (SELECT COUNT(*) FROM dbo.service_professionals sp
             WHERE sp.service_product_id = p.id) AS professionals_count
      FROM dbo.services s
      JOIN dbo.products p ON p.id = s.product_id
      LEFT JOIN dbo.CAT_categories c ON c.id = p.category_id
     WHERE (@solo_activos = 0 OR p.active = 1)
       AND (@busqueda IS NULL
            OR p.nombre LIKE '%' + @busqueda + '%'
            OR p.part_number LIKE '%' + @busqueda + '%')
     ORDER BY p.nombre;
END
GO
