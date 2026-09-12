/* ============================================================
   0018 — dinamicas y rifas

   Generada con scripts/db/generar-migracion.mjs desde los archivos
   canonicos de sql/. No editar a mano: regenerar.

   Idempotente: todos los objetos usan CREATE OR ALTER, y los tipos
   comprueban su existencia antes de crearse. Se puede reejecutar.

   Incluye el bloque de esquema sql/schema/changes/0018_dinamicas-y-rifas.sql (tablas,
   columnas, seed). Cada paso de ese bloque comprueba su existencia.
   ============================================================ */

/* ========== ESQUEMA: sql/schema/changes/0018_dinamicas-y-rifas.sql ========== */
/* ---------------------------------------------------------------------------
   BLOQUE DE ESQUEMA — DINAMICAS Y RIFAS.

   Son dos cosas distintas y por eso son dos modelos:

     DINAMICA  resultado INMEDIATO. El cliente interactua y sabe al momento si
               gano. Produce un RESULTADO, no un descuento.
     RIFA      acumula participaciones, se cierra, y se sortea despues.

   LA DINAMICA NO DECIDE EL PREMIO
   -------------------------------
   `dynamic_attempts` guarda lo que hizo el cliente y el veredicto. Que premio
   le corresponde lo decide la campana. Mezclarlo obligaria a tocar la
   dinamica cada vez que cambie una promocion.

   Y sobre todo: EL RESULTADO NO LO DECIDE LA PANTALLA. El Customer Display
   manda lo que ocurrio -"pulso a los 10.014 s"- y SQL dice si eso es WIN. Un
   `if (winner) generarCupon()` en el renderer seria un boton para fabricar
   premios.

   EL TIPO NO ESTA CABLEADO
   ------------------------
   `type` admite TIMING, WHEEL, PICK_ONE, SCRATCH y RANDOM_REVEAL desde el
   primer dia. En esta entrega solo TIMING tiene interfaz, pero anadir la
   ruleta no toca ni una tabla: es una configuracion mas y una pantalla nueva.

   Idempotente: se puede reejecutar.
   --------------------------------------------------------------------------- */

IF OBJECT_ID(N'dbo.dynamic_definitions', 'U') IS NULL
BEGIN
CREATE TABLE dbo.dynamic_definitions (
    id INT IDENTITY(1, 1) NOT NULL,
    name NVARCHAR(120) COLLATE Modern_Spanish_CI_AS NOT NULL,
    -- TIMING | WHEEL | PICK_ONE | SCRATCH | RANDOM_REVEAL
    type NVARCHAR(20) COLLATE Modern_Spanish_CI_AS NOT NULL,
    description NVARCHAR(400) COLLATE Modern_Spanish_CI_AS NULL,

    /* Parametros de la mecanica. Se guardan como columnas porque en V1 los
       tipos comparten forma: un objetivo, una tolerancia y unos intentos.
       TIMING   objetivo 10.000 s, tolerancia 0.050
       WHEEL    objetivo = indice del sector premiado
       SCRATCH  objetivo = probabilidad, tolerancia sin uso
       El dia que un tipo necesite algo que no encaje, se le anade su columna;
       no hace falta un JSON para tres numeros. */
    target_value DECIMAL(12, 4) NULL,
    tolerance DECIMAL(12, 4) NULL,
    attempts_allowed INT NOT NULL CONSTRAINT DF_dynamic_definitions_attempts DEFAULT ((1)),

    -- Que se gana. La campana puede sobrescribirlo.
    reward_definition_id INT NULL,
    active BIT NOT NULL CONSTRAINT DF_dynamic_definitions_active DEFAULT ((1)),
    created_at DATETIME2(0) NOT NULL CONSTRAINT DF_dynamic_definitions_created_at DEFAULT (sysutcdatetime()),
    CONSTRAINT PK_dynamic_definitions PRIMARY KEY CLUSTERED (id)
);
END;
GO

