/* ============================================================
   0025 — cupones a mano y boletos contados

   Generada con scripts/db/generar-migracion.mjs desde los archivos
   canonicos de sql/. No editar a mano: regenerar.

   Idempotente: todos los objetos usan CREATE OR ALTER, y los tipos
   comprueban su existencia antes de crearse. Se puede reejecutar.

   Incluye el bloque de esquema sql/schema/changes/0025_cupones-a-mano-y-boletos-contados.sql (tablas,
   columnas, seed). Cada paso de ese bloque comprueba su existencia.
   ============================================================ */

/* ========== ESQUEMA: sql/schema/changes/0025_cupones-a-mano-y-boletos-contados.sql ========== */
/* ============================================================
   0025 — una rifa puede tener un numero de boletos

   Hasta ahora una rifa repartia boletos sin fin: el numero de cada uno
   salia de contar los que ya habia, y nada decia cuantos iba a haber. Al
   crearla no se podia decir "son quinientos", asi que tampoco se podia
   ver cuantos quedaban ni cuando se llenaba.

   `tickets_total` NULL significa lo de siempre, sin tope. Se deja NULL a
   proposito y no 0: las rifas que ya existen no tenian limite, y darles
   uno por omision cambiaria su comportamiento sin que nadie lo pidiera.

   Idempotente: comprueba la columna antes de anadirla.
   ============================================================ */

IF COL_LENGTH('dbo.raffle_definitions', 'tickets_total') IS NULL
    ALTER TABLE dbo.raffle_definitions ADD tickets_total INT NULL;
GO

/* Un tope de cero o negativo no significa nada: o hay boletos o no hay
   rifa. Se admite NULL, que es "sin tope". */
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints
                WHERE name = 'CK_raffle_definitions_boletos')
    ALTER TABLE dbo.raffle_definitions WITH CHECK
        ADD CONSTRAINT CK_raffle_definitions_boletos
        CHECK (tickets_total IS NULL OR tickets_total > 0);
GO
GO

/* ---------- sp_coupon_issue (SQL_STORED_PROCEDURE) ---------- */
/* sp_coupon_issue
 * Definicion canonica. Modificar aqui y generar una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* ============================================================
   sp_coupon_issue — emitir cupones sin que haya una venta.

   POR QUE HACE FALTA
   ------------------
   Hasta ahora un cupon solo nacia dentro de `sp_loyalty_evaluate_sale`:
   habia que crear una campana que lo entregase y esperar a que alguien
   comprase. Definir el cupon y quedarse ahi no servia de nada, y desde la
   pantalla no habia ningun boton que lo convirtiera en codigos usables.

   Esto cubre el otro caso, que es igual de real: repartir codigos a mano.
   Un taco de volantes, una promocion en redes, veinte cupones para el
   cliente que trae un coche de flota. No hay venta, no hay campana y puede
   no haber cliente: las tres columnas admiten NULL precisamente por eso.

   LO QUE NO CAMBIA
   ----------------
   El cupon emitido aqui es EXACTAMENTE el mismo objeto que el que emite una
   campana: mismo estado, mismo prefijo, misma caducidad, mismos usos. Lo
   valida y lo canjea el mismo procedimiento de siempre. Si fuera otra cosa,
   habria dos tipos de cupon y dos reglas para gastarlos.

   EL CODIGO
   ---------
   Se inserta con un valor provisional unico y despues se reescribe con el
   `id` ya asignado: PREFIJO-000123. Es el mismo metodo que usa la
   evaluacion de la venta, y por la misma razon: el numero legible sale del
   IDENTITY, que es lo unico que garantiza que no se repite.
   ============================================================ */
