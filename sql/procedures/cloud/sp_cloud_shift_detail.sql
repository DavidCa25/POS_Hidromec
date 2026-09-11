/* sp_cloud_shift_detail
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* ------------------------------------------------------------
   Movimientos de un corte (para el detalle en la app)
   Version limpia para la nube: tipo, referencia, monto, hora.
   ------------------------------------------------------------ */
CREATE OR ALTER PROCEDURE [dbo].[sp_cloud_shift_detail]
    @closure_id INT
AS
BEGIN
    SET NOCOUNT ON;

    SELECT
        m.id            AS movimiento_id,
        m.typee         AS tipo,
        m.reference     AS referencia,
        m.amount        AS monto,
        m.note          AS nota,
        m.datee         AS fecha
    FROM dbo.cash_movements m
    WHERE m.closure_id = @closure_id
    ORDER BY m.datee ASC, m.id ASC;
END
GO
