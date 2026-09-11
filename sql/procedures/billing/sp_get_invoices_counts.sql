/* sp_get_invoices_counts
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* Contadores por estado (para las pestanas/resumen). */
CREATE OR ALTER PROCEDURE [dbo].[sp_get_invoices_counts]
AS
BEGIN
    SET NOCOUNT ON;
    SELECT
        COUNT(*)                                                   AS total,
        SUM(CASE WHEN estado = 'timbrada'  THEN 1 ELSE 0 END)      AS timbradas,
        SUM(CASE WHEN estado = 'borrador'  THEN 1 ELSE 0 END)      AS borradores,
        SUM(CASE WHEN estado = 'cancelada' THEN 1 ELSE 0 END)      AS canceladas,
        SUM(CASE WHEN estado = 'error'     THEN 1 ELSE 0 END)      AS errores
    FROM dbo.invoices;
END
GO
