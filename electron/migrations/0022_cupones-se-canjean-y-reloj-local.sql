/* ============================================================
   0022 — cupones se canjean y reloj local

   Generada con scripts/db/generar-migracion.mjs desde los archivos
   canonicos de sql/. No editar a mano: regenerar.

   Idempotente: todos los objetos usan CREATE OR ALTER, y los tipos
   comprueban su existencia antes de crearse. Se puede reejecutar.

   NO toca tablas ni datos. Solo objetos programables.
   ============================================================ */

/* ---------- sp_coupon_redeem (SQL_STORED_PROCEDURE) ---------- */
/* sp_coupon_redeem
 * Definicion canonica. Mantener este archivo y generar una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* ============================================================
   sp_coupon_redeem — consumir un cupon, ligado a la venta que lo uso.

   CUANDO
   ------
   DESPUES de que la venta esta cobrada. La redencion apunta a `sale_id`, y
   ese id no existe hasta que `sp_register_sale` confirmo. Un cupon consumido
   por una venta que acabo en ROLLBACK seria un cupon perdido sin que nadie
   comprara nada.

   UN SOLO USO, AUNQUE DOS CAJAS LO INTENTEN A LA VEZ
   --------------------------------------------------
   Esto NO se resuelve escondiendo el boton. Dos cajas pueden tener el mismo
   papel delante -o el mismo codigo dictado por telefono- y pulsar cobrar en
   el mismo segundo.

   La garantia es el UPDATE condicional de abajo: las condiciones viven en el
   WHERE, no en un IF previo. SQL Server evalua ese WHERE con la fila
   bloqueada, asi que de dos intentos simultaneos exactamente uno encuentra
   fila que actualizar y el otro recibe @@ROWCOUNT = 0. Un `IF EXISTS`
   seguido de un UPDATE dejaria pasar a los dos: entre leer y escribir cabe
   la otra sesion entera.

   BENEFICIOS SOPORTADOS EN V1
   ---------------------------
   FREE_PRODUCT   se aplica poniendo a cero el precio de esa linea en la
                  venta. Encaja con el contrato actual: la linea sigue
                  descontando inventario, el ticket dice "0.00" -que es la
                  verdad- y el total cuadra solo.

   AMOUNT         NO se aplican todavia. `sales` no tiene concepto de
   PERCENT        descuento: `sp_register_sale` calcula el total como
                  SUM(quantity * unit_price) y no hay donde poner una rebaja
                  que no pertenezca a una linea.

                  Repartirla entre las lineas seria mentir sobre el precio de
                  cada producto: el ticket diria que el cafe costo 43.27, la
                  factura llevaria ese precio al SAT y los informes de margen
                  calcularian sobre un precio que nadie cobro.

                  Hacerlo bien pide que la venta CONOZCA el descuento -tabla,
                  procedure, ticket, facturacion e informes-, y eso es
                  rearquitectura del precio, no un anadido. Queda pendiente y
                  documentado; mientras tanto estos cupones se emiten y se
                  validan, pero la caja avisa de que no puede aplicarlos.
   ============================================================ */
