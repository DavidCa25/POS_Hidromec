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