CREATE OR ALTER PROCEDURE dbo.sp_coupon_issue
    @definition_id INT,
    @quantity      INT = 1,
    @customer_id   INT = NULL,
    @machine_id    NVARCHAR(64) = NULL,
    @register_id   INT = NULL
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @ahora DATETIME2(0) = SYSDATETIME();

    /* Un tope sensato. No es una limitacion tecnica: es que pedir cinco mil
       cupones de golpe casi siempre es un cero de mas, y deshacerlo despues
       obliga a anular uno por uno. */
    IF @quantity IS NULL OR @quantity < 1 OR @quantity > 500
    BEGIN
        SELECT CAST(0 AS BIT) AS ok, N'CANTIDAD' AS motivo,
               N'La cantidad tiene que estar entre 1 y 500.' AS mensaje;
        RETURN;
    END

    DECLARE @activo BIT, @usos INT, @dias INT, @prefijo NVARCHAR(8);
    SELECT @activo = active, @usos = uses_allowed,
           @dias = valid_days, @prefijo = code_prefix
      FROM dbo.coupon_definitions
     WHERE id = @definition_id;

    IF @activo IS NULL
    BEGIN
        SELECT CAST(0 AS BIT) AS ok, N'NO_EXISTE' AS motivo,
               N'Ese cupón no existe.' AS mensaje;
        RETURN;
    END

    /* Emitir codigos de un cupon apagado dejaria en la calle papeles que no
       se pueden canjear. El cajero veria "cupón no válido" y no sabria por
       que. Se enciende primero. */
    IF @activo = 0
    BEGIN
        SELECT CAST(0 AS BIT) AS ok, N'APAGADO' AS motivo,
               N'Enciende el cupón antes de emitirlo: los códigos no se podrían canjear.' AS mensaje;
        RETURN;
    END

    DECLARE @nuevos TABLE (id INT NOT NULL);

    BEGIN TRY
        BEGIN TRANSACTION;

        /* Una fila por cupon pedido. `sys.all_objects` es solo un generador
           de filas: no se lee nada de el. */
        INSERT INTO dbo.coupon_instances
            (definition_id, campaign_id, customer_id, code, sale_id, register_id,
             machine_id, status, uses_allowed, issued_at, expires_at)
        OUTPUT INSERTED.id INTO @nuevos(id)
        SELECT TOP (@quantity)
               @definition_id, NULL, @customer_id,
               LEFT(REPLACE(CAST(NEWID() AS NVARCHAR(36)), '-', ''), 24),
               NULL, @register_id, @machine_id,
               'ISSUED', @usos, @ahora,
               CASE WHEN @dias IS NULL THEN NULL ELSE DATEADD(DAY, @dias, @ahora) END
          FROM sys.all_objects;

        UPDATE ci
           SET code = CONCAT(@prefijo, '-', RIGHT(CONCAT('00000', CAST(ci.id AS NVARCHAR(20))), 6))
          FROM dbo.coupon_instances ci
          JOIN @nuevos n ON n.id = ci.id;

        COMMIT TRANSACTION;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
        SELECT CAST(0 AS BIT) AS ok, N'ERROR' AS motivo, ERROR_MESSAGE() AS mensaje;
        RETURN;
    END CATCH

    /* Se devuelven los codigos recien creados: quien los pidio tiene que
       poder imprimirlos o dictarlos sin ir a buscarlos a otra pantalla. */
    SELECT CAST(1 AS BIT) AS ok, N'OK' AS motivo,
           CAST(NULL AS NVARCHAR(200)) AS mensaje,
           ci.id, ci.code, ci.expires_at, ci.uses_allowed
      FROM dbo.coupon_instances ci
      JOIN @nuevos n ON n.id = ci.id
     ORDER BY ci.id;
END

/* ---------- sp_dynamic_play (SQL_STORED_PROCEDURE) ---------- */
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

/* ---------- sp_loyalty_evaluate_sale (SQL_STORED_PROCEDURE) ---------- */
/* sp_loyalty_evaluate_sale
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* ============================================================
   sp_loyalty_evaluate_sale — que gano esta venta.

   CUANDO SE LLAMA
   ---------------
   DESPUES de que la venta esta confirmada, nunca dentro de su transaccion.
   Una campana jamas puede otorgar nada por una venta que acabo en ROLLBACK:
   la venta es la fuente de verdad y esto es una consecuencia suya.

   Por eso no vive dentro de `sp_register_sale`: meterlo ahi haria que un fallo
   de fidelizacion -una campana mal configurada- tumbara un cobro. El cobro es
   lo unico que no se puede perder.

   QUE HACE
   --------
   Recorre las campanas activas y vigentes, comprueba sus condiciones contra
   la venta, y por cada una que aplica otorga lo suyo:

     REWARD        una recompensa a nombre del cliente (o con codigo)
     COUPON        un cupon con su codigo
     DYNAMIC       un intento de dinamica, PENDIENTE de jugarse
     RAFFLE_ENTRY  una o varias participaciones de rifa

   `per_amount` es lo que convierte "cada $200, un boleto" en una regla: con
   $650 y per_amount 200 salen 3. Sin el, `quantity` manda tal cual.

   IDEMPOTENTE POR VENTA
   ---------------------
   Si se vuelve a llamar con la misma venta no otorga nada nuevo. Un reintento
   del IPC -o dos pantallas pidiendo lo mismo- no puede duplicar premios.
   ============================================================ */