CREATE OR ALTER PROCEDURE [dbo].[sp_coupon_redeem]
    @code NVARCHAR(24),
    @sale_id INT,
    @register_id INT = NULL,
    @machine_id NVARCHAR(64) = NULL,
    @amount_applied DECIMAL(12,2) = 0
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    DECLARE @ahora DATETIME2(0) = SYSDATETIME();   /* hora local: misma politica que sp_loyalty_evaluate_sale */
    SET @code = LTRIM(RTRIM(ISNULL(@code, N'')));

    IF NOT EXISTS (SELECT 1 FROM dbo.sales WHERE id = @sale_id)
    BEGIN
        SELECT CAST(0 AS BIT) AS ok, 'SIN_VENTA' AS motivo,
               N'No se puede canjear un cupón sin una venta confirmada.' AS mensaje,
               CAST(NULL AS INT) AS redemption_id, CAST(NULL AS INT) AS instance_id,
               CAST(NULL AS INT) AS uses_count, CAST(NULL AS INT) AS uses_allowed,
               CAST(NULL AS NVARCHAR(12)) AS estado;
        RETURN;
    END

    DECLARE @id INT, @redemption_id INT, @usados INT, @permitidos INT, @estado NVARCHAR(12);

    BEGIN TRY
        BEGIN TRAN;

        /* Idempotencia: si esta venta YA canjeo este cupon, no se cobra otro
           uso. Un reintento del IPC no puede gastar dos veces el mismo papel. */
        SELECT @redemption_id = lr.id, @id = lr.coupon_instance_id
        FROM dbo.loyalty_redemptions lr
        JOIN dbo.coupon_instances ci ON ci.id = lr.coupon_instance_id
        WHERE lr.sale_id = @sale_id AND ci.code = @code AND lr.kind = 'COUPON';

        IF @redemption_id IS NOT NULL
        BEGIN
            SELECT @usados = uses_count, @permitidos = uses_allowed, @estado = status
            FROM dbo.coupon_instances WHERE id = @id;
            COMMIT TRAN;

            SELECT CAST(1 AS BIT) AS ok, 'YA_REGISTRADO' AS motivo,
                   N'Este cupón ya estaba canjeado en esta venta.' AS mensaje,
                   @redemption_id AS redemption_id, @id AS instance_id,
                   @usados AS uses_count, @permitidos AS uses_allowed, @estado AS estado;
            RETURN;
        END

        /* ----------------------------------------------------------------
           EL consumo. Todas las condiciones en el WHERE, a proposito.
           ---------------------------------------------------------------- */
        UPDATE ci
           SET uses_count = ci.uses_count + 1,
               status = CASE WHEN ci.uses_count + 1 >= ci.uses_allowed
                             THEN 'REDEEMED' ELSE ci.status END,
               sale_id = ISNULL(ci.sale_id, @sale_id)
          FROM dbo.coupon_instances ci
          JOIN dbo.coupon_definitions cd ON cd.id = ci.definition_id
         WHERE ci.code = @code
           AND ci.status = 'ISSUED'
           AND cd.active = 1
           AND ci.uses_count < ci.uses_allowed
           AND (ci.expires_at IS NULL OR ci.expires_at >= @ahora);

        IF @@ROWCOUNT = 0
        BEGIN
            ROLLBACK TRAN;

            /* Se explica POR QUE no se pudo, releyendo el estado ya estable.
               "No se pudo" a secas dejaria al cajero sin nada que decirle al
               cliente que tiene el papel en la mano. */
            DECLARE @motivo NVARCHAR(20), @msg NVARCHAR(200);
            SELECT @motivo = CASE
                       WHEN ci.id IS NULL THEN 'NO_EXISTE'
                       WHEN ci.status = 'VOID' THEN 'ANULADO'
                       WHEN cd.active = 0 THEN 'INACTIVO'
                       WHEN ci.expires_at IS NOT NULL AND ci.expires_at < @ahora THEN 'EXPIRADO'
                       ELSE 'AGOTADO' END
            FROM dbo.coupon_instances ci
            JOIN dbo.coupon_definitions cd ON cd.id = ci.definition_id
            WHERE ci.code = @code;

            IF @motivo IS NULL SET @motivo = 'NO_EXISTE';
            SET @msg = CASE @motivo
                WHEN 'NO_EXISTE' THEN N'Ese código no existe.'
                WHEN 'EXPIRADO'  THEN N'Este cupón ya venció.'
                WHEN 'ANULADO'   THEN N'Este cupón fue anulado.'
                WHEN 'INACTIVO'  THEN N'Esta promoción ya no está disponible.'
                ELSE N'Este cupón ya se usó.' END;

            SELECT CAST(0 AS BIT) AS ok, @motivo AS motivo, @msg AS mensaje,
                   CAST(NULL AS INT) AS redemption_id, CAST(NULL AS INT) AS instance_id,
                   CAST(NULL AS INT) AS uses_count, CAST(NULL AS INT) AS uses_allowed,
                   CAST(NULL AS NVARCHAR(12)) AS estado;
            RETURN;
        END

        SELECT @id = id, @usados = uses_count, @permitidos = uses_allowed, @estado = status
        FROM dbo.coupon_instances WHERE code = @code;

        INSERT INTO dbo.loyalty_redemptions
            (kind, reward_instance_id, coupon_instance_id, sale_id, register_id,
             machine_id, amount_applied, created_at)
        VALUES
            ('COUPON', NULL, @id, @sale_id, @register_id,
             @machine_id, ISNULL(@amount_applied, 0), @ahora);

        SET @redemption_id = SCOPE_IDENTITY();

        COMMIT TRAN;
    END TRY
    BEGIN CATCH
        IF XACT_STATE() <> 0 ROLLBACK TRAN;
        DECLARE @err NVARCHAR(400) = ERROR_MESSAGE();
        RAISERROR(@err, 16, 1);
        RETURN;
    END CATCH

    SELECT CAST(1 AS BIT) AS ok, 'OK' AS motivo,
           N'Cupón canjeado.' AS mensaje,
           @redemption_id AS redemption_id, @id AS instance_id,
           @usados AS uses_count, @permitidos AS uses_allowed, @estado AS estado;
