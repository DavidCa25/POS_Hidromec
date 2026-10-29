/* ============================================================
   0068 — whatsapp avisos

   Generada con scripts/db/generar-migracion.mjs desde los archivos
   canonicos de sql/. No editar a mano: regenerar.

   Idempotente: todos los objetos usan CREATE OR ALTER, y los tipos
   comprueban su existencia antes de crearse. Se puede reejecutar.

   Incluye el bloque de esquema sql/schema/changes/0068_whatsapp-avisos.sql (tablas,
   columnas, seed). Cada paso de ese bloque comprueba su existencia.
   ============================================================ */

/* ========== ESQUEMA: sql/schema/changes/0068_whatsapp-avisos.sql ========== */
/* ============================================================
   0068 — Avisos por WhatsApp al cliente: pedido listo (esquema)

   whatsapp_pedido_avisos     Un renglón por pedido de mostrador cuyo aviso
                              «tu pedido está listo» se intentó. Es la
                              BANDERA: ENVIADO u OMITIDO no se vuelve a
                              intentar. `id` es la llave de idempotencia con
                              la nube (función whatsapp-avisos): reintentar
                              el mismo pedido nunca produce dos mensajes.

   El mensaje lo arma y lo manda la nube; los ajustes (encendido, apagado) y
   las bajas del cliente viven allá. Aquí solo el estado de cada pedido.
   El teléfono NO se copia: se lee de `customers` al momento de avisar.

   OMITIDO = la nube contestó que no va a salir (aviso apagado, el cliente se
   dio de baja, teléfono inválido): no es un error y no se reintenta.

   Aditiva: nada existente cambia de significado.
   ============================================================ */