IF OBJECT_ID(N'dbo.CK_dynamic_definitions_type', 'C') IS NULL
ALTER TABLE dbo.dynamic_definitions WITH CHECK ADD CONSTRAINT CK_dynamic_definitions_type
    CHECK ([type] IN ('TIMING', 'WHEEL', 'PICK_ONE', 'SCRATCH', 'RANDOM_REVEAL'));
GO

/* Un intento concreto. Nace PENDING al confirmarse la venta y se juega una
   sola vez: el `token` es lo que la pantalla presenta, y solo sirve mientras
   el intento siga pendiente. */
IF OBJECT_ID(N'dbo.dynamic_attempts', 'U') IS NULL
BEGIN
CREATE TABLE dbo.dynamic_attempts (
    id INT IDENTITY(1, 1) NOT NULL,
    definition_id INT NOT NULL,
    campaign_id INT NULL,
    customer_id INT NULL,
    token NVARCHAR(32) COLLATE Modern_Spanish_CI_AS NOT NULL,

    sale_id INT NULL,
    register_id INT NULL,
    machine_id NVARCHAR(64) COLLATE Modern_Spanish_CI_AS NULL,

    -- PENDING | PLAYED | EXPIRED | CANCELLED
    status NVARCHAR(12) COLLATE Modern_Spanish_CI_AS NOT NULL CONSTRAINT DF_dynamic_attempts_status DEFAULT ('PENDING'),
    -- Lo que hizo el cliente. Para TIMING, los segundos en que pulso.
    input_value DECIMAL(12, 4) NULL,
    -- WIN | LOSE. Lo escribe SQL, nunca la pantalla.
    result NVARCHAR(8) COLLATE Modern_Spanish_CI_AS NULL,
    reward_instance_id INT NULL,
    created_at DATETIME2(0) NOT NULL CONSTRAINT DF_dynamic_attempts_created_at DEFAULT (sysutcdatetime()),
    played_at DATETIME2(0) NULL,
    expires_at DATETIME2(0) NULL,
    CONSTRAINT PK_dynamic_attempts PRIMARY KEY CLUSTERED (id)
);
END;
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'UX_dynamic_attempts_token' AND object_id = OBJECT_ID(N'dbo.dynamic_attempts'))
CREATE UNIQUE NONCLUSTERED INDEX UX_dynamic_attempts_token ON dbo.dynamic_attempts (token);
GO

IF OBJECT_ID(N'dbo.FK_dynamic_attempts_definition', 'F') IS NULL
ALTER TABLE dbo.dynamic_attempts WITH CHECK ADD CONSTRAINT FK_dynamic_attempts_definition
    FOREIGN KEY (definition_id) REFERENCES dbo.dynamic_definitions (id);
GO

/* ===========================================================================
   RIFAS
   ===========================================================================
   COMO SE CONGELA EL UNIVERSO DEL SORTEO
   --------------------------------------
   Al sortear se guarda en `raffle_draws` cuantas participaciones habia Y cual
   era la ultima (`max_entry_id`). El universo del sorteo queda definido por
   "participaciones validas de esta rifa con id <= max_entry_id", que es un
   conjunto que ya no puede cambiar: los ids son crecientes y las filas no se
   borran. Ademas la rifa pasa a DRAWN y deja de admitir entradas.

   Se eligio eso en vez de copiar las participaciones a una tabla de snapshot
   porque copiarlas seria tener el mismo dato dos veces, con la posibilidad de
   que discrepen. Aqui el snapshot es una frontera, no una copia.
   =========================================================================== */
