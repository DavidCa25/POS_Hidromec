/* sp_salud_planes_get
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* Los planes de tratamiento de un paciente con su total y avance, y sus
 * procedimientos. Dos conjuntos.
 */
CREATE OR ALTER PROCEDURE [dbo].[sp_salud_planes_get]
    @customer_id INT
AS
BEGIN
    SET NOCOUNT ON;

    SELECT pl.id, pl.titulo, pl.estado, pl.orden_id, pl.created_at, pl.aceptado_at,
           ISNULL(SUM(i.precio), 0) AS total,
           COUNT(i.id) AS procedimientos,
           SUM(CASE WHEN i.estado = N'HECHO' THEN 1 ELSE 0 END) AS hechos
      FROM dbo.salud_planes pl
      LEFT JOIN dbo.salud_plan_items i ON i.plan_id = pl.id
     WHERE pl.paciente_id = @customer_id
     GROUP BY pl.id, pl.titulo, pl.estado, pl.orden_id, pl.created_at, pl.aceptado_at
     ORDER BY pl.created_at DESC, pl.id DESC;

    SELECT i.id, i.plan_id, i.fase, i.diente, i.procedimiento, i.product_id, i.precio, i.estado, i.hecho_at
      FROM dbo.salud_plan_items i
      JOIN dbo.salud_planes pl ON pl.id = i.plan_id
     WHERE pl.paciente_id = @customer_id
     ORDER BY i.plan_id, i.fase, i.id;
END
GO