END
GO

/* ---------- sp_coupon_validate (SQL_STORED_PROCEDURE) ---------- */
/* sp_coupon_validate
 * Definicion canonica. Mantener este archivo y generar una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* ============================================================
   sp_coupon_validate — ¿este codigo sirve, y para que?

   Lo llama la caja cuando alguien teclea o escanea un cupon, ANTES de cobrar.
   No consume nada: solo mira. Consumir es `sp_coupon_redeem`, y ocurre cuando
   la venta ya esta cobrada.

   Devuelve SIEMPRE una fila, con `ok` y un `motivo` legible. Un cupon que no
   sirve no es un error del sistema -es el caso normal de un papel caducado- y
   tratarlo como excepcion obligaria a la pantalla a leer mensajes de SQL para
   decidir que ensenar.

   MOTIVOS
   -------
   NO_EXISTE      el codigo no corresponde a ningun cupon
   EXPIRADO       paso su vigencia
   AGOTADO        ya se uso todas las veces que permitia
   ANULADO        alguien lo invalido
   INACTIVO       la definicion se apago despues de emitirlo
   OK             sirve

   APLICABLE
   ---------
   `aplicable` es distinto de `ok`. Un cupon puede ser perfectamente valido y
   aun asi no poder aplicarse en el punto de venta, porque el tipo de
   beneficio no esta soportado todavia. Ver la nota de sp_coupon_redeem.
   ============================================================ */
