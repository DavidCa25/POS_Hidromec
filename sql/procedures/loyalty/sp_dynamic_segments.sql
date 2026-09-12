/* sp_dynamic_segments
 * Definicion canonica. Mantener este archivo y generar una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* ============================================================
   sp_dynamic_segments — los sectores de una ruleta, en orden.

   Los usa el administrador para editarlos y el juego para dibujar la rueda.
   Se devuelve tambien el peso ya convertido a probabilidad, porque es lo que
   una persona quiere leer -"sale el 20% de las veces"- aunque lo que se
   guarde sean pesos.
   ============================================================ */
CREATE OR ALTER PROCEDURE [dbo].[sp_dynamic_segments]
    @definition_id INT
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @total INT;
    SELECT @total = SUM(weight)
    FROM dbo.dynamic_segments
    WHERE definition_id = @definition_id AND active = 1;

    SELECT s.id, s.definition_id, s.sort_order, s.label, s.outcome,
           s.reward_definition_id, rd.name AS reward_name,
           s.raffle_id, rf.name AS raffle_name,
           s.quantity, s.weight, s.active,
           /* La probabilidad real, calculada aqui: si la pantalla la dedujera
              por su cuenta, dos pantallas podrian anunciar numeros distintos
              de la misma ruleta. */
           CAST(CASE WHEN ISNULL(@total, 0) = 0 THEN 0
                     ELSE (s.weight * 100.0) / @total END AS DECIMAL(5,2)) AS probabilidad
    FROM dbo.dynamic_segments s
    LEFT JOIN dbo.reward_definitions rd ON rd.id = s.reward_definition_id
    LEFT JOIN dbo.raffle_definitions rf ON rf.id = s.raffle_id
    WHERE s.definition_id = @definition_id
    ORDER BY s.sort_order, s.id;
END
GO
