/* sp_salud_lotes_list
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* Lotes con existencia. Con @dias: solo los que caducan dentro de ese plazo
 * (incluidos los ya caducados), ordenados por el que vence primero.
 */
CREATE OR ALTER PROCEDURE [dbo].[sp_salud_lotes_list]
    @product_id INT = NULL,
    @dias       INT = NULL,
    @top        INT = 300
AS
BEGIN
    SET NOCOUNT ON;
    IF @top IS NULL OR @top NOT BETWEEN 1 AND 2000 SET @top = 300;
    DECLARE @hoy DATE = CAST(GETDATE() AS DATE);

    SELECT TOP (@top)
           l.id AS lote_id, l.product_id, p.nombre, p.part_number, l.lote, l.caducidad,
           l.cantidad, l.costo, DATEDIFF(DAY, @hoy, l.caducidad) AS dias_restantes,
           CAST(CASE WHEN l.caducidad <= @hoy THEN 1 ELSE 0 END AS BIT) AS caducado
      FROM dbo.salud_lotes l
      JOIN dbo.products p ON p.id = l.product_id
     WHERE l.cantidad > 0
       AND (@product_id IS NULL OR l.product_id = @product_id)
       AND (@dias IS NULL OR l.caducidad <= DATEADD(DAY, @dias, @hoy))
     ORDER BY l.caducidad, p.nombre, l.id;
END
GO