CREATE OR ALTER PROCEDURE [dbo].[sp_loyalty_evaluate_sale]
    @sale_id INT,
    @machine_id NVARCHAR(64) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    /* La capacidad apagada no es un error: es un negocio que no usa esto.
       Devuelve CERO FILAS, con la misma forma que el resultado normal: quien
       llama recorre una lista de premios y no tiene por que distinguir entre
       "no gano nada" y "esto esta apagado". */
    IF NOT EXISTS (SELECT 1 FROM dbo.business_config WHERE loyalty_enabled = 1)
    BEGIN
        SELECT CAST(NULL AS VARCHAR(12)) AS tipo, CAST(NULL AS NVARCHAR(40)) AS codigo,
               CAST(NULL AS NVARCHAR(120)) AS nombre, CAST(NULL AS INT) AS numero,
               CAST(NULL AS NVARCHAR(32)) AS token, CAST(NULL AS NVARCHAR(120)) AS rifa
        WHERE 1 = 0;
        RETURN;
    END

    DECLARE @customer_id INT, @total DECIMAL(12,2), @register_id INT, @fecha DATETIME;
    /* ------------------------------------------------------------------
       RELOJ: hora LOCAL del negocio, en todo Fidelizacion.

       Una campana no puede medir unas reglas con un reloj y otras con otro.
       Aqui convivian los dos: la vigencia (`starts_at` / `ends_at`) se
       comparaba contra SYSUTCDATETIME mientras el dia de la semana y el
       horario salian de `sales.datee`, que `sp_register_sale` sella con
       GETDATE() -hora local-. Con el servidor en UTC-6, una campana con
       fecha de fin caducaba SEIS HORAS antes del final del dia elegido.

       La politica para V1 es la hora local del servidor, y no es una
       eleccion arbitraria: es la que ya usa el resto del POS en lo
       operativo -la venta, el turno, los movimientos de caja- y la unica
       que el negocio entiende. "Promocion los martes de 2 a 4" significa
       las dos de la tarde ALLI, no en Greenwich.

       Wybix todavia no tiene una zona horaria configurable. Cuando la
       tenga, este es el unico sitio que hay que mirar: reglas y caducidades
       de Fidelizacion se derivan de aqui.

       Los `created_at` por defecto de las tablas siguen en UTC: son
       auditoria de fila, no reglas, y ningun procedure los deja al valor
       por defecto ni ninguna pantalla los muestra.
       ------------------------------------------------------------------ */
    /* `@ahora` sella lo que se EMITE en este momento (issued_at, caducidades).
       Las CONDICIONES de la campana no lo usan: esas miran a `@fecha`, el
       instante de la venta. Son dos preguntas distintas y cada una tiene su
       reloj, pero ambos son locales. */
    DECLARE @ahora DATETIME2(0) = SYSDATETIME();
    DECLARE @yaEvaluada BIT = 0;

    /* ------------------------------------------------------------------
       UNA venta se evalua UNA vez, aunque la pregunten varios a la vez.

       El `IF EXISTS` de abajo no basta por si solo: es leer y luego escribir,
       y entre las dos cosas cabe otra sesion entera. Con seis evaluaciones
       simultaneas de la misma venta -el reintento del IPC, o dos pantallas
       abiertas sobre el mismo cobro- las seis pasaban la comprobacion y las
       seis repartian premio. Medido: seis recompensas para una sola venta.

       El bloqueo se toma sobre la FILA DE LA VENTA, no sobre las tablas de
       premios ni con un candado global. Asi dos cajas cobrando ventas
       distintas no se esperan nunca: solo se serializa quien pregunta por la
       MISMA venta, que es exactamente lo que hay que serializar.
       ------------------------------------------------------------------ */
    BEGIN TRY
        BEGIN TRAN;

        SELECT @customer_id = customer_id, @total = total, @register_id = register_id, @fecha = datee
        FROM dbo.sales WITH (UPDLOCK, HOLDLOCK) WHERE id = @sale_id;

        IF @total IS NULL
        BEGIN
            IF XACT_STATE() <> 0 ROLLBACK TRAN;
            RAISERROR('La venta no existe.', 16, 1);
            RETURN;
        END

        /* Ya evaluada: no se otorga dos veces. Quien llegue el segundo
           esperaba en el UPDLOCK de arriba, asi que aqui ya ve el premio que
           acaba de escribir el primero. */
        IF EXISTS (SELECT 1 FROM dbo.reward_instances WHERE sale_id = @sale_id)
        OR EXISTS (SELECT 1 FROM dbo.coupon_instances WHERE sale_id = @sale_id)
        OR EXISTS (SELECT 1 FROM dbo.dynamic_attempts WHERE sale_id = @sale_id)
        OR EXISTS (SELECT 1 FROM dbo.raffle_entries WHERE sale_id = @sale_id)
            SET @yaEvaluada = 1;

        IF @yaEvaluada = 0
        BEGIN
    /* Dia de la semana con LUNES = bit 0, que es como lo pinta la pantalla
       ("Lun Mar Mie Jue Vie Sab Dom").

       No se usa `DATEPART(WEEKDAY) - 1` por dos razones. La primera es que
       daria DOMINGO = 0 y una campana de "solo lunes" se entregaria los
       domingos. La segunda es que DATEPART(WEEKDAY) depende de SET DATEFIRST,
       que es una opcion de SESION: con varias cajas conectandose con distinta
       configuracion regional, la misma campana aplicaria en dias distintos
       segun el equipo que cobrara. Esta formula no depende de nada. */
    DECLARE @dow TINYINT = (DATEPART(WEEKDAY, @fecha) + @@DATEFIRST - 2) % 7;
    DECLARE @hora TIME(0) = CAST(@fecha AS TIME(0));

    /* Las campanas que APLICAN a esta venta. Cada condicion es una columna, y
       NULL significa "no condiciona": asi una campana sin condiciones aplica
       siempre y no hay que inventarse valores centinela. */
    SELECT c.*,
           CAST(CASE WHEN ISNULL(c.per_amount, 0) > 0
                     THEN FLOOR(@total / c.per_amount) * c.quantity
                     ELSE c.quantity END AS INT) AS unidades
    INTO #aplican
    FROM dbo.campaigns c
    WHERE c.active = 1
      /* Contra el instante de LA VENTA, no contra "ahora".

         Es la misma familia de fallo que el reloj: la pregunta es "¿esta
         campana aplicaba a ESTA venta?", y eso lo decide cuando ocurrio la
         venta, no cuando a alguien le dio por evaluarla.

         Con `@ahora` las cuatro condiciones miraban a dos instantes
         distintos: el dia y el horario salian de la venta, y la vigencia del
         momento de evaluar. En una venta que se evalua al segundo siguiente
         coinciden, asi que no se nota; en una que se reevalua mas tarde -o
         que se cobra a las 23:59:58 y se evalua a las 00:00:01- no. Medido:
         una venta de ayer cobraba premios de una campana que empezo hoy. */
      AND (c.starts_at IS NULL OR c.starts_at <= @fecha)
      AND (c.ends_at IS NULL OR c.ends_at >= @fecha)
      AND (c.min_total IS NULL OR @total >= c.min_total)
      AND (c.weekday_mask IS NULL OR (c.weekday_mask & POWER(2, @dow)) > 0)
      AND (c.time_from IS NULL OR @hora >= c.time_from)
      AND (c.time_to IS NULL OR @hora <= c.time_to)
      AND (c.requires_customer = 0 OR @customer_id IS NOT NULL)
      AND (c.product_id IS NULL OR EXISTS (
              SELECT 1 FROM dbo.sale_detail d
              WHERE d.sale_id = @sale_id AND d.product_id = c.product_id))
      AND (c.first_purchase_only = 0 OR (
              @customer_id IS NOT NULL AND NOT EXISTS (
                  SELECT 1 FROM dbo.sales s
                  WHERE s.customer_id = @customer_id AND s.id <> @sale_id)))
      /* Una campana que no reparte nada no es una campana. */
      AND (ISNULL(c.per_amount, 0) = 0 OR @total >= c.per_amount);

    DELETE FROM #aplican WHERE unidades < 1;

    /* -------------------------------------------------------- RECOMPENSAS
       El codigo se deriva del `id`, que ya es unico: alguien lo va a dictar
       por telefono o leerlo de un ticket, asi que tiene que ser corto y sin
       caracteres que se confundan. Se inserta un valor provisional -unico por
       construccion- y se reescribe con el id definitivo.

       Se descarto una SEQUENCE a proposito: es un tipo de objeto mas que el
       constructor del baseline no despliega, y ya hubo dos incidentes por
       objetos que estaban en Git y no llegaban al instalador. */
    INSERT INTO dbo.reward_instances
        (definition_id, campaign_id, customer_id, code, sale_id, register_id, machine_id,
         status, uses_allowed, issued_at, expires_at)
    SELECT rd.id, a.id, @customer_id,
           LEFT(REPLACE(CAST(NEWID() AS NVARCHAR(36)), '-', ''), 24),
           @sale_id, @register_id, @machine_id,
           'ISSUED', rd.uses_allowed, @ahora,
           CASE WHEN rd.valid_days IS NULL THEN NULL ELSE DATEADD(DAY, rd.valid_days, @ahora) END
    FROM #aplican a
    JOIN dbo.reward_definitions rd ON rd.id = a.reward_definition_id AND rd.active = 1
    WHERE a.outcome = 'REWARD';

    UPDATE dbo.reward_instances
       SET code = CONCAT('RW-', RIGHT(CONCAT('00000', CAST(id AS NVARCHAR(20))), 6))
     WHERE sale_id = @sale_id;

    /* ------------------------------------------------------------ CUPONES */
    INSERT INTO dbo.coupon_instances
        (definition_id, campaign_id, customer_id, code, sale_id, register_id, machine_id,
         status, uses_allowed, issued_at, expires_at)
    SELECT cd.id, a.id, @customer_id,
           LEFT(REPLACE(CAST(NEWID() AS NVARCHAR(36)), '-', ''), 24),
           @sale_id, @register_id, @machine_id,
           'ISSUED', cd.uses_allowed, @ahora,
           CASE WHEN cd.valid_days IS NULL THEN NULL ELSE DATEADD(DAY, cd.valid_days, @ahora) END
    FROM #aplican a
    JOIN dbo.coupon_definitions cd ON cd.id = a.coupon_definition_id AND cd.active = 1
    WHERE a.outcome = 'COUPON';

    UPDATE ci
       SET code = CONCAT(cd.code_prefix, '-', RIGHT(CONCAT('00000', CAST(ci.id AS NVARCHAR(20))), 6))
    FROM dbo.coupon_instances ci
    JOIN dbo.coupon_definitions cd ON cd.id = ci.definition_id
    WHERE ci.sale_id = @sale_id;

    /* ---------------------------------------------------------- DINAMICAS
       Nace PENDIENTE. El token es lo unico que la pantalla necesita conocer,
       y solo sirve mientras el intento siga sin jugarse. */
    INSERT INTO dbo.dynamic_attempts
        (definition_id, campaign_id, customer_id, token, sale_id, register_id, machine_id,
         status, created_at, expires_at)
    SELECT dd.id, a.id, @customer_id,
           REPLACE(CAST(NEWID() AS NVARCHAR(36)), '-', ''),
           @sale_id, @register_id, @machine_id,
           'PENDING', @ahora, DATEADD(HOUR, 2, @ahora)
    FROM #aplican a
    JOIN dbo.dynamic_definitions dd ON dd.id = a.dynamic_definition_id AND dd.active = 1
    WHERE a.outcome = 'DYNAMIC';

    /* -------------------------------------------------------------- RIFAS
       La numeracion sale de la BASE, no de un contador por equipo: la Caja 1
       y la Caja 2 escriben en la misma tabla y los numeros no se pisan. El
       indice unico (raffle_id, entry_number) lo garantiza aunque dos cajas
       cobren en el mismo instante.

       Una rifa que no esta OPEN no admite entradas: es lo que hace que un
       sorteo ya hecho no se pueda alterar a posteriori. */
    DECLARE @raffle_id INT, @unidades INT, @campaign_id INT;
    DECLARE cur CURSOR LOCAL FAST_FORWARD FOR
        SELECT a.raffle_id, a.unidades, a.id
        FROM #aplican a
        JOIN dbo.raffle_definitions r ON r.id = a.raffle_id AND r.status = 'OPEN'
        WHERE a.outcome = 'RAFFLE_ENTRY';
    OPEN cur;
    FETCH NEXT FROM cur INTO @raffle_id, @unidades, @campaign_id;
    WHILE @@FETCH_STATUS = 0
    BEGIN
        /* El tope de boletos de la rifa, si lo tiene. NULL es sin tope. */
        DECLARE @tope INT = (SELECT tickets_total FROM dbo.raffle_definitions WHERE id = @raffle_id);

        DECLARE @i INT = 0;
        WHILE @i < @unidades
        BEGIN
            /* Se comprueba DENTRO del bucle y con el mismo bloqueo que usa
               la numeracion: si dos cajas cobran a la vez y quedan tres
               boletos, no se pueden repartir seis. Al llenarse se deja de
               repartir sin error: la venta es valida y el resto de premios
               tambien. */
            IF @tope IS NOT NULL
               AND (SELECT COUNT(*) FROM dbo.raffle_entries WITH (UPDLOCK, HOLDLOCK)
                     WHERE raffle_id = @raffle_id AND status = 'VALID') >= @tope
                BREAK;

            INSERT INTO dbo.raffle_entries
                (raffle_id, entry_number, customer_id, sale_id, register_id, machine_id, campaign_id, status, created_at)
            SELECT @raffle_id,
                   ISNULL((SELECT MAX(entry_number) FROM dbo.raffle_entries WITH (UPDLOCK, HOLDLOCK)
                            WHERE raffle_id = @raffle_id), 0) + 1,
                   @customer_id, @sale_id, @register_id, @machine_id, @campaign_id, 'VALID', @ahora;
            SET @i = @i + 1;
        END
        FETCH NEXT FROM cur INTO @raffle_id, @unidades, @campaign_id;
    END
    CLOSE cur; DEALLOCATE cur;

        DROP TABLE #aplican;
        END   /* fin del reparto */

        COMMIT TRAN;
    END TRY
    BEGIN CATCH
        IF XACT_STATE() <> 0 ROLLBACK TRAN;
        DECLARE @msg NVARCHAR(400) = ERROR_MESSAGE();
        RAISERROR(@msg, 16, 1);
        RETURN;
    END CATCH

    /* Lo otorgado, para que la pantalla lo cuente y el ticket lo imprima.
       Se devuelve TAMBIEN cuando la venta ya estaba evaluada: un reintento
       tiene que poder volver a ensenar el premio, no quedarse sin nada que
       mostrar porque alguien pregunto dos veces. */
    SELECT 'REWARD' AS tipo, r.code AS codigo, rd.name AS nombre, NULL AS numero,
           NULL AS token, NULL AS rifa
    FROM dbo.reward_instances r
    JOIN dbo.reward_definitions rd ON rd.id = r.definition_id
    WHERE r.sale_id = @sale_id
    UNION ALL
    SELECT 'COUPON', c.code, cd.name, NULL, NULL, NULL
    FROM dbo.coupon_instances c
    JOIN dbo.coupon_definitions cd ON cd.id = c.definition_id
    WHERE c.sale_id = @sale_id
    UNION ALL
    SELECT 'DYNAMIC', NULL, dd.name, NULL, d.token, NULL
    FROM dbo.dynamic_attempts d
    JOIN dbo.dynamic_definitions dd ON dd.id = d.definition_id
    WHERE d.sale_id = @sale_id
    UNION ALL
    SELECT 'RAFFLE_ENTRY',
           CONCAT(rf.code_prefix, '-', RIGHT(CONCAT('0000000', CAST(e.entry_number AS NVARCHAR(20))), 8)),
           rf.name, e.entry_number, NULL, rf.name
    FROM dbo.raffle_entries e
    JOIN dbo.raffle_definitions rf ON rf.id = e.raffle_id
    WHERE e.sale_id = @sale_id
    ORDER BY tipo, numero;
