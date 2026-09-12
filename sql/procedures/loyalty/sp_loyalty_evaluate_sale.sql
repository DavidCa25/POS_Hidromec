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