IF OBJECT_ID(N'dbo.raffle_definitions', 'U') IS NULL
BEGIN
CREATE TABLE dbo.raffle_definitions (
    id INT IDENTITY(1, 1) NOT NULL,
    name NVARCHAR(120) COLLATE Modern_Spanish_CI_AS NOT NULL,
    description NVARCHAR(400) COLLATE Modern_Spanish_CI_AS NULL,
    prize NVARCHAR(200) COLLATE Modern_Spanish_CI_AS NULL,
    starts_at DATETIME2(0) NULL,
    ends_at DATETIME2(0) NULL,
    -- DRAFT | OPEN | CLOSED | DRAWN
    status NVARCHAR(10) COLLATE Modern_Spanish_CI_AS NOT NULL CONSTRAINT DF_raffle_definitions_status DEFAULT ('DRAFT'),
    winners_count INT NOT NULL CONSTRAINT DF_raffle_definitions_winners DEFAULT ((1)),
    -- Prefijo del boleto visible: RF-00001534
    code_prefix NVARCHAR(8) COLLATE Modern_Spanish_CI_AS NOT NULL CONSTRAINT DF_raffle_definitions_prefix DEFAULT ('RF'),
    created_at DATETIME2(0) NOT NULL CONSTRAINT DF_raffle_definitions_created_at DEFAULT (sysutcdatetime()),
    CONSTRAINT PK_raffle_definitions PRIMARY KEY CLUSTERED (id)
);
END;
GO

IF OBJECT_ID(N'dbo.CK_raffle_definitions_status', 'C') IS NULL
ALTER TABLE dbo.raffle_definitions WITH CHECK ADD CONSTRAINT CK_raffle_definitions_status
    CHECK ([status] IN ('DRAFT', 'OPEN', 'CLOSED', 'DRAWN'));
GO

/* Una participacion. `entry_number` es correlativo POR RIFA y unico: es el
   numero que se imprime en el ticket y por el que pregunta el cliente.
   No pertenece a una computadora: la Caja 1 y la Caja 2 escriben en la misma
   tabla y la numeracion sale de ahi, no de un contador local. */
IF OBJECT_ID(N'dbo.raffle_entries', 'U') IS NULL
BEGIN
CREATE TABLE dbo.raffle_entries (
    id INT IDENTITY(1, 1) NOT NULL,
    raffle_id INT NOT NULL,
    entry_number INT NOT NULL,
    customer_id INT NULL,
    sale_id INT NULL,
    register_id INT NULL,
    machine_id NVARCHAR(64) COLLATE Modern_Spanish_CI_AS NULL,
    campaign_id INT NULL,
    -- VALID | VOID
    status NVARCHAR(8) COLLATE Modern_Spanish_CI_AS NOT NULL CONSTRAINT DF_raffle_entries_status DEFAULT ('VALID'),
    created_at DATETIME2(0) NOT NULL CONSTRAINT DF_raffle_entries_created_at DEFAULT (sysutcdatetime()),
    CONSTRAINT PK_raffle_entries PRIMARY KEY CLUSTERED (id)
);
END;
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'UX_raffle_entries_numero' AND object_id = OBJECT_ID(N'dbo.raffle_entries'))
CREATE UNIQUE NONCLUSTERED INDEX UX_raffle_entries_numero ON dbo.raffle_entries (raffle_id, entry_number);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_raffle_entries_sale' AND object_id = OBJECT_ID(N'dbo.raffle_entries'))
CREATE NONCLUSTERED INDEX IX_raffle_entries_sale ON dbo.raffle_entries (sale_id);
GO

IF OBJECT_ID(N'dbo.FK_raffle_entries_raffle', 'F') IS NULL
ALTER TABLE dbo.raffle_entries WITH CHECK ADD CONSTRAINT FK_raffle_entries_raffle
    FOREIGN KEY (raffle_id) REFERENCES dbo.raffle_definitions (id);
GO

/* El acto de sortear, con su evidencia. No basta con guardar el ganador: hay
   que poder explicar COMO salio, quien lo ejecuto y sobre que conjunto. */
