/* sp_import_rows_get
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* ---------- sp_import_rows_get (SQL_STORED_PROCEDURE) ----------
   Definicion canonica. Modificar este archivo y crear una migracion.

   «Listas» deja fuera lo ya importado. El resumen ya contaba solo
   `aplicada = 0` desde 0038, asi que el chip decia «Listas 0» y al pulsarlo
   aparecian las nueve que ya habian entrado. El numero y la lista tienen que
   ser la misma cosa; lo que ya entro se ve en «Todas».
*/
CREATE OR ALTER PROCEDURE dbo.sp_import_rows_get
    @batch_id INT,
    @filtro NVARCHAR(20) = NULL,   -- TODAS | LISTAS | PENDIENTES | CONFLICTOS
    @desde INT = 0,
    @tope INT = 200
AS
BEGIN
    SET NOCOUNT ON;
    SELECT r.*
    FROM dbo.import_rows r
    WHERE r.batch_id = @batch_id
      AND (@filtro IS NULL OR @filtro = 'TODAS'
           OR (@filtro = 'LISTAS'     AND r.accion IN ('CREATE','UPDATE') AND r.aplicada = 0)
           OR (@filtro = 'PENDIENTES' AND r.accion IN ('CONFLICT','PENDIENTE'))
           OR (@filtro = 'CONFLICTOS' AND r.accion = 'CONFLICT'))
    ORDER BY r.fila
    OFFSET @desde ROWS FETCH NEXT @tope ROWS ONLY;
END
GO
