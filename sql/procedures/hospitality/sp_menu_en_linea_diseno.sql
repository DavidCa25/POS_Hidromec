/* sp_menu_en_linea_diseno
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* 0070 · Todo lo que pinta la plantilla del menu en linea, sin los bytes
   de las fotos. Lo usan la pantalla Diseno del menu y la publicacion.

     1 imagenes      id, tipo, producto, titulo, version y tamano
     2 productos     vendibles, con lo que el menu sabe de cada uno
     3 mas_vendidos  los 8 productos mas vendidos de los ultimos 30 dias
                     (piezas), solo vendibles y no ocultos: «Lo mas pedido»
                     sale de ventas reales, no de una lista a mano. */
CREATE OR ALTER PROCEDURE dbo.sp_menu_en_linea_diseno
AS
BEGIN
    SET NOCOUNT ON;

    SELECT i.id, i.tipo, i.product_id, i.titulo, i.subtitulo, i.orden, i.version, i.ancho, i.alto, i.mime
      FROM dbo.menu_en_linea_imagenes i
     ORDER BY CASE i.tipo WHEN 'PORTADA' THEN 0 WHEN 'LOGO' THEN 1 WHEN 'PROMO' THEN 2 ELSE 3 END, i.orden, i.id;

    SELECT p.id AS product_id, p.nombre, p.price, p.category_id, c.namee AS categoria, p.image_version,
           m.descripcion, m.etiquetas, ISNULL(m.destacado, 0) AS destacado, ISNULL(m.oculto, 0) AS oculto,
           f.id AS foto_id, f.version AS foto_version
      FROM dbo.products p
      LEFT JOIN dbo.CAT_categories c ON c.id = p.category_id
      LEFT JOIN dbo.menu_en_linea_productos m ON m.product_id = p.id
      LEFT JOIN dbo.menu_en_linea_imagenes f ON f.tipo = 'PRODUCTO' AND f.product_id = p.id
     WHERE p.active = 1 AND p.sellable = 1
     ORDER BY c.namee, p.nombre;

    SELECT TOP 8 d.product_id, SUM(d.quantity) AS piezas
      FROM dbo.sale_detail d
      JOIN dbo.sales s ON s.id = d.sale_id
      JOIN dbo.products p ON p.id = d.product_id AND p.active = 1 AND p.sellable = 1
      LEFT JOIN dbo.menu_en_linea_productos m ON m.product_id = d.product_id
     WHERE s.datee >= DATEADD(DAY, -30, SYSDATETIME()) AND ISNULL(m.oculto, 0) = 0
     GROUP BY d.product_id
     ORDER BY SUM(d.quantity) DESC, d.product_id;
END
GO