IF OBJECT_ID(N'dbo.raffle_draws', 'U') IS NULL
BEGIN
CREATE TABLE dbo.raffle_draws (
    id INT IDENTITY(1, 1) NOT NULL,
    raffle_id INT NOT NULL,
    entries_count INT NOT NULL,
    -- La frontera del universo sorteado. Con ella, el conjunto es reproducible.
    max_entry_id INT NOT NULL,
    drawn_at DATETIME2(0) NOT NULL CONSTRAINT DF_raffle_draws_drawn_at DEFAULT (sysutcdatetime()),
    drawn_by_user_id INT NULL,
    register_id INT NULL,
    machine_id NVARCHAR(64) COLLATE Modern_Spanish_CI_AS NULL,
    algorithm NVARCHAR(40) COLLATE Modern_Spanish_CI_AS NOT NULL CONSTRAINT DF_raffle_draws_algorithm DEFAULT ('CRYPTO_UNIFORM'),
    algorithm_version INT NOT NULL CONSTRAINT DF_raffle_draws_algorithm_version DEFAULT ((1)),
    -- La semilla con la que se puede reproducir el sorteo.
    seed NVARCHAR(128) COLLATE Modern_Spanish_CI_AS NULL,
    status NVARCHAR(10) COLLATE Modern_Spanish_CI_AS NOT NULL CONSTRAINT DF_raffle_draws_status DEFAULT ('DONE'),
    CONSTRAINT PK_raffle_draws PRIMARY KEY CLUSTERED (id)
);
END;
GO

IF OBJECT_ID(N'dbo.FK_raffle_draws_raffle', 'F') IS NULL
ALTER TABLE dbo.raffle_draws WITH CHECK ADD CONSTRAINT FK_raffle_draws_raffle
    FOREIGN KEY (raffle_id) REFERENCES dbo.raffle_definitions (id);
GO

/* El resultado. `position` 1..n ordena titulares y suplentes; el estado
   acompana al premio hasta que se entrega. NO se borra historia: un ganador
   descalificado se marca, no desaparece. */
IF OBJECT_ID(N'dbo.raffle_winners', 'U') IS NULL
BEGIN
CREATE TABLE dbo.raffle_winners (
    id INT IDENTITY(1, 1) NOT NULL,
    draw_id INT NOT NULL,
    entry_id INT NOT NULL,
    position INT NOT NULL,
    -- WINNER | ALTERNATE | UNCLAIMED | DISQUALIFIED | DELIVERED
    status NVARCHAR(14) COLLATE Modern_Spanish_CI_AS NOT NULL CONSTRAINT DF_raffle_winners_status DEFAULT ('WINNER'),
    delivered_at DATETIME2(0) NULL,
    delivered_by_user_id INT NULL,
    notes NVARCHAR(300) COLLATE Modern_Spanish_CI_AS NULL,
    CONSTRAINT PK_raffle_winners PRIMARY KEY CLUSTERED (id)
);
END;
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'UX_raffle_winners_posicion' AND object_id = OBJECT_ID(N'dbo.raffle_winners'))
CREATE UNIQUE NONCLUSTERED INDEX UX_raffle_winners_posicion ON dbo.raffle_winners (draw_id, position);
GO

IF OBJECT_ID(N'dbo.FK_raffle_winners_draw', 'F') IS NULL
ALTER TABLE dbo.raffle_winners WITH CHECK ADD CONSTRAINT FK_raffle_winners_draw
    FOREIGN KEY (draw_id) REFERENCES dbo.raffle_draws (id);
GO

IF OBJECT_ID(N'dbo.FK_raffle_winners_entry', 'F') IS NULL
ALTER TABLE dbo.raffle_winners WITH CHECK ADD CONSTRAINT FK_raffle_winners_entry
    FOREIGN KEY (entry_id) REFERENCES dbo.raffle_entries (id);
GO