IF OBJECT_ID(N'dbo.whatsapp_pedido_avisos', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.whatsapp_pedido_avisos (
        cuenta_id       INT              NOT NULL,
        id              UNIQUEIDENTIFIER NOT NULL CONSTRAINT DF_whatsapp_pedido_avisos_id DEFAULT (NEWID()),
        status          NVARCHAR(12)     COLLATE Modern_Spanish_CI_AS NOT NULL CONSTRAINT DF_whatsapp_pedido_avisos_status DEFAULT (N'ENVIANDO'),
        code            NVARCHAR(20)     COLLATE Modern_Spanish_CI_AS NULL,
        attempts        INT              NOT NULL CONSTRAINT DF_whatsapp_pedido_avisos_attempts DEFAULT (0),
        last_error      NVARCHAR(300)    COLLATE Modern_Spanish_CI_AS NULL,
        created_at      DATETIME2(0)     NOT NULL CONSTRAINT DF_whatsapp_pedido_avisos_created_at DEFAULT (SYSDATETIME()),
        last_attempt_at DATETIME2(0)     NULL,
        sent_at         DATETIME2(0)     NULL,
        CONSTRAINT PK_whatsapp_pedido_avisos PRIMARY KEY CLUSTERED (cuenta_id),
        CONSTRAINT UQ_whatsapp_pedido_avisos_id UNIQUE NONCLUSTERED (id),
        CONSTRAINT FK_whatsapp_pedido_avisos_cuenta FOREIGN KEY (cuenta_id) REFERENCES dbo.hosp_cuentas (id),
        CONSTRAINT CK_whatsapp_pedido_avisos_status CHECK (status IN (N'ENVIANDO', N'ENVIADO', N'OMITIDO', N'ERROR'))
    );
END;
GO

/* ---------- sp_whatsapp_pedido_candidatos (SQL_STORED_PROCEDURE) ---------- */
/* sp_whatsapp_pedido_candidatos
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* ============== sp_whatsapp_pedido_candidatos (0068) ==============
   Los pedidos de HOY que ya están listos y cuyo cliente dejó teléfono, a los
   que todavía hay que avisar. «Listo» es la MISMA regla que el seguimiento
   del teléfono (local-host/seguimiento.js): ninguna comanda pendiente y al
   menos una LISTA.

   Solo pedidos con número del día (mostrador); una mesa no se avisa. Solo
   si quedó listo hace menos de 20 minutos: un aviso tardío confunde más que
   ayuda (la caja estuvo apagada o sin internet).

   Entra:   sin renglón (nunca se intentó), ERROR con menos de 5 intentos y
            espera creciente (30 s por intento), o ENVIANDO abandonado
            (más de 2 minutos: el proceso murió a medio envío).
   No entra: ENVIADO u OMITIDO.

   PUNTO DE EXTENSIÓN: un pedido en línea (menú QR, 0067) que viva en
   hosp_cuentas con número del día y cliente entra aquí sin cambios. Si vive
   en otra tabla, se agrega su fuente con UNION ALL devolviendo las mismas
   columnas, y su propia bandera.
   ================================================================ */
CREATE OR ALTER PROCEDURE dbo.sp_whatsapp_pedido_candidatos
    @top INT = 20
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @ahora DATETIME2(0) = SYSDATETIME();

    SELECT TOP (@top)
           c.id AS cuenta_id, c.numero_dia, cu.phone AS telefono,
           a.id AS aviso_id, a.status, a.attempts, k.lista_en
      FROM dbo.hosp_cuentas c
      JOIN dbo.customers cu ON cu.id = c.customer_id
      CROSS APPLY (SELECT SUM(CASE WHEN x.estado IN ('NUEVA', 'PREPARANDO') THEN 1 ELSE 0 END) AS pendientes,
                          SUM(CASE WHEN x.estado = 'LISTA' THEN 1 ELSE 0 END) AS listas,
                          MAX(x.lista_en) AS lista_en
                     FROM dbo.comandas x
                    WHERE x.cuenta_id = c.id AND x.estado <> 'CANCELADA') k
      LEFT JOIN dbo.whatsapp_pedido_avisos a ON a.cuenta_id = c.id
     WHERE c.abierta_dia = CAST(@ahora AS DATE)
       AND c.numero_dia IS NOT NULL
       AND c.estado <> 'CANCELADA'
       AND LEN(LTRIM(RTRIM(ISNULL(cu.phone, N'')))) >= 10
       AND k.pendientes = 0 AND k.listas > 0
       AND k.lista_en > DATEADD(MINUTE, -20, @ahora)
       AND (a.cuenta_id IS NULL
            OR (a.status = N'ERROR' AND a.attempts < 5
                AND a.last_attempt_at < DATEADD(SECOND, -30 * a.attempts, @ahora))
            OR (a.status = N'ENVIANDO' AND a.last_attempt_at < DATEADD(MINUTE, -2, @ahora)))
     ORDER BY k.lista_en;
END;
GO

/* ---------- sp_whatsapp_pedido_job (SQL_STORED_PROCEDURE) ---------- */
/* sp_whatsapp_pedido_job
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* ================= sp_whatsapp_pedido_job (0068) =================
   El estado del aviso «pedido listo» de UNA cuenta. Es la bandera que
   impide mandarlo dos veces (igual que sp_cash_closure_email_job).

     @accion = 'RESERVAR'  Antes de llamar a la nube. `resultado`:
                 RESERVADO   adelante: el renglón queda ENVIANDO.
                 YA          ENVIADO u OMITIDO: no se intenta otra vez.
                 OCUPADO     otro envío del mismo pedido en curso (< 2 min).
     @accion = 'ENVIADO'   La nube lo aceptó (lo encoló o ya lo tenía).
     @accion = 'OMITIDO'   La nube dijo que no sale (@code: DESACTIVADO,
                           OPT_OUT, TEL_INVALIDO). No se reintenta.
     @accion = 'ERROR'     No hubo respuesta clara. Se reintenta.
   ================================================================ */
CREATE OR ALTER PROCEDURE dbo.sp_whatsapp_pedido_job
    @cuenta_id INT,
    @accion    VARCHAR(10),
    @code      NVARCHAR(20) = NULL,
    @error     NVARCHAR(300) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    IF @accion NOT IN ('RESERVAR', 'ENVIADO', 'OMITIDO', 'ERROR')
        THROW 51000, 'Accion de aviso no valida.', 1;
    IF NOT EXISTS (SELECT 1 FROM dbo.hosp_cuentas WHERE id = @cuenta_id)
        THROW 51000, 'Esa cuenta no existe.', 1;

    DECLARE @resultado VARCHAR(10) = @accion;
    DECLARE @status NVARCHAR(12), @ultimo DATETIME2(0);

    BEGIN TRAN;
    IF @accion = 'RESERVAR'
    BEGIN
        SELECT @status = status, @ultimo = last_attempt_at
          FROM dbo.whatsapp_pedido_avisos WITH (UPDLOCK, HOLDLOCK) WHERE cuenta_id = @cuenta_id;

        IF @status IS NULL
        BEGIN
            INSERT dbo.whatsapp_pedido_avisos (cuenta_id, status, attempts, last_attempt_at)
            VALUES (@cuenta_id, N'ENVIANDO', 1, SYSDATETIME());
            SET @resultado = 'RESERVADO';
        END
        ELSE IF @status IN (N'ENVIADO', N'OMITIDO')
            SET @resultado = 'YA';
        ELSE IF @status = N'ENVIANDO' AND @ultimo > DATEADD(MINUTE, -2, SYSDATETIME())
            SET @resultado = 'OCUPADO';
        ELSE
        BEGIN
            UPDATE dbo.whatsapp_pedido_avisos
               SET status = N'ENVIANDO', attempts = attempts + 1, last_attempt_at = SYSDATETIME()
             WHERE cuenta_id = @cuenta_id;
            SET @resultado = 'RESERVADO';
        END
    END
    ELSE IF @accion = 'ENVIADO'
        UPDATE dbo.whatsapp_pedido_avisos
           SET status = N'ENVIADO', code = LEFT(@code, 20), sent_at = SYSDATETIME(), last_error = NULL
         WHERE cuenta_id = @cuenta_id;
    ELSE IF @accion = 'OMITIDO'
        UPDATE dbo.whatsapp_pedido_avisos
           SET status = N'OMITIDO', code = LEFT(@code, 20), last_error = LEFT(@error, 300)
         WHERE cuenta_id = @cuenta_id AND status <> N'ENVIADO';
    ELSE
        UPDATE dbo.whatsapp_pedido_avisos
           SET status = N'ERROR', code = LEFT(@code, 20), last_error = LEFT(@error, 300)
         WHERE cuenta_id = @cuenta_id AND status NOT IN (N'ENVIADO', N'OMITIDO');
    COMMIT TRAN;

    SELECT a.cuenta_id, a.id, a.status, a.code, a.attempts, a.last_error, a.sent_at, @resultado AS resultado
      FROM dbo.whatsapp_pedido_avisos a WHERE a.cuenta_id = @cuenta_id;
END;
GO