CREATE OR ALTER PROCEDURE [dbo].[sp_coupon_validate]
    @code NVARCHAR(24)
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @ahora DATETIME2(0) = SYSDATETIME();   /* hora local: misma politica que sp_loyalty_evaluate_sale */

    SET @code = LTRIM(RTRIM(ISNULL(@code, N'')));

    DECLARE @id INT, @estado NVARCHAR(12), @expira DATETIME2(0),
            @permitidos INT, @usados INT, @activa BIT, @kind NVARCHAR(20);

    SELECT @id = ci.id, @estado = ci.status, @expira = ci.expires_at,
           @permitidos = ci.uses_allowed, @usados = ci.uses_count,
           @activa = cd.active, @kind = cd.kind
    FROM dbo.coupon_instances ci
    JOIN dbo.coupon_definitions cd ON cd.id = ci.definition_id
    WHERE ci.code = @code;

    DECLARE @motivo NVARCHAR(20) =
        CASE
            WHEN @id IS NULL THEN 'NO_EXISTE'
            WHEN @estado = 'VOID' THEN 'ANULADO'
            WHEN @activa = 0 THEN 'INACTIVO'
            WHEN @expira IS NOT NULL AND @expira < @ahora THEN 'EXPIRADO'
            WHEN @usados >= @permitidos OR @estado = 'REDEEMED' THEN 'AGOTADO'
            ELSE 'OK'
        END;

    /* Solo el producto gratis se puede aplicar hoy: ver sp_coupon_redeem. */
    DECLARE @aplicable BIT = CASE WHEN @motivo = 'OK' AND @kind = 'FREE_PRODUCT' THEN 1 ELSE 0 END;

    SELECT
        CAST(CASE WHEN @motivo = 'OK' THEN 1 ELSE 0 END AS BIT) AS ok,
        @motivo AS motivo,
        @aplicable AS aplicable,
        ci.id AS instance_id,
        ci.code,
        ci.definition_id,
        cd.name AS nombre,
        cd.kind,
        cd.amount,
        cd.discount_pct,
        cd.product_id,
        p.nombre AS product_name,
        ci.expires_at,
        ci.uses_allowed,
        ci.uses_count,
        ci.customer_id,
        c.customerName AS cliente,
        CASE @motivo
            WHEN 'NO_EXISTE' THEN N'Ese código no existe.'
            WHEN 'EXPIRADO'  THEN N'Este cupón ya venció.'
            WHEN 'AGOTADO'   THEN N'Este cupón ya se usó.'
            WHEN 'ANULADO'   THEN N'Este cupón fue anulado.'
            WHEN 'INACTIVO'  THEN N'Esta promoción ya no está disponible.'
            ELSE CASE WHEN @aplicable = 1
                      THEN CONCAT(N'Cupón válido: ', cd.name)
                      ELSE N'Cupón válido, pero este tipo de descuento todavía no se puede aplicar en caja.'
                 END
        END AS mensaje
    FROM dbo.coupon_instances ci
    JOIN dbo.coupon_definitions cd ON cd.id = ci.definition_id
    LEFT JOIN dbo.products p ON p.id = cd.product_id
    LEFT JOIN dbo.customers c ON c.id = ci.customer_id
    WHERE ci.id = @id

    UNION ALL

    /* El codigo inexistente tambien tiene que devolver fila: la pantalla
       espera siempre una respuesta con su motivo, no una lista vacia que
       tendria que interpretar. */
    SELECT CAST(0 AS BIT), 'NO_EXISTE', CAST(0 AS BIT), NULL, @code, NULL, NULL, NULL,
           NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL,
           N'Ese código no existe.'
    WHERE @id IS NULL;
END
GO

/* ---------- sp_dynamic_pending (SQL_STORED_PROCEDURE) ---------- */
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

/* ---------- sp_loyalty_catalog (SQL_STORED_PROCEDURE) ---------- */
/* sp_loyalty_catalog
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* ============================================================
   sp_loyalty_catalog — todo Fidelizacion en UNA consulta.

   La pantalla de administracion necesita campanas, recompensas, cupones,
   dinamicas, rifas y los numeros del panel a la vez. Pedirlos uno a uno
   serian seis viajes para pintar una sola pantalla, y con la base en otra
   maquina de la LAN eso se nota.

   Mismo criterio que `sp_get_menu_catalog`, que ya resolvia esto para Touch.

   Devuelve SIETE resultsets, en este orden:
     1 campanas            5 rifas (con su conteo de participaciones)
     2 recompensas         6 resumen para el panel
     3 cupones             7 productos elegibles (para las condiciones)
     4 dinamicas
   ============================================================ */
