/* sp_salud_farmacia_resumen
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* Los números de la portada de Farmacia, en una sola consulta.
 */
CREATE OR ALTER PROCEDURE [dbo].[sp_salud_farmacia_resumen]
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @hoy DATE = CAST(GETDATE() AS DATE);
    SELECT
      (SELECT COUNT(*) FROM dbo.salud_lotes WHERE cantidad > 0 AND caducidad <= @hoy) AS lotes_caducados,
      (SELECT COUNT(*) FROM dbo.salud_lotes WHERE cantidad > 0 AND caducidad > @hoy AND caducidad <= DATEADD(DAY, 90, @hoy)) AS lotes_por_caducar,
      (SELECT COUNT(*) FROM dbo.salud_productos WHERE requiere_receta = 1) AS con_receta,
      (SELECT COUNT(*) FROM dbo.salud_recetas_surtidas WHERE at >= @hoy) AS recetas_hoy,
      (SELECT COUNT(*) FROM dbo.salud_temperaturas WHERE at >= @hoy) AS lecturas_hoy,
      (SELECT COUNT(*) FROM dbo.salud_productos s JOIN dbo.products p ON p.id = s.product_id
        WHERE s.precio_maximo IS NOT NULL AND p.price > s.precio_maximo AND p.active = 1) AS sobre_maximo;
END
GO
