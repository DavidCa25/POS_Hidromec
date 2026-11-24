/* sp_salud_libro_control
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* Entradas y salidas de controlados (fracciones I a III) o de antibióticos,
 * con su lote, la receta que respaldó cada salida y el saldo corrido.
 *
 * Es el AUXILIAR para llenar el libro autorizado: no está confirmado que
 * COFEPRIS acepte el libro electrónico (docs/giro-salud.md §3.1).
 *
 * El saldo se calcula sobre TODA la historia del producto y después se
 * filtra el periodo: así la primera fila del periodo arranca con el saldo
 * que de verdad traía.
 */
CREATE OR ALTER PROCEDURE [dbo].[sp_salud_libro_control]
    @desde DATE,
    @hasta DATE,
    @tipo  NVARCHAR(12) = N'CONTROLADOS'
AS
BEGIN
    SET NOCOUNT ON;
    IF @desde IS NULL OR @hasta IS NULL OR @hasta < @desde
    BEGIN RAISERROR('Periodo inválido.', 16, 1); RETURN; END
    SET @tipo = UPPER(ISNULL(@tipo, N'CONTROLADOS'));

    ;WITH movs AS (
        SELECT m.id, m.at, m.product_id, m.lote_id, m.tipo, m.cantidad, m.sale_id, m.receta_id, m.nota, m.user_id,
               SUM(CASE WHEN m.tipo IN (N'ENTRADA', N'AJUSTE') THEN m.cantidad ELSE -m.cantidad END)
                   OVER (PARTITION BY m.product_id ORDER BY m.at, m.id ROWS UNBOUNDED PRECEDING) AS saldo
          FROM dbo.salud_lote_movimientos m
          JOIN dbo.salud_productos s ON s.product_id = m.product_id
         WHERE (@tipo = N'CONTROLADOS' AND s.es_controlado = 1)
            OR (@tipo = N'ANTIBIOTICOS' AND s.es_antibiotico = 1)
    )
    SELECT v.id AS movimiento_id, v.at, v.product_id, p.nombre, sp.sustancia_activa, sp.fraccion,
           l.lote, l.caducidad, v.tipo,
           CASE WHEN v.tipo IN (N'ENTRADA', N'AJUSTE') THEN v.cantidad ELSE 0 END AS entrada,
           CASE WHEN v.tipo IN (N'SALIDA', N'MERMA') THEN v.cantidad ELSE 0 END AS salida,
           v.saldo, v.sale_id, r.medico, r.cedula, r.fecha_receta, r.retenida, v.nota,
           u.usuario
      FROM movs v
      JOIN dbo.products p ON p.id = v.product_id
      JOIN dbo.salud_productos sp ON sp.product_id = v.product_id
      LEFT JOIN dbo.salud_lotes l ON l.id = v.lote_id
      LEFT JOIN dbo.salud_recetas_surtidas r ON r.id = v.receta_id
      LEFT JOIN dbo.users u ON u.id = v.user_id
     WHERE v.at >= @desde AND v.at < DATEADD(DAY, 1, @hasta)
     ORDER BY p.nombre, v.at, v.id;
END
GO
