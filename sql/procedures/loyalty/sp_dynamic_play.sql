/* sp_dynamic_play
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* ============================================================
   sp_dynamic_play — la pantalla reporta, SQL decide.

   LA REGLA QUE NO SE NEGOCIA
   --------------------------
   El Customer Display NO decide premios. Manda lo que ocurrio -"el cliente
   pulso a los 10.014 segundos"- y AQUI se decide si eso es WIN.

   Un `if (winner) generarCupon()` en el renderer seria literalmente un boton
   para fabricar premios: la pantalla del cliente corre en una ventana que
   cualquiera con la consola abierta puede tocar. Por eso el veredicto, el
   premio y la persistencia viven en la base, y la pantalla solo sabe su
   token.

   QUE SE VALIDA ANTES DE DECIDIR
   ------------------------------
     - el token existe;
     - el intento sigue PENDIENTE (no se juega dos veces);
     - no ha caducado;
     - la dinamica sigue activa.

   TIMING: gana si |pulsacion - objetivo| <= tolerancia. El resto de tipos
   -WHEEL, PICK_ONE, SCRATCH, RANDOM_REVEAL- comparten la misma forma, asi que
   entran aqui sin tocar ninguna tabla; hoy solo TIMING tiene pantalla.

   El premio se emite EN LA MISMA transaccion que marca el intento como
   jugado: no puede quedar un intento gastado sin premio, ni un premio sin
   intento.
   ============================================================ */
