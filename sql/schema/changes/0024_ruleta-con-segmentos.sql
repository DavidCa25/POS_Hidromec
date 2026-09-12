/* ============================================================
   0024 — la ruleta, y lo que hace falta para que el dominio sea extensible

   Hasta ahora la unica dinamica funcional de punta a punta era el
   cronometro. "Motor de dinamicas" con un solo juego dentro no es un motor:
   es un cronometro con nombre largo.

   La ruleta obliga a modelar lo que al cronometro no le hacia falta: un juego
   con VARIOS resultados posibles, cada uno con su premio y su probabilidad.
   Eso es justo lo que convierte esto en extensible, porque PICK_ONE,
   RANDOM_REVEAL y SCRATCH son la misma pregunta -"¿cual de estos resultados
   sale?"- con otra animacion encima.

   POR QUE UNA TABLA Y NO UN JSON
   ------------------------------
   Un segmento apunta a una recompensa o a una rifa. Con JSON en una columna,
   borrar una recompensa dejaria segmentos apuntando al vacio y nadie se
   enteraria hasta que alguien girara la ruleta. Con filas y claves ajenas, la
   base lo impide.
   ============================================================ */

IF OBJECT_ID(N'dbo.dynamic_segments', 'U') IS NULL
BEGIN
CREATE TABLE dbo.dynamic_segments (
    id INT IDENTITY(1, 1) NOT NULL,
    definition_id INT NOT NULL,
    /* El orden en que se pintan. La rueda se dibuja con esto, asi que mover
       un segmento cambia donde aparece. */
    sort_order INT NOT NULL CONSTRAINT DF_dynamic_segments_orden DEFAULT ((0)),
    label NVARCHAR(60) COLLATE Modern_Spanish_CI_AS NOT NULL,
    /* Que pasa si sale: nada, una recompensa, o boletos de rifa. */
    outcome NVARCHAR(16) COLLATE Modern_Spanish_CI_AS NOT NULL CONSTRAINT DF_dynamic_segments_outcome DEFAULT ('NONE'),
    reward_definition_id INT NULL,
    raffle_id INT NULL,
    quantity INT NOT NULL CONSTRAINT DF_dynamic_segments_cantidad DEFAULT ((1)),
    /* Peso, no porcentaje.
       Con pesos, anadir un segmento no obliga a recalcular los demas para que
       vuelvan a sumar 100. El servidor normaliza al sortear. */
    weight INT NOT NULL CONSTRAINT DF_dynamic_segments_peso DEFAULT ((1)),
    active BIT NOT NULL CONSTRAINT DF_dynamic_segments_active DEFAULT ((1)),
    created_at DATETIME2(0) NOT NULL CONSTRAINT DF_dynamic_segments_created_at DEFAULT (sysutcdatetime()),
    CONSTRAINT PK_dynamic_segments PRIMARY KEY CLUSTERED (id)
);
END;

IF OBJECT_ID(N'dbo.CK_dynamic_segments_outcome', 'C') IS NULL
ALTER TABLE dbo.dynamic_segments WITH CHECK ADD CONSTRAINT CK_dynamic_segments_outcome
    CHECK ([outcome] = 'NONE' OR [outcome] = 'REWARD' OR [outcome] = 'RAFFLE_ENTRY');

/* Un peso negativo dejaria el sorteo sin sentido; uno de cero es legitimo
   -un segmento que se pinta pero nunca sale-. */
IF OBJECT_ID(N'dbo.CK_dynamic_segments_peso', 'C') IS NULL
ALTER TABLE dbo.dynamic_segments WITH CHECK ADD CONSTRAINT CK_dynamic_segments_peso
    CHECK ([weight] >= 0 AND [quantity] >= 1);

IF OBJECT_ID(N'dbo.FK_dynamic_segments_definition', 'F') IS NULL
ALTER TABLE dbo.dynamic_segments WITH CHECK ADD CONSTRAINT FK_dynamic_segments_definition
    FOREIGN KEY (definition_id) REFERENCES dbo.dynamic_definitions (id);

IF OBJECT_ID(N'dbo.FK_dynamic_segments_reward', 'F') IS NULL
ALTER TABLE dbo.dynamic_segments WITH CHECK ADD CONSTRAINT FK_dynamic_segments_reward
    FOREIGN KEY (reward_definition_id) REFERENCES dbo.reward_definitions (id);

IF OBJECT_ID(N'dbo.FK_dynamic_segments_raffle', 'F') IS NULL
ALTER TABLE dbo.dynamic_segments WITH CHECK ADD CONSTRAINT FK_dynamic_segments_raffle
    FOREIGN KEY (raffle_id) REFERENCES dbo.raffle_definitions (id);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_dynamic_segments_definition')
CREATE NONCLUSTERED INDEX IX_dynamic_segments_definition
    ON dbo.dynamic_segments (definition_id, sort_order);

/* Que segmento salio. Sin esto, un intento de ruleta guardaria "gano" sin
   decir QUE gano, y reclamar un premio seria imposible de comprobar. */
IF COL_LENGTH('dbo.dynamic_attempts', 'segment_id') IS NULL
ALTER TABLE dbo.dynamic_attempts ADD segment_id INT NULL;