/* ---------- sp_dynamic_pending (SQL_STORED_PROCEDURE) ---------- */
/* sp_dynamic_pending
 * Definicion canonica. Mantener este archivo y generar una migracion.
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
      AND (a.expires_at IS NULL OR a.expires_at > SYSUTCDATETIME())
    ORDER BY a.id;
END
GO

/* ---------- sp_dynamic_play (SQL_STORED_PROCEDURE) ---------- */
/* sp_dynamic_play
 * Definicion canonica. Mantener este archivo y generar una migracion.
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

    DECLARE @ahora DATETIME2(0) = SYSUTCDATETIME();
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
               N'Esta participación ya se jugó.' AS mensaje;
        RETURN;
    END

    IF @expira IS NOT NULL AND @expira < @ahora
    BEGIN
        UPDATE dbo.dynamic_attempts SET status = 'EXPIRED' WHERE id = @id;
        SELECT CAST(0 AS BIT) AS ok, N'CADUCADO' AS motivo,
               CAST(NULL AS NVARCHAR(8)) AS resultado, CAST(NULL AS NVARCHAR(24)) AS codigo,
               CAST(NULL AS NVARCHAR(120)) AS premio,
               N'Esta participación caducó.' AS mensaje;
        RETURN;
    END

    IF @activa = 0
    BEGIN
        SELECT CAST(0 AS BIT) AS ok, N'INACTIVA' AS motivo,
               CAST(NULL AS NVARCHAR(8)) AS resultado, CAST(NULL AS NVARCHAR(24)) AS codigo,
               CAST(NULL AS NVARCHAR(120)) AS premio,
               N'Esta dinámica ya no está activa.' AS mensaje;
        RETURN;
    END

    /* ------------------------------------------------------- EL VEREDICTO */
    DECLARE @resultado NVARCHAR(8) = 'LOSE';

    IF @tipo = 'TIMING'
        SET @resultado = CASE WHEN ABS(@input_value - ISNULL(@objetivo, 0)) <= ISNULL(@tolerancia, 0)
                              THEN 'WIN' ELSE 'LOSE' END;
    ELSE IF @tipo IN ('WHEEL', 'PICK_ONE', 'RANDOM_REVEAL')
        /* El sector/opcion premiado es `target_value`. La pantalla dice cual
           salio; comparar es cosa de aqui. */
        SET @resultado = CASE WHEN @input_value = ISNULL(@objetivo, -1) THEN 'WIN' ELSE 'LOSE' END;
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
               played_at = @ahora,
               machine_id = ISNULL(@machine_id, machine_id)
         WHERE id = @id AND status = 'PENDING';

        IF @@ROWCOUNT = 0
        BEGIN
            ROLLBACK TRAN;
            SELECT CAST(0 AS BIT) AS ok, N'YA_JUGADO' AS motivo,
                   CAST(NULL AS NVARCHAR(8)) AS resultado, CAST(NULL AS NVARCHAR(24)) AS codigo,
                   CAST(NULL AS NVARCHAR(120)) AS premio,
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

        COMMIT TRAN;
    END TRY
    BEGIN CATCH
        IF XACT_STATE() <> 0 ROLLBACK TRAN;
        DECLARE @msg NVARCHAR(400) = ERROR_MESSAGE();
        RAISERROR(@msg, 16, 1);
        RETURN;
    END CATCH

    SELECT CAST(1 AS BIT) AS ok, NULL AS motivo, @resultado AS resultado, @codigo AS codigo,
           @premio AS premio,
           CASE WHEN @resultado = 'WIN' AND @premio IS NOT NULL
                    THEN CONCAT(N'¡Ganaste! ', @premio)
                WHEN @resultado = 'WIN' THEN N'¡Ganaste!'
                ELSE N'Esta vez no fue. ¡Gracias por participar!' END AS mensaje;
END
GO