CREATE OR ALTER PROCEDURE [dbo].[sp_dynamic_play]
    @token NVARCHAR(32),
    @input_value DECIMAL(12,4),
    @machine_id NVARCHAR(64) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    DECLARE @ahora DATETIME2(0) = SYSDATETIME();   /* Hora local del negocio: misma politica que sp_loyalty_evaluate_sale. */
    DECLARE @id INT, @def INT, @tipo NVARCHAR(20), @estado NVARCHAR(12),
            @expira DATETIME2(0), @objetivo DECIMAL(12,4), @tolerancia DECIMAL(12,4),
            @rewardDef INT, @campaign INT, @customer INT, @sale INT, @register INT,
            @activa BIT;

    SELECT @id = a.id, @def = a.definition_id, @estado = a.status, @expira = a.expires_at,
           @campaign = a.campaign_id, @customer = a.customer_id, @sale = a.sale_id,
           @register = a.register_id,
           @tipo = d.type, @objetivo = d.target_value, @tolerancia = d.tolerance,
           @rewardDef = d.reward_definition_id, @activa = d.active
    FROM dbo.dynamic_attempts a
    JOIN dbo.dynamic_definitions d ON d.id = a.definition_id
    WHERE a.token = @token;

    IF @id IS NULL
    BEGIN
        SELECT CAST(0 AS BIT) AS ok, N'NO_EXISTE' AS motivo,
               CAST(NULL AS NVARCHAR(8)) AS resultado, CAST(NULL AS NVARCHAR(24)) AS codigo,
               CAST(NULL AS NVARCHAR(120)) AS premio,
                   CAST(NULL AS INT) AS segmento_id, CAST(NULL AS INT) AS segmento_orden,
                   CAST(NULL AS NVARCHAR(60)) AS segmento,
               N'Esta participación ya no es válida.' AS mensaje;
        RETURN;
    END

    IF @estado <> 'PENDING'
    BEGIN
        /* Jugar dos veces con el mismo token es el intento de abuso mas obvio
           que existe, y tiene que responderse igual siempre. */
        SELECT CAST(0 AS BIT) AS ok, N'YA_JUGADO' AS motivo,
               CAST(NULL AS NVARCHAR(8)) AS resultado, CAST(NULL AS NVARCHAR(24)) AS codigo,
               CAST(NULL AS NVARCHAR(120)) AS premio,
                   CAST(NULL AS INT) AS segmento_id, CAST(NULL AS INT) AS segmento_orden,
                   CAST(NULL AS NVARCHAR(60)) AS segmento,
               N'Esta participación ya se jugó.' AS mensaje;
        RETURN;
    END

    IF @expira IS NOT NULL AND @expira < @ahora
    BEGIN
        UPDATE dbo.dynamic_attempts SET status = 'EXPIRED' WHERE id = @id;
        SELECT CAST(0 AS BIT) AS ok, N'CADUCADO' AS motivo,
               CAST(NULL AS NVARCHAR(8)) AS resultado, CAST(NULL AS NVARCHAR(24)) AS codigo,
               CAST(NULL AS NVARCHAR(120)) AS premio,
                   CAST(NULL AS INT) AS segmento_id, CAST(NULL AS INT) AS segmento_orden,
                   CAST(NULL AS NVARCHAR(60)) AS segmento,
               N'Esta participación caducó.' AS mensaje;
        RETURN;
    END

    IF @activa = 0
    BEGIN
        SELECT CAST(0 AS BIT) AS ok, N'INACTIVA' AS motivo,
               CAST(NULL AS NVARCHAR(8)) AS resultado, CAST(NULL AS NVARCHAR(24)) AS codigo,
               CAST(NULL AS NVARCHAR(120)) AS premio,
                   CAST(NULL AS INT) AS segmento_id, CAST(NULL AS INT) AS segmento_orden,
                   CAST(NULL AS NVARCHAR(60)) AS segmento,
               N'Esta dinámica ya no está activa.' AS mensaje;
        RETURN;
    END

    /* ------------------------------------------------------- EL VEREDICTO */
    DECLARE @resultado NVARCHAR(8) = 'LOSE';
    /* El sector que salio, cuando el juego tiene sectores. Se guarda con el
       intento: sin esto, una ruleta diria "gano" sin decir QUE gano, y
       reclamar el premio seria imposible de comprobar. */
    DECLARE @segmento INT = NULL, @segOrden INT = NULL, @segEtiqueta NVARCHAR(60) = NULL,
            @segOutcome NVARCHAR(16) = NULL, @segReward INT = NULL,
            @segRaffle INT = NULL, @segCantidad INT = NULL;

    IF @tipo = 'TIMING'
        /* EXACTO, a la centesima que el cliente VE.
           -----------------------------------------
           El juego es "detenlo en 10.00", no "detenlo cerca de 10". El margen
           configurable se retiro: un negocio no deberia tener que decidir una
           tolerancia, y un cliente que lee 10.00 en la pantalla y pierde no
           entenderia por que.

           La comparacion es en CENTESIMAS ENTERAS, la misma unidad con la que
           se pinta el cronometro. La pantalla manda el valor ya cuantizado a
           dos decimales -lo que muestra-, y aqui se multiplica por 100 en
           DECIMAL, que es aritmetica exacta: 9.99 -> 999, 10.00 -> 1000.

           Comparar los segundos en coma flotante seria pedir problemas: en el
           renderer 9.995 * 100 da 999.4999999999999, asi que lo mostrado y lo
           juzgado podrian discrepar. La regla es la MISMA a los dos lados
           porque a los dos lados se mira el mismo entero.

           `tolerance` queda sin uso para TIMING. No se borra la columna: hay
           dinamicas guardadas con ella y romper su definicion no aporta nada.
           Ver la nota de sp_loyalty_save_definition. */
        SET @resultado = CASE WHEN ROUND(@input_value * 100, 0) = ROUND(ISNULL(@objetivo, -1) * 100, 0)
                              THEN 'WIN' ELSE 'LOSE' END;
    ELSE IF @tipo IN ('WHEEL', 'PICK_ONE', 'RANDOM_REVEAL')
    BEGIN
        /* ---------------------------------------------------------------
           EL SERVIDOR ELIGE EL SECTOR. La rueda solo lo representa.

           Antes el sector premiado era `target_value` y la pantalla decia
           cual habia salido. Eso es pedirle al renderer que se autoproclame
           ganador: bastaba con mandar el numero bueno. Ahora `@input_value`
           se ignora por completo en estos tipos.

           El sorteo es por PESOS, con azar del servidor. Se suman los pesos
           de los sectores activos, se saca un numero en ese rango y se
           recorre acumulando: el primero que lo alcanza es el que sale. Es
           el metodo de la ruleta de toda la vida, y admite pesos desiguales
           sin que haya que recalcular porcentajes al anadir un sector.

           Un sector de peso cero se pinta pero nunca sale: es legitimo -"casi
           te toca"- y por eso no se prohibe.
           --------------------------------------------------------------- */
        DECLARE @pesoTotal INT;
        SELECT @pesoTotal = SUM(weight)
        FROM dbo.dynamic_segments WHERE definition_id = @def AND active = 1;

        IF ISNULL(@pesoTotal, 0) <= 0
        BEGIN
            /* Una ruleta sin sectores no puede repartir nada. Se dice, en vez
               de girar en vacio y dejar al cliente esperando un premio. */
            SELECT CAST(0 AS BIT) AS ok, N'SIN_SECTORES' AS motivo,
                   CAST(NULL AS NVARCHAR(8)) AS resultado, CAST(NULL AS NVARCHAR(24)) AS codigo,
                   CAST(NULL AS NVARCHAR(120)) AS premio,
                   CAST(NULL AS INT) AS segmento_id, CAST(NULL AS INT) AS segmento_orden,
                   CAST(NULL AS NVARCHAR(60)) AS segmento,
                   N'Esta ruleta todavía no tiene sectores configurados.' AS mensaje;
            RETURN;
        END

        DECLARE @tirada INT = ABS(CHECKSUM(NEWID())) % @pesoTotal;

        /* `weight > 0` NO es cosmetico.

           Un sector de peso cero suma cero al acumulado, asi que comparte
           total con el sector anterior. Con pesos 9, 1 y 0 los acumulados son
           9, 10 y 10: al sacar un 9, el TOP 1 sobre un empate puede devolver
           cualquiera de los dos, y el sector que nunca debia salir sale.

           Se midio: de 60 tiradas, el de peso cero se llevo varias. Filtrarlo
           aqui lo saca del sorteo Y deja los acumulados estrictamente
           crecientes, con lo que el empate desaparece. El orden final se fija
           igualmente, para que el resultado no dependa del plan de ejecucion. */
        SELECT TOP 1
               @segmento = s.id, @segOrden = s.sort_order, @segEtiqueta = s.label,
               @segOutcome = s.outcome, @segReward = s.reward_definition_id,
               @segRaffle = s.raffle_id, @segCantidad = s.quantity
        FROM (
            SELECT id, sort_order, label, outcome, reward_definition_id, raffle_id, quantity,
                   SUM(weight) OVER (ORDER BY sort_order, id ROWS UNBOUNDED PRECEDING) AS acumulado
            FROM dbo.dynamic_segments
            WHERE definition_id = @def AND active = 1 AND weight > 0
        ) s
        WHERE s.acumulado > @tirada
        ORDER BY s.acumulado, s.sort_order, s.id;

        /* Gana si el sector entrega algo. Un "sigue intentando" es un
           resultado legitimo de la ruleta, no un fallo. */
        SET @resultado = CASE WHEN @segOutcome IN ('REWARD', 'RAFFLE_ENTRY') THEN 'WIN' ELSE 'LOSE' END;
        IF @segOutcome = 'REWARD' SET @rewardDef = @segReward;
    END
    ELSE IF @tipo = 'SCRATCH'
        /* La probabilidad la decide el servidor, nunca la pantalla: si el
           azar viviera en el renderer, bastaria con repetirlo hasta ganar. */
        SET @resultado = CASE WHEN (ABS(CHECKSUM(NEWID())) % 10000) < (ISNULL(@objetivo, 0) * 100)
                              THEN 'WIN' ELSE 'LOSE' END;

    DECLARE @codigo NVARCHAR(24) = NULL, @premio NVARCHAR(120) = NULL, @rewardId INT = NULL;

    BEGIN TRY
        BEGIN TRAN;

        /* El intento se marca jugado con una condicion: solo si SIGUE
           pendiente. Dos pulsaciones simultaneas -doble clic, dos ventanas-
           no pueden producir dos premios. */
        UPDATE dbo.dynamic_attempts
           SET status = 'PLAYED', input_value = @input_value, result = @resultado,
               played_at = @ahora, segment_id = @segmento,
               machine_id = ISNULL(@machine_id, machine_id)
         WHERE id = @id AND status = 'PENDING';

        IF @@ROWCOUNT = 0
        BEGIN
            ROLLBACK TRAN;
            SELECT CAST(0 AS BIT) AS ok, N'YA_JUGADO' AS motivo,
                   CAST(NULL AS NVARCHAR(8)) AS resultado, CAST(NULL AS NVARCHAR(24)) AS codigo,
                   CAST(NULL AS NVARCHAR(120)) AS premio,
                   CAST(NULL AS INT) AS segmento_id, CAST(NULL AS INT) AS segmento_orden,
                   CAST(NULL AS NVARCHAR(60)) AS segmento,
                   N'Esta participación ya se jugó.' AS mensaje;
            RETURN;
        END

        IF @resultado = 'WIN' AND @rewardDef IS NOT NULL
        BEGIN
            INSERT INTO dbo.reward_instances
                (definition_id, campaign_id, customer_id, code, sale_id, register_id, machine_id,
                 status, uses_allowed, issued_at, expires_at)
            SELECT rd.id, @campaign, @customer,
                   LEFT(REPLACE(CAST(NEWID() AS NVARCHAR(36)), '-', ''), 24),
                   @sale, @register, @machine_id,
                   'ISSUED', rd.uses_allowed, @ahora,
                   CASE WHEN rd.valid_days IS NULL THEN NULL ELSE DATEADD(DAY, rd.valid_days, @ahora) END
            FROM dbo.reward_definitions rd
            WHERE rd.id = @rewardDef AND rd.active = 1;

            SET @rewardId = SCOPE_IDENTITY();
            IF @rewardId IS NOT NULL
            BEGIN
                SET @codigo = CONCAT('RW-', RIGHT(CONCAT('00000', CAST(@rewardId AS NVARCHAR(20))), 6));
                UPDATE dbo.reward_instances SET code = @codigo WHERE id = @rewardId;
                UPDATE dbo.dynamic_attempts SET reward_instance_id = @rewardId WHERE id = @id;
                SELECT @premio = name FROM dbo.reward_definitions WHERE id = @rewardDef;
            END
        END

        /* Un sector puede entregar boletos en vez de recompensa. Se numeran
           con el mismo bloqueo que usa la venta: dos ruletas girando a la vez
           en dos cajas no pueden repartir el mismo numero. */
        IF @resultado = 'WIN' AND @segOutcome = 'RAFFLE_ENTRY' AND @segRaffle IS NOT NULL
        BEGIN
            /* El mismo tope que respeta la venta: una rifa de quinientos
               boletos no reparte el quinientos uno porque salga en la
               ruleta. Al llenarse se deja de repartir; el premio que se
               anuncia despues cuenta los que de verdad entraron. */
            DECLARE @topeRifa INT = (SELECT tickets_total FROM dbo.raffle_definitions WHERE id = @segRaffle);
            DECLARE @dados INT = 0;

            DECLARE @i INT = 0;
            WHILE @i < ISNULL(@segCantidad, 1)
            BEGIN
                IF @topeRifa IS NOT NULL
                   AND (SELECT COUNT(*) FROM dbo.raffle_entries WITH (UPDLOCK, HOLDLOCK)
                         WHERE raffle_id = @segRaffle AND status = 'VALID') >= @topeRifa
                    BREAK;

                INSERT INTO dbo.raffle_entries
                    (raffle_id, entry_number, customer_id, sale_id, register_id, machine_id, campaign_id, status, created_at)
                SELECT @segRaffle,
                       ISNULL((SELECT MAX(entry_number) FROM dbo.raffle_entries WITH (UPDLOCK, HOLDLOCK)
                                WHERE raffle_id = @segRaffle), 0) + 1,
                       @customer, @sale, @register, @machine_id, @campaign, 'VALID', @ahora
                WHERE EXISTS (SELECT 1 FROM dbo.raffle_definitions WHERE id = @segRaffle AND status = 'OPEN');
                SET @dados = @dados + @@ROWCOUNT;
                SET @i = @i + 1;
            END

            /* Se anuncian los boletos que de verdad entraron, no los que
               decia el sector. Prometer cinco y dar dos porque la rifa se
               lleno es peor que decir dos. */
            IF @dados = 0
                SET @resultado = 'LOSE';
            ELSE
                SELECT @premio = CONCAT(@dados, CASE WHEN @dados = 1 THEN N' boleto de ' ELSE N' boletos de ' END, name)
                FROM dbo.raffle_definitions WHERE id = @segRaffle;
        END

        COMMIT TRAN;
    END TRY
    BEGIN CATCH
        IF XACT_STATE() <> 0 ROLLBACK TRAN;
        DECLARE @msg NVARCHAR(400) = ERROR_MESSAGE();
        RAISERROR(@msg, 16, 1);
        RETURN;
    END CATCH

    /* El sector viaja de vuelta para que la rueda ANIME HACIA EL.
       Nunca al reves: la animacion representa un resultado ya decidido y
       persistido, no lo produce. */
    SELECT CAST(1 AS BIT) AS ok, NULL AS motivo, @resultado AS resultado, @codigo AS codigo,
           @premio AS premio,
           @segmento AS segmento_id, @segOrden AS segmento_orden, @segEtiqueta AS segmento,
           CASE WHEN @resultado = 'WIN' AND @premio IS NOT NULL
                    THEN CONCAT(N'¡Ganaste! ', @premio)
                WHEN @resultado = 'WIN' THEN N'¡Ganaste!'
                WHEN @segEtiqueta IS NOT NULL THEN CONCAT(N'Salió: ', @segEtiqueta)
                ELSE N'Esta vez no fue. ¡Gracias por participar!' END AS mensaje;
END
GO