END
GO

/* ---------- sp_raffle_detail (SQL_STORED_PROCEDURE) ---------- */
/* sp_raffle_detail
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* ---- Una rifa con sus participaciones, sus sorteos y sus ganadores.

   Tres resultsets:
     1 la rifa y sus conteos
     2 participaciones (las ultimas primero, con su caja de origen)
     3 ganadores de todos los sorteos, con la evidencia de cada uno

   Las participaciones se limitan: una rifa de un mes puede tener miles y la
   pantalla no necesita pintarlas todas para responder "¿cuantas llevo y de
   que cajas salieron?". */
CREATE OR ALTER PROCEDURE [dbo].[sp_raffle_detail]
    @raffle_id INT,
    @top_entries INT = 200
AS
BEGIN
    SET NOCOUNT ON;
    IF ISNULL(@top_entries, 0) < 1 SET @top_entries = 200;

    SELECT r.id, r.name, r.description, r.prize, r.starts_at, r.ends_at, r.tickets_total,
           r.status, r.winners_count, r.code_prefix, r.created_at,
           /* La foto del cierre: cuantos boletos quedaron dentro y cuando. */
           r.closed_at, r.closed_entries_count, r.closed_max_entry_id,
           (SELECT COUNT(*) FROM dbo.raffle_entries e WHERE e.raffle_id = r.id AND e.status = 'VALID') AS participaciones,
           (SELECT COUNT(DISTINCT e.customer_id) FROM dbo.raffle_entries e WHERE e.raffle_id = r.id AND e.customer_id IS NOT NULL) AS clientes,
           (SELECT COUNT(DISTINCT e.register_id) FROM dbo.raffle_entries e WHERE e.raffle_id = r.id) AS cajas
    FROM dbo.raffle_definitions r
    WHERE r.id = @raffle_id;

    SELECT TOP (@top_entries)
           e.id, e.entry_number,
           CONCAT(rf.code_prefix, '-', RIGHT(CONCAT('0000000', CAST(e.entry_number AS NVARCHAR(20))), 8)) AS boleto,
           e.customer_id, c.customerName AS cliente,
           e.sale_id, e.register_id, rg.name AS caja, e.machine_id,
           e.campaign_id, cp.name AS campana,
           e.status, e.created_at
    FROM dbo.raffle_entries e
    JOIN dbo.raffle_definitions rf ON rf.id = e.raffle_id
    LEFT JOIN dbo.customers c ON c.id = e.customer_id
    LEFT JOIN dbo.registers rg ON rg.id = e.register_id
    LEFT JOIN dbo.campaigns cp ON cp.id = e.campaign_id
    WHERE e.raffle_id = @raffle_id
    ORDER BY e.entry_number DESC;

    SELECT w.id AS winner_id, w.draw_id, w.position, w.status, w.delivered_at, w.notes,
           e.entry_number,
           CONCAT(rf.code_prefix, '-', RIGHT(CONCAT('0000000', CAST(e.entry_number AS NVARCHAR(20))), 8)) AS boleto,
           e.customer_id, c.customerName AS cliente, e.sale_id,
           d.drawn_at, d.entries_count, d.max_entry_id, d.algorithm, d.algorithm_version, d.seed,
           u.usuario AS sorteado_por
    FROM dbo.raffle_winners w
    JOIN dbo.raffle_draws d ON d.id = w.draw_id
    JOIN dbo.raffle_entries e ON e.id = w.entry_id
    JOIN dbo.raffle_definitions rf ON rf.id = d.raffle_id
    LEFT JOIN dbo.customers c ON c.id = e.customer_id
    LEFT JOIN dbo.users u ON u.id = d.drawn_by_user_id
    WHERE d.raffle_id = @raffle_id
    ORDER BY d.id DESC, w.position;