/* ---------- sp_raffle_detail (SQL_STORED_PROCEDURE) ---------- */
/* sp_raffle_detail
 * Definicion canonica. Mantener este archivo y generar una migracion.
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

    SELECT r.id, r.name, r.description, r.prize, r.starts_at, r.ends_at,
           r.status, r.winners_count, r.code_prefix, r.created_at,
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

/* ---------- sp_raffle_draw (SQL_STORED_PROCEDURE) ---------- */
/* sp_raffle_draw
 * Definicion canonica. Mantener este archivo y generar una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* ============================================================
   sp_raffle_draw — sortear, y poder explicar despues como se sorteo.

   POR QUE NO BASTA CON GUARDAR EL GANADOR
   ---------------------------------------
   Un sorteo que solo deja escrito "gano el boleto 412" no se puede defender
   ante nadie. Si un cliente pregunta, la unica respuesta seria "confia". Aqui
   queda registrado sobre QUE conjunto se sorteo, CUANDO, QUIEN lo ejecuto,
   con que algoritmo y con que semilla.

   COMO SE CONGELA EL UNIVERSO
   ---------------------------
   Se guarda `max_entry_id`: la ultima participacion que existia en ese
   momento. El conjunto sorteado queda definido como "participaciones validas
   de esta rifa con id <= max_entry_id", que ya no puede cambiar porque los
   ids son crecientes y las filas no se borran. Ademas la rifa pasa a DRAWN y
   deja de admitir entradas.

   Se descarto copiar las participaciones a una tabla de snapshot: seria el
   mismo dato dos veces, con la posibilidad de que discrepen. Aqui el snapshot
   es una FRONTERA, no una copia.

   EL AZAR
   -------
   `CRYPTO_UNIFORM v1` = ordenar por `CHECKSUM(NEWID())`, que en SQL Server da
   una permutacion uniforme sin sesgo de modulo. La semilla que se guarda es
   el identificador del sorteo mas su instante: no reproduce la permutacion
   -NEWID no lo permite- pero sella el acto. Queda anotado como tal: si algun
   dia se exige reproducibilidad total, sube `algorithm_version` y se
   distingue de los sorteos anteriores sin reescribir ninguno.

   NO SE BORRA HISTORIA: un sorteo repetido crea otro `raffle_draw`; el
   anterior sigue ahi.
   ============================================================ */
CREATE OR ALTER PROCEDURE [dbo].[sp_raffle_draw]
    @raffle_id INT,
    @user_id INT = NULL,
    @register_id INT = NULL,
    @machine_id NVARCHAR(64) = NULL,
    @winners INT = NULL,
    @alternates INT = 0
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    DECLARE @estado NVARCHAR(10), @cuantos INT;
    SELECT @estado = status, @cuantos = ISNULL(@winners, winners_count)
    FROM dbo.raffle_definitions WHERE id = @raffle_id;

    IF @estado IS NULL
    BEGIN RAISERROR('La rifa no existe.', 16, 1); RETURN; END

    IF @estado = 'DRAWN'
    BEGIN RAISERROR('Esta rifa ya se sorteo. Consulta el resultado anterior.', 16, 1); RETURN; END

    IF @estado = 'DRAFT'
    BEGIN RAISERROR('Esta rifa todavia no se ha abierto: no tiene participaciones.', 16, 1); RETURN; END

    DECLARE @total INT, @maxId INT;
    SELECT @total = COUNT(*), @maxId = ISNULL(MAX(id), 0)
    FROM dbo.raffle_entries
    WHERE raffle_id = @raffle_id AND status = 'VALID';

    IF @total = 0
    BEGIN RAISERROR('Esta rifa no tiene participaciones validas: no hay nada que sortear.', 16, 1); RETURN; END

    IF @cuantos < 1 SET @cuantos = 1;
    IF @cuantos > @total SET @cuantos = @total;
    IF @alternates < 0 SET @alternates = 0;
    IF @cuantos + @alternates > @total SET @alternates = @total - @cuantos;

    DECLARE @draw_id INT;

    BEGIN TRY
        BEGIN TRAN;

        /* La rifa se cierra ANTES de elegir. Entre el cierre y la eleccion no
           puede colarse una participacion: `sp_loyalty_evaluate_sale` solo
           inserta en rifas OPEN, y aqui ya no lo esta. */
        UPDATE dbo.raffle_definitions
           SET status = 'DRAWN'
         WHERE id = @raffle_id AND status IN ('OPEN', 'CLOSED');

        IF @@ROWCOUNT = 0
        BEGIN
            ROLLBACK TRAN;
            RAISERROR('Otra caja sorteo esta rifa al mismo tiempo. Consulta el resultado.', 16, 1);
            RETURN;
        END

        INSERT INTO dbo.raffle_draws
            (raffle_id, entries_count, max_entry_id, drawn_at, drawn_by_user_id,
             register_id, machine_id, algorithm, algorithm_version, seed, status)
        VALUES
            (@raffle_id, @total, @maxId, SYSUTCDATETIME(), @user_id,
             @register_id, @machine_id, 'CRYPTO_UNIFORM', 1,
             CONCAT('raffle:', @raffle_id, '|max:', @maxId, '|n:', @total,
                    '|at:', CONVERT(NVARCHAR(30), SYSUTCDATETIME(), 126)),
             'DONE');

        SET @draw_id = SCOPE_IDENTITY();

        /* Titulares y suplentes salen de la MISMA permutacion: los primeros
           son ganadores y los siguientes quedan como reserva ordenada. Asi un
           premio no reclamado tiene sucesor sin repetir el sorteo. */
        INSERT INTO dbo.raffle_winners (draw_id, entry_id, position, status)
        SELECT @draw_id, t.id, t.pos,
               CASE WHEN t.pos <= @cuantos THEN 'WINNER' ELSE 'ALTERNATE' END
        FROM (
            SELECT e.id, ROW_NUMBER() OVER (ORDER BY CHECKSUM(NEWID())) AS pos
            FROM dbo.raffle_entries e
            WHERE e.raffle_id = @raffle_id AND e.status = 'VALID' AND e.id <= @maxId
        ) t
        WHERE t.pos <= (@cuantos + @alternates);

        COMMIT TRAN;
    END TRY
    BEGIN CATCH
        IF XACT_STATE() <> 0 ROLLBACK TRAN;
        DECLARE @msg NVARCHAR(400) = ERROR_MESSAGE();
        RAISERROR(@msg, 16, 1);
        RETURN;
    END CATCH

    /* El resultado, ya legible: numero de boleto y cliente si lo hubo. */
    SELECT w.id AS winner_id, w.position, w.status,
           e.entry_number,
           CONCAT(rf.code_prefix, '-', RIGHT(CONCAT('0000000', CAST(e.entry_number AS NVARCHAR(20))), 8)) AS boleto,
           e.customer_id, c.customerName AS cliente,
           e.sale_id, e.register_id,
           d.id AS draw_id, d.entries_count, d.drawn_at, d.seed
    FROM dbo.raffle_winners w
    JOIN dbo.raffle_draws d ON d.id = w.draw_id
    JOIN dbo.raffle_entries e ON e.id = w.entry_id
    JOIN dbo.raffle_definitions rf ON rf.id = d.raffle_id
    LEFT JOIN dbo.customers c ON c.id = e.customer_id
    WHERE w.draw_id = @draw_id
    ORDER BY w.position;