CREATE OR ALTER PROCEDURE [dbo].[sp_loyalty_catalog]
AS
BEGIN
    SET NOCOUNT ON;

    SELECT c.id, c.name, c.description, c.outcome,
           c.reward_definition_id, c.coupon_definition_id, c.dynamic_definition_id, c.raffle_id,
           c.quantity, c.per_amount,
           c.min_total, c.product_id, c.requires_customer, c.first_purchase_only,
           c.weekday_mask, c.time_from, c.time_to, c.starts_at, c.ends_at,
           c.priority, c.active, c.created_at,
           p.nombre AS product_name,
           /* Que otorga, ya resuelto: la pantalla no tiene que cruzar cuatro
              catalogos para escribir una linea de resumen. */
           COALESCE(rd.name, cd.name, dd.name, rf.name) AS outcome_name
    FROM dbo.campaigns c
    LEFT JOIN dbo.products p ON p.id = c.product_id
    LEFT JOIN dbo.reward_definitions rd ON rd.id = c.reward_definition_id
    LEFT JOIN dbo.coupon_definitions cd ON cd.id = c.coupon_definition_id
    LEFT JOIN dbo.dynamic_definitions dd ON dd.id = c.dynamic_definition_id
    LEFT JOIN dbo.raffle_definitions rf ON rf.id = c.raffle_id
    ORDER BY c.active DESC, c.priority, c.id;

    SELECT r.id, r.name, r.kind, r.product_id, r.amount, r.discount_pct, r.notes,
           r.valid_days, r.uses_allowed, r.active, r.created_at,
           p.nombre AS product_name,
           (SELECT COUNT(*) FROM dbo.reward_instances i WHERE i.definition_id = r.id) AS emitidas
    FROM dbo.reward_definitions r
    LEFT JOIN dbo.products p ON p.id = r.product_id
    ORDER BY r.active DESC, r.name;

    SELECT c.id, c.name, c.kind, c.amount, c.discount_pct, c.product_id,
           c.valid_days, c.uses_allowed, c.code_prefix, c.active, c.created_at,
           p.nombre AS product_name,
           (SELECT COUNT(*) FROM dbo.coupon_instances i WHERE i.definition_id = c.id) AS emitidos
    FROM dbo.coupon_definitions c
    LEFT JOIN dbo.products p ON p.id = c.product_id
    ORDER BY c.active DESC, c.name;

    SELECT d.id, d.name, d.type, d.description, d.target_value, d.tolerance,
           d.attempts_allowed, d.reward_definition_id, d.active, d.created_at,
           rd.name AS reward_name,
           (SELECT COUNT(*) FROM dbo.dynamic_attempts a WHERE a.definition_id = d.id) AS intentos,
           (SELECT COUNT(*) FROM dbo.dynamic_attempts a WHERE a.definition_id = d.id AND a.result = 'WIN') AS ganados
    FROM dbo.dynamic_definitions d
    LEFT JOIN dbo.reward_definitions rd ON rd.id = d.reward_definition_id
    ORDER BY d.active DESC, d.name;

    SELECT r.id, r.name, r.description, r.prize, r.starts_at, r.ends_at,
           r.status, r.winners_count, r.code_prefix, r.created_at,
           r.closed_at, r.closed_entries_count,
           (SELECT COUNT(*) FROM dbo.raffle_entries e WHERE e.raffle_id = r.id AND e.status = 'VALID') AS participaciones,
           (SELECT COUNT(*) FROM dbo.raffle_draws d WHERE d.raffle_id = r.id) AS sorteos
    FROM dbo.raffle_definitions r
    ORDER BY CASE r.status WHEN 'OPEN' THEN 0 WHEN 'DRAFT' THEN 1 WHEN 'CLOSED' THEN 2 ELSE 3 END, r.id DESC;

    /* El panel. Numeros que se entienden de un vistazo, no un informe. */
    SELECT
        (SELECT COUNT(*) FROM dbo.campaigns WHERE active = 1) AS campanas_activas,
        (SELECT COUNT(*) FROM dbo.reward_instances WHERE status = 'ISSUED') AS recompensas_vigentes,
        (SELECT COUNT(*) FROM dbo.coupon_instances WHERE status = 'ISSUED') AS cupones_vigentes,
        (SELECT COUNT(*) FROM dbo.raffle_entries WHERE status = 'VALID') AS participaciones,
        (SELECT COUNT(*) FROM dbo.raffle_definitions WHERE status = 'OPEN') AS rifas_abiertas,
        (SELECT COUNT(*) FROM dbo.dynamic_attempts WHERE status = 'PENDING') AS dinamicas_pendientes,
        (SELECT COUNT(*) FROM dbo.loyalty_redemptions) AS redenciones,
        (SELECT ISNULL(loyalty_enabled, 0) FROM dbo.business_config WHERE id = (SELECT MIN(id) FROM dbo.business_config)) AS habilitado;

    /* Los productos vendibles, para condicionar una campana a uno concreto. */
    SELECT TOP 300 id, nombre AS name, price
    FROM dbo.products
    WHERE active = 1 AND sellable = 1
    ORDER BY nombre;
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
        DECLARE @i INT = 0;
        WHILE @i < @unidades
        BEGIN
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

