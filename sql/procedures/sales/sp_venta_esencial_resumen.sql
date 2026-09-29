/* sp_venta_esencial_resumen
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* ============================================================
   sp_venta_esencial_resumen — las ventas hechas en Modo Venta Esencial

   Al renovar la suscripcion, Wybix avisa que el inventario no se actualizo
   durante ese periodo. Esto dice cuantas ventas fueron y entre que fechas:
   la venta misma es la evidencia (sales.venta_esencial), no hay un segundo
   registro de movimientos.
   ============================================================ */
CREATE OR ALTER PROCEDURE [dbo].[sp_venta_esencial_resumen]
AS
BEGIN
    SET NOCOUNT ON;
    SELECT COUNT(*) AS ventas, MIN(datee) AS desde, MAX(datee) AS hasta
      FROM dbo.sales
     WHERE venta_esencial = 1;
END;
GO