END
GO

/* ---------- sp_raffle_save (SQL_STORED_PROCEDURE) ---------- */
/* sp_raffle_save
 * Definicion canonica. Mantener este archivo y generar una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* ---- Crear o actualizar una rifa, y cambiar su estado.

   El estado NO se puede mover a cualquier sitio:

     DRAFT  -> OPEN     se abre y empieza a admitir participaciones
     OPEN   -> CLOSED   deja de admitir, todavia sin sortear
     CLOSED -> OPEN     reabrir es legitimo mientras no se haya sorteado
     *      -> DRAWN    SOLO lo hace `sp_raffle_draw`

   Volver a DRAFT o a OPEN despues de sortear cambiaria el universo de un
   sorteo ya hecho, que es exactamente lo que no puede pasar. */
CREATE OR ALTER PROCEDURE [dbo].[sp_raffle_save]
    @id INT = NULL,
    @name NVARCHAR(120),
    @description NVARCHAR(400) = NULL,
    @prize NVARCHAR(200) = NULL,
    @starts_at DATETIME2(0) = NULL,
    @ends_at DATETIME2(0) = NULL,
    @winners_count INT = 1,
    @code_prefix NVARCHAR(8) = NULL,
    @status NVARCHAR(10) = NULL
AS
BEGIN
    SET NOCOUNT ON;

    IF LTRIM(RTRIM(ISNULL(@name, N''))) = N''
    BEGIN RAISERROR('La rifa necesita un nombre.', 16, 1); RETURN; END
    IF ISNULL(@winners_count, 0) < 1 SET @winners_count = 1;
    IF LTRIM(RTRIM(ISNULL(@code_prefix, N''))) = N'' SET @code_prefix = N'RF';

    IF @id IS NULL
    BEGIN
        INSERT INTO dbo.raffle_definitions (name, description, prize, starts_at, ends_at, status, winners_count, code_prefix)
        VALUES (@name, @description, @prize, @starts_at, @ends_at, ISNULL(@status, N'DRAFT'), @winners_count, @code_prefix);
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

        UPDATE dbo.raffle_definitions
           SET name = @name, description = @description, prize = @prize,
               starts_at = @starts_at, ends_at = @ends_at,
               winners_count = @winners_count, code_prefix = @code_prefix,
               status = ISNULL(@status, status)
         WHERE id = @id;
    END

    SELECT id, name, status, winners_count, code_prefix FROM dbo.raffle_definitions WHERE id = @id;
