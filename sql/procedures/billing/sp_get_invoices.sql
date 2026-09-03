/* sp_get_invoices
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* Lista facturas con filtro opcional por estado y busqueda. */
CREATE OR ALTER PROCEDURE [dbo].[sp_get_invoices]
    @estado NVARCHAR(20) = NULL,
    @busqueda NVARCHAR(100) = NULL
AS
BEGIN
    SET NOCOUNT ON;

    SELECT
        i.id,
        i.uuid,
        i.serie,
        i.folio,
        i.tipo,
        i.receptor_rfc,
        i.receptor_razon_social,
        i.total,
        i.estado,
        i.fecha_timbrado,
        i.created_at
    FROM dbo.invoices i
    WHERE (@estado IS NULL OR i.estado = @estado)
      AND (@busqueda IS NULL
           OR i.receptor_rfc LIKE '%' + @busqueda + '%'
           OR i.receptor_razon_social LIKE '%' + @busqueda + '%'
           OR i.uuid LIKE '%' + @busqueda + '%')
    ORDER BY i.created_at DESC;
END
GO