/* ---------- sp_loyalty_instances (SQL_STORED_PROCEDURE) ---------- */
/* sp_loyalty_instances
 * Definicion canonica. Mantener este archivo y generar una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* ============================================================
   sp_loyalty_instances — lo que Fidelizacion ha REPARTIDO de verdad.

   El catalogo (`sp_loyalty_catalog`) responde "que promociones tengo
   definidas". Esto responde la otra pregunta, que es la que aparece cuando un
   cliente llega con un codigo en la mano: "¿que se ha entregado, a quien, y
   sigue valiendo?".

   Hasta ahora esa respuesta solo existia en SQL. Un negocio no puede depender
   de que alguien abra SSMS para saber si una recompensa ya se uso.

   VIGENCIA CALCULADA AQUI
   -----------------------
   `vigente` no se guarda: se deriva del estado, los usos y la fecha, con el
   reloj del SERVIDOR. Si lo decidiera la pantalla, dos cajas con la hora
   desajustada mostrarian cosas distintas del mismo cupon.
   ============================================================ */
CREATE OR ALTER PROCEDURE [dbo].[sp_loyalty_instances]
    @kind_of NVARCHAR(10),              -- REWARD | COUPON
    @estado NVARCHAR(12) = NULL,        -- ISSUED | REDEEMED | VOID | EXPIRED (derivado) | NULL = todas
    @search NVARCHAR(120) = NULL,       -- codigo, cliente o nombre de la promocion
    @top INT = 300
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @ahora DATETIME2(0) = SYSDATETIME();   /* hora local: misma politica que sp_loyalty_evaluate_sale */
    IF ISNULL(@top, 0) < 1 SET @top = 300;
    SET @search = NULLIF(LTRIM(RTRIM(ISNULL(@search, N''))), N'');
    SET @kind_of = UPPER(LTRIM(RTRIM(ISNULL(@kind_of, N'REWARD'))));

    IF @kind_of = 'REWARD'
    BEGIN
        SELECT TOP (@top)
            ri.id,
            ri.code,
            rd.id AS definition_id,
            rd.name AS promocion,
            rd.kind,
            rd.amount,
            rd.discount_pct,
            p.nombre AS product_name,
            ri.customer_id,
            c.customerName AS cliente,
            ri.campaign_id,
            cp.name AS campana,
            ri.sale_id,
            ri.register_id,
            rg.name AS caja,
            ri.machine_id,
            ri.issued_at,
            ri.expires_at,
            ri.status,
            ri.uses_count,
            ri.uses_allowed,
            /* Caducado es un estado REAL aunque la fila siga diciendo ISSUED:
               nadie recorre la tabla a medianoche para marcarlas. */
            CAST(CASE WHEN ri.status = 'ISSUED'
                       AND ri.uses_count < ri.uses_allowed
                       AND (ri.expires_at IS NULL OR ri.expires_at >= @ahora)
                      THEN 1 ELSE 0 END AS BIT) AS vigente,
            CASE WHEN ri.status = 'VOID' THEN 'ANULADO'
                 WHEN ri.status = 'REDEEMED' OR ri.uses_count >= ri.uses_allowed THEN 'USADO'
                 WHEN ri.expires_at IS NOT NULL AND ri.expires_at < @ahora THEN 'VENCIDO'
                 ELSE 'VIGENTE' END AS situacion,
            (SELECT MAX(lr.created_at) FROM dbo.loyalty_redemptions lr
              WHERE lr.reward_instance_id = ri.id) AS ultima_redencion,
            (SELECT MAX(lr.sale_id) FROM dbo.loyalty_redemptions lr
              WHERE lr.reward_instance_id = ri.id) AS venta_redencion
        FROM dbo.reward_instances ri
        JOIN dbo.reward_definitions rd ON rd.id = ri.definition_id
        LEFT JOIN dbo.products p ON p.id = rd.product_id
        LEFT JOIN dbo.customers c ON c.id = ri.customer_id
        LEFT JOIN dbo.campaigns cp ON cp.id = ri.campaign_id
        LEFT JOIN dbo.registers rg ON rg.id = ri.register_id
        WHERE (@search IS NULL
               OR ri.code LIKE '%' + @search + '%'
               OR rd.name LIKE '%' + @search + '%'
               OR c.customerName LIKE '%' + @search + '%')
          AND (@estado IS NULL
               OR (@estado = 'EXPIRED' AND ri.expires_at IS NOT NULL AND ri.expires_at < @ahora
                   AND ri.status = 'ISSUED')
               OR (@estado <> 'EXPIRED' AND ri.status = @estado))
        ORDER BY ri.id DESC;
        RETURN;
    END

    IF @kind_of = 'COUPON'
    BEGIN
        SELECT TOP (@top)
            ci.id,
            ci.code,
            cd.id AS definition_id,
            cd.name AS promocion,
            cd.kind,
            cd.amount,
            cd.discount_pct,
            p.nombre AS product_name,
            ci.customer_id,
            c.customerName AS cliente,
            ci.campaign_id,
            cp.name AS campana,
            ci.sale_id,
            ci.register_id,
            rg.name AS caja,
            ci.machine_id,
            ci.issued_at,
            ci.expires_at,
            ci.status,
            ci.uses_count,
            ci.uses_allowed,
            CAST(CASE WHEN ci.status = 'ISSUED'
                       AND ci.uses_count < ci.uses_allowed
                       AND (ci.expires_at IS NULL OR ci.expires_at >= @ahora)
                      THEN 1 ELSE 0 END AS BIT) AS vigente,
            CASE WHEN ci.status = 'VOID' THEN 'ANULADO'
                 WHEN ci.status = 'REDEEMED' OR ci.uses_count >= ci.uses_allowed THEN 'USADO'
                 WHEN ci.expires_at IS NOT NULL AND ci.expires_at < @ahora THEN 'VENCIDO'
                 ELSE 'VIGENTE' END AS situacion,
            (SELECT MAX(lr.created_at) FROM dbo.loyalty_redemptions lr
              WHERE lr.coupon_instance_id = ci.id) AS ultima_redencion,
            (SELECT MAX(lr.sale_id) FROM dbo.loyalty_redemptions lr
              WHERE lr.coupon_instance_id = ci.id) AS venta_redencion
        FROM dbo.coupon_instances ci
        JOIN dbo.coupon_definitions cd ON cd.id = ci.definition_id
        LEFT JOIN dbo.products p ON p.id = cd.product_id
        LEFT JOIN dbo.customers c ON c.id = ci.customer_id
        LEFT JOIN dbo.campaigns cp ON cp.id = ci.campaign_id
        LEFT JOIN dbo.registers rg ON rg.id = ci.register_id
        WHERE (@search IS NULL
               OR ci.code LIKE '%' + @search + '%'
               OR cd.name LIKE '%' + @search + '%'
               OR c.customerName LIKE '%' + @search + '%')
          AND (@estado IS NULL
               OR (@estado = 'EXPIRED' AND ci.expires_at IS NOT NULL AND ci.expires_at < @ahora
                   AND ci.status = 'ISSUED')
               OR (@estado <> 'EXPIRED' AND ci.status = @estado))
        ORDER BY ci.id DESC;
        RETURN;
    END

    RAISERROR('kind_of desconocido: use REWARD o COUPON.', 16, 1);
END
GO

/* ---------- sp_raffle_winner_status (SQL_STORED_PROCEDURE) ---------- */
/* sp_raffle_winner_status
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
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
               delivered_at = CASE WHEN @status = 'DELIVERED' THEN SYSDATETIME() ELSE delivered_at END,
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