END
GO

/* ---------- sp_raffle_winner_status (SQL_STORED_PROCEDURE) ---------- */
/* sp_raffle_winner_status
 * Definicion canonica. Mantener este archivo y generar una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* ---- Mover un ganador por sus estados: entregado, no reclamado, descalificado.

   NO SE BORRA HISTORIA. Un ganador descalificado se marca como tal y sigue en
   la tabla con su boleto y su sorteo: borrarlo dejaria un sorteo con un hueco
   que nadie podria explicar despues.

   Cuando un titular se cae, el suplente de la posicion siguiente pasa a
   WINNER. Es una decision explicita de quien administra -por eso se pide
   `@promover_suplente`- y no algo que ocurra solo: dar por bueno un suplente
   sin que nadie lo decida seria repartir un premio por defecto. */
CREATE OR ALTER PROCEDURE [dbo].[sp_raffle_winner_status]
    @winner_id INT,
    @status NVARCHAR(14),
    @user_id INT = NULL,
    @notes NVARCHAR(300) = NULL,
    @promover_suplente BIT = 0
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    IF @status NOT IN ('WINNER', 'ALTERNATE', 'UNCLAIMED', 'DISQUALIFIED', 'DELIVERED')
    BEGIN RAISERROR('Estado de ganador invalido.', 16, 1); RETURN; END

    DECLARE @draw INT, @pos INT;
    SELECT @draw = draw_id, @pos = position FROM dbo.raffle_winners WHERE id = @winner_id;
    IF @draw IS NULL
    BEGIN RAISERROR('Ese ganador no existe.', 16, 1); RETURN; END

    BEGIN TRY
        BEGIN TRAN;

        UPDATE dbo.raffle_winners
           SET status = @status,
               notes = ISNULL(@notes, notes),
               delivered_at = CASE WHEN @status = 'DELIVERED' THEN SYSUTCDATETIME() ELSE delivered_at END,
               delivered_by_user_id = CASE WHEN @status = 'DELIVERED' THEN @user_id ELSE delivered_by_user_id END
         WHERE id = @winner_id;

        IF @promover_suplente = 1 AND @status IN ('UNCLAIMED', 'DISQUALIFIED')
        BEGIN
            UPDATE dbo.raffle_winners
               SET status = 'WINNER'
             WHERE id = (SELECT TOP 1 id FROM dbo.raffle_winners
                          WHERE draw_id = @draw AND status = 'ALTERNATE' AND position > @pos
                          ORDER BY position);
        END

        COMMIT TRAN;
    END TRY
    BEGIN CATCH
        IF XACT_STATE() <> 0 ROLLBACK TRAN;
        DECLARE @msg NVARCHAR(400) = ERROR_MESSAGE();
        RAISERROR(@msg, 16, 1);
        RETURN;
    END CATCH

    SELECT w.id AS winner_id, w.position, w.status, w.delivered_at, e.entry_number
    FROM dbo.raffle_winners w
    JOIN dbo.raffle_entries e ON e.id = w.entry_id
    WHERE w.draw_id = @draw
    ORDER BY w.position;
END
GO
