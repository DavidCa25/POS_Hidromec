/* sp_cloud_shifts_today
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* ------------------------------------------------------------
   3) Estado de cortes / turnos del dia
   Un renglon por turno (abierto o cerrado) con esperado,
   entregado y diferencia. Es lo que dispara las alertas.
   ------------------------------------------------------------ */
CREATE OR ALTER PROCEDURE [dbo].[sp_cloud_shifts_today]
    @fecha DATE = NULL,
    @register_id INT = NULL
AS
BEGIN
    SET NOCOUNT ON;
    IF @fecha IS NULL SET @fecha = CAST(GETDATE() AS DATE);

    SELECT
        cc.id                          AS closure_id_local,
        r.name                         AS caja,
        cc.register_id                 AS register_id,
        cc.opened_at                   AS abierto_at,
        cc.closed_at                   AS cerrado_at,
        cc.opening_cash                AS fondo_inicial,
        cc.cash_expected               AS esperado,
        cc.cash_delivered              AS entregado,
        cc.difference                  AS diferencia,
        CASE WHEN cc.closed_at IS NULL THEN 1 ELSE 0 END AS abierto
    FROM dbo.cash_closures cc
    LEFT JOIN dbo.registers r ON r.id = cc.register_id
    WHERE (CAST(cc.opened_at AS DATE) = @fecha OR cc.closed_at IS NULL)
      AND (@register_id IS NULL OR cc.register_id = @register_id)
    ORDER BY cc.opened_at DESC;
END
GO
