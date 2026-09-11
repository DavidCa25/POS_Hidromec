/* sp_dynamic_pending
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* ---- ¿Hay una dinamica pendiente para esta venta?

   Lo pregunta la caja despues de cobrar, para saber si mandar la pantalla del
   cliente a jugar. Devuelve el token y los parametros que la pantalla necesita
   para PINTAR la mecanica -cuanto hay que acertar, cuanto margen hay-, nunca
   para decidir el resultado: de eso se encarga `sp_dynamic_play`.

   Que el objetivo viaje a la pantalla es deliberado y no es una fuga: en una
   dinamica de tiempo el objetivo se anuncia en voz alta ("para el contador en
   10 segundos"). Lo que no viaja jamas es la facultad de declararse ganador. */
CREATE OR ALTER PROCEDURE [dbo].[sp_dynamic_pending]
    @sale_id INT
AS
BEGIN
    SET NOCOUNT ON;

    SELECT TOP 1
        a.token,
        a.id AS attempt_id,
        d.id AS definition_id,
        d.name,
        d.type,
        d.description,
        d.target_value,
        d.tolerance,
        d.attempts_allowed,
        a.expires_at,
        rd.name AS reward_name,
        c.customerName AS cliente
    FROM dbo.dynamic_attempts a
    JOIN dbo.dynamic_definitions d ON d.id = a.definition_id AND d.active = 1
    LEFT JOIN dbo.reward_definitions rd ON rd.id = d.reward_definition_id
    LEFT JOIN dbo.customers c ON c.id = a.customer_id
    WHERE a.sale_id = @sale_id
      AND a.status = 'PENDING'
      AND (a.expires_at IS NULL OR a.expires_at > SYSDATETIME())
    ORDER BY a.id;
END
GO
