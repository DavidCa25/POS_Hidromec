/* sp_socios_config_get
 * Definicion canonica. Mantener este archivo y generar una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* ======================= sp_socios_config_get (0079) ======================
   Todo lo que el asistente y la pantalla de Socios necesitan para pintarse.

   recordset 1  la configuracion (vacia si nunca se activo) y si esta encendido
   recordset 2  los socios
   recordset 3  las categorias, con su dueno (una fila por categoria y socio;
                sin dueno: socio_id NULL)
   recordset 4  los productos con dueno propio (distinto de su categoria)
   ======================================================================= */
CREATE OR ALTER PROCEDURE dbo.sp_socios_config_get
AS
BEGIN
    SET NOCOUNT ON;

    SELECT c.regla, c.pct_vende, c.gasto_regla, c.faltante_regla, c.sin_dueno_socio_id,
           c.liquidacion, c.dia_cierre, c.inicio, c.updated_at,
           CAST(CASE WHEN EXISTS (SELECT 1 FROM dbo.business_modules WHERE module_key = N'socios' AND enabled = 1)
                     THEN 1 ELSE 0 END AS BIT) AS activo,
           CAST(CASE WHEN EXISTS (SELECT 1 FROM dbo.socios_liquidaciones) THEN 1 ELSE 0 END AS BIT) AS hay_liquidaciones
      FROM dbo.socios_config c WHERE c.id = 1;

    SELECT s.id, s.nombre, s.user_id, u.usuario, s.pct_fijo, s.activo, s.orden
      FROM dbo.socios s LEFT JOIN dbo.users u ON u.id = s.user_id
     ORDER BY s.activo DESC, s.orden, s.id;

    SELECT k.id AS categoria_id, k.namee AS categoria, d.socio_id, d.pct,
           (SELECT COUNT(*) FROM dbo.products p WHERE p.category_id = k.id AND ISNULL(p.active, 1) = 1) AS productos
      FROM dbo.CAT_categories k
      LEFT JOIN dbo.socios_duenos d ON d.entidad = 'CATEGORIA' AND d.entidad_id = k.id
     ORDER BY k.namee, d.socio_id;

    SELECT p.id AS product_id, p.nombre, p.category_id, d.socio_id, d.pct
      FROM dbo.socios_duenos d JOIN dbo.products p ON p.id = d.entidad_id
     WHERE d.entidad = 'PRODUCTO'
     ORDER BY p.nombre, d.socio_id;
END
GO