END
GO

/* ---------- sp_raffle_save (SQL_STORED_PROCEDURE) ---------- */
/* sp_raffle_save
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* ---- Crear o actualizar una rifa, y activarla.

   El ciclo de vida es de una sola direccion:

     DRAFT  -> OPEN     se activa y empieza a admitir participaciones
     OPEN   -> CLOSED   SOLO lo hace `sp_raffle_close`, que congela el universo
     CLOSED -> DRAWN    SOLO lo hace `sp_raffle_draw`

   Esta edicion solo puede hacer el primer paso. Los otros dos pertenecen a
   procedures propios porque cada uno deja constancia de algo -la foto de
   participantes, el resultado- y llegar ahi por un UPDATE de edicion se la
   saltaria.

   NO se puede reabrir una rifa cerrada. Se penso permitirlo "mientras no se
   haya sorteado", pero reabrir mueve el universo que ya se anuncio: la gente
   que pregunto cuantos boletos participaban recibio una respuesta, y esa
   respuesta dejaria de ser cierta sin que nadie se entere. Si algun dia hace
   falta, tendra que ser una operacion explicita y auditada, no un efecto de
   guardar el formulario. */
CREATE OR ALTER PROCEDURE [dbo].[sp_raffle_save]
    @id INT = NULL,
    @name NVARCHAR(120),
    @description NVARCHAR(400) = NULL,
    @prize NVARCHAR(200) = NULL,
    @starts_at DATETIME2(0) = NULL,
    @ends_at DATETIME2(0) = NULL,
    @winners_count INT = 1,
    @code_prefix NVARCHAR(8) = NULL,
    @status NVARCHAR(10) = NULL,
    @tickets_total INT = NULL
AS
BEGIN
    SET NOCOUNT ON;

    IF LTRIM(RTRIM(ISNULL(@name, N''))) = N''
    BEGIN RAISERROR('La rifa necesita un nombre.', 16, 1); RETURN; END
    IF ISNULL(@winners_count, 0) < 1 SET @winners_count = 1;
    IF LTRIM(RTRIM(ISNULL(@code_prefix, N''))) = N'' SET @code_prefix = N'RF';
    /* Un tope de cero no significa nada: o hay boletos o no hay rifa. Se
       guarda NULL, que es lo mismo que decir "sin tope". */
    IF ISNULL(@tickets_total, 0) < 1 SET @tickets_total = NULL;

    IF @id IS NULL
    BEGIN
        INSERT INTO dbo.raffle_definitions (name, description, prize, starts_at, ends_at, status, winners_count, code_prefix, tickets_total)
        VALUES (@name, @description, @prize, @starts_at, @ends_at, ISNULL(@status, N'DRAFT'), @winners_count, @code_prefix, @tickets_total);
        SET @id = SCOPE_IDENTITY();
    END
    ELSE
    BEGIN
        DECLARE @actual NVARCHAR(10);
        SELECT @actual = status FROM dbo.raffle_definitions WHERE id = @id;
        IF @actual IS NULL
        BEGIN RAISERROR('La rifa no existe.', 16, 1); RETURN; END

        /* Una rifa sorteada es historia: se puede renombrar, no revivir. */
        IF @actual = 'DRAWN' AND @status IS NOT NULL AND @status <> 'DRAWN'
        BEGIN
            RAISERROR('Esta rifa ya se sorteo: su estado no se puede cambiar.', 16, 1);
            RETURN;
        END
        IF @status = 'DRAWN'
        BEGIN
            RAISERROR('El estado sorteada lo pone el sorteo, no la edicion.', 16, 1);
            RETURN;
        END
        IF @status = 'CLOSED' AND @actual <> 'CLOSED'
        BEGIN
            RAISERROR('Para cerrar una rifa usa Cerrar: el cierre congela cuantos boletos participaban.', 16, 1);
            RETURN;
        END
        IF @actual = 'CLOSED' AND @status IS NOT NULL AND @status <> 'CLOSED'
        BEGIN
            RAISERROR('Esta rifa esta cerrada y no se puede reabrir: cambiaria el universo que ya se anuncio.', 16, 1);
            RETURN;
        END
        IF @status = 'DRAFT' AND @actual <> 'DRAFT'
        BEGIN
            RAISERROR('Una rifa ya activada no vuelve a borrador.', 16, 1);
            RETURN;
        END

        /* Bajar el tope por debajo de los boletos ya repartidos dejaria a
           la rifa pasada de su propio limite y a nadie le cuadraria la
           cuenta. Subirlo, o quitarlo, no rompe nada. */
        DECLARE @repartidos INT =
            (SELECT COUNT(*) FROM dbo.raffle_entries WHERE raffle_id = @id AND status = 'VALID');
        IF @tickets_total IS NOT NULL AND @tickets_total < @repartidos
        BEGIN
            RAISERROR('Ya hay %d boletos repartidos: el total no puede quedar por debajo.', 16, 1, @repartidos);
            RETURN;
        END

        UPDATE dbo.raffle_definitions
           SET name = @name, description = @description, prize = @prize,
               starts_at = @starts_at, ends_at = @ends_at,
               winners_count = @winners_count, code_prefix = @code_prefix,
               tickets_total = @tickets_total,
               status = ISNULL(@status, status)
         WHERE id = @id;
    END

    SELECT id, name, status, winners_count, code_prefix, tickets_total FROM dbo.raffle_definitions WHERE id = @id;
END
GO
