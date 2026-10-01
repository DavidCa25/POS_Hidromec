/* ============================================================
   0050 — agenda dice quien y cuando

   Generada con scripts/db/generar-migracion.mjs desde los archivos
   canonicos de sql/. No editar a mano: regenerar.

   Idempotente: todos los objetos usan CREATE OR ALTER, y los tipos
   comprueban su existencia antes de crearse. Se puede reejecutar.

   NO toca tablas ni datos. Solo objetos programables.
   ============================================================ */

/* ---------- sp_appointment_reschedule (SQL_STORED_PROCEDURE) ---------- */
/* sp_appointment_reschedule
 * Definicion canonica. Modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* Mueve una cita a otra hora.
 *
 * NO REESCRIBE: CREA LA NUEVA Y ENLAZA
 * ------------------------------------
 * La cita original queda como CANCELADA con un enlace desde la nueva. Podria
 * haberse cambiado la fecha en la misma fila -es una linea de codigo menos-,
 * pero entonces un cliente al que se le mueve la cita tres veces dejaria una
 * sola fila con la ultima fecha, y la pregunta "¿por que este cliente siempre
 * se queja?" no tendria respuesta en ningun sitio.
 *
 * Con el enlace, tres reprogramaciones son tres filas encadenadas y se ven.
 *
 * SE HEREDA TODO SALVO LA HORA
 * ----------------------------
 * Cliente, activo, servicio y persona se conservan. Lo que se esta moviendo es
 * la hora; si ademas cambia el resto, eso es una cita distinta y se agenda
 * como tal.
 */
CREATE OR ALTER PROCEDURE dbo.sp_appointment_reschedule
    @id               INT,
    @starts_at        DATETIME2(0),
    @ends_at          DATETIME2(0) = NULL,
    @professional_id  INT = NULL,
    @reason           NVARCHAR(200) = NULL,
    @permitir_encimar BIT = 0,
    @user_id          INT = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    DECLARE @customer_id INT, @asset_id INT, @service_id INT,
            @prof_actual INT, @status NVARCHAR(15), @order_id INT,
            @duracion INT, @notes NVARCHAR(400);

    SELECT @customer_id = customer_id, @asset_id = customer_asset_id,
           @service_id = service_product_id, @prof_actual = professional_id,
           @status = status, @order_id = service_order_id, @notes = notes,
           @duracion = DATEDIFF(MINUTE, starts_at, ends_at)
      FROM dbo.appointments WHERE id = @id;

    IF @customer_id IS NULL
    BEGIN
        RAISERROR('Esa cita no existe.', 16, 1);
        RETURN;
    END

    IF @status NOT IN ('AGENDADA', 'CONFIRMADA')
    BEGIN
        RAISERROR('Solo se reprograma una cita que sigue en pie.', 16, 1);
        RETURN;
    END

    IF @order_id IS NOT NULL
    BEGIN
        RAISERROR('Esta cita ya genero una orden de servicio.', 16, 1);
        RETURN;
    END

    IF @ends_at IS NULL SET @ends_at = DATEADD(MINUTE, ISNULL(NULLIF(@duracion, 0), 30), @starts_at);

    DECLARE @nueva INT;

    BEGIN TRAN;

    UPDATE dbo.appointments
       SET status = 'CANCELADA',
           notes = LEFT(ISNULL(@notes + ' · ', '') + 'Reprogramada'
                        + CASE WHEN @reason IS NULL THEN '' ELSE ': ' + @reason END, 400),
           updated_at = SYSDATETIME()
     WHERE id = @id;

    INSERT INTO dbo.appointments
        (customer_id, customer_asset_id, professional_id, service_product_id,
         starts_at, ends_at, status, notes, created_by, rescheduled_from_id)
    VALUES
        (@customer_id, @asset_id, ISNULL(@professional_id, @prof_actual), @service_id,
         @starts_at, @ends_at, 'AGENDADA', @reason, @user_id, @id);

    SET @nueva = SCOPE_IDENTITY();

    /* El choque se comprueba DESPUES de crear la nueva y con la original ya
       cancelada: si se comprobara antes, la cita se chocaria consigo misma. */
    DECLARE @otra_id INT = NULL, @otra_desde DATETIME2(0), @otra_hasta DATETIME2(0);
    IF ISNULL(@professional_id, @prof_actual) IS NOT NULL AND @permitir_encimar = 0
        SELECT TOP 1 @otra_id = b.id, @otra_desde = b.starts_at, @otra_hasta = b.ends_at
          FROM dbo.appointments b
         WHERE b.professional_id = ISNULL(@professional_id, @prof_actual)
           AND b.id <> @nueva
           AND b.status IN ('AGENDADA', 'CONFIRMADA')
           AND b.starts_at < @ends_at AND @starts_at < b.ends_at
         ORDER BY b.starts_at;

    IF @otra_id IS NOT NULL
    BEGIN
        ROLLBACK TRAN;
        /* Los mismos tres datos que en sp_appointment_save, y por lo mismo:
           mover una cita y crearla chocan igual, asi que la pantalla no puede
           tener que entender dos formatos para decir la misma frase. */
        DECLARE @quien2 NVARCHAR(120) =
            ISNULL((SELECT full_name FROM dbo.professionals
                     WHERE id = ISNULL(@professional_id, @prof_actual)), '');
        DECLARE @msg2 NVARCHAR(400) =
            'CITA_ENCIMADA|' + @quien2
            + '|' + CONVERT(NVARCHAR(5), @otra_desde, 108)
            + '|' + CONVERT(NVARCHAR(5), @otra_hasta, 108);
        RAISERROR(@msg2, 16, 1);
        RETURN;
    END

    COMMIT TRAN;

    EXEC dbo.sp_appointment_get @id = @nueva;
END
GO

/* ---------- sp_appointment_save (SQL_STORED_PROCEDURE) ---------- */
/* sp_appointment_save
 * Definicion canonica. Modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* Agenda una cita, o corrige una que ya existe.
 *
 * ENCIMAR CITAS SE IMPIDE; TRABAJAR FUERA DE HORARIO, SE AVISA
 * ------------------------------------------------------------
 * Son dos cosas distintas y merecen dos respuestas distintas.
 *
 * Dos citas a la misma hora con la misma persona es una promesa que no se
 * puede cumplir: alguien va a esperar. Eso se impide. Con `@permitir_encimar`
 * se puede forzar -hay negocios que sobreagendan a proposito, contando con
 * que uno de cada cinco no llega- y entonces queda dicho en las notas, que es
 * distinto de que pase sin que nadie lo sepa.
 *
 * En cambio, atender un sabado fuera del horario habitual, o en mitad de unas
 * vacaciones, pasa constantemente y casi siempre a proposito. Impedirlo
 * obligaria a editar el horario para meter una cita. Se avisa y se sigue.
 *
 * LA DURACION SALE DEL SERVICIO
 * -----------------------------
 * Si no se dice cuando termina, se calcula con la duracion del servicio. Es
 * lo que la Agenda necesita para colocar el bloque, y pedirsela a quien agenda
 * por telefono es pedirle una cuenta que el sistema ya sabe hacer.
 */
CREATE OR ALTER PROCEDURE dbo.sp_appointment_save
    @id                 INT = NULL,
    @customer_id        INT,
    @customer_asset_id  INT = NULL,
    @professional_id    INT = NULL,
    @service_product_id INT = NULL,
    @starts_at          DATETIME2(0),
    @ends_at            DATETIME2(0) = NULL,
    @notes              NVARCHAR(400) = NULL,
    @permitir_encimar   BIT = 0,
    @user_id            INT = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    IF NOT EXISTS (SELECT 1 FROM dbo.customers WHERE id = @customer_id)
    BEGIN
        RAISERROR('El cliente no existe.', 16, 1);
        RETURN;
    END

    IF @customer_asset_id IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM dbo.customer_assets
                        WHERE id = @customer_asset_id AND customer_id = @customer_id)
    BEGIN
        RAISERROR('Ese activo no es de este cliente.', 16, 1);
        RETURN;
    END

    IF @professional_id IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM dbo.professionals WHERE id = @professional_id AND active = 1)
    BEGIN
        RAISERROR('Ese profesional no existe o esta dado de baja.', 16, 1);
        RETURN;
    END

    IF @service_product_id IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM dbo.services s
                       JOIN dbo.products p ON p.id = s.product_id
                       WHERE s.product_id = @service_product_id AND p.active = 1)
    BEGIN
        RAISERROR('Ese servicio no existe o esta dado de baja.', 16, 1);
        RETURN;
    END

    /* Quien no hace ese servicio no puede recibir la cita: el cliente llegaria
       a una hora que nadie puede atender. */
    IF @professional_id IS NOT NULL AND @service_product_id IS NOT NULL
       AND EXISTS (SELECT 1 FROM dbo.service_professionals WHERE service_product_id = @service_product_id)
       AND NOT EXISTS (SELECT 1 FROM dbo.service_professionals
                        WHERE service_product_id = @service_product_id
                          AND professional_id = @professional_id)
    BEGIN
        RAISERROR('Esa persona no tiene asignado este servicio.', 16, 1);
        RETURN;
    END

    IF @ends_at IS NULL
    BEGIN
        DECLARE @minutos INT = ISNULL(
            (SELECT duration_minutes FROM dbo.services WHERE product_id = @service_product_id), 30);
        SET @ends_at = DATEADD(MINUTE, @minutos, @starts_at);
    END

    IF @ends_at <= @starts_at
    BEGIN
        RAISERROR('La cita tiene que terminar despues de empezar.', 16, 1);
        RETURN;
    END

    -- --------------------------------------------------------- se encima?
    DECLARE @choque INT = NULL, @choque_desde DATETIME2(0), @choque_hasta DATETIME2(0);
    IF @professional_id IS NOT NULL
        SELECT TOP 1 @choque = a.id, @choque_desde = a.starts_at, @choque_hasta = a.ends_at
          FROM dbo.appointments a
         WHERE a.professional_id = @professional_id
           AND a.status IN ('AGENDADA', 'CONFIRMADA')
           AND (@id IS NULL OR a.id <> @id)
           AND a.starts_at < @ends_at
           AND @starts_at < a.ends_at
         ORDER BY a.starts_at;

    IF @choque IS NOT NULL AND @permitir_encimar = 0
    BEGIN
        /* LOS HECHOS, NO LA FRASE.
           Esto devolvia '(2026-09-19 19:30)', que es la marca de tiempo tal
           como la escribe SQL Server: la lee un programador, no quien esta
           agendando con el cliente al telefono. La pantalla necesita saber
           QUIEN y DE CUANDO A CUANDO para poder decirlo en castellano, asi
           que se le mandan los tres datos separados y ella compone la frase.
           Es el mismo trato que ya tienen CONFLICTO_DE_VERSION y
           ACTIVO_BLOQUEADO: un codigo con lo necesario, no un texto. */
        DECLARE @quien NVARCHAR(120) =
            ISNULL((SELECT full_name FROM dbo.professionals WHERE id = @professional_id), '');
        DECLARE @msg NVARCHAR(400) =
            'CITA_ENCIMADA|' + @quien
            + '|' + CONVERT(NVARCHAR(5), @choque_desde, 108)
            + '|' + CONVERT(NVARCHAR(5), @choque_hasta, 108);
        RAISERROR(@msg, 16, 1);
        RETURN;
    END

    IF @choque IS NOT NULL AND @permitir_encimar = 1
        SET @notes = LEFT(ISNULL(@notes + ' · ', '') + 'Encimada con la cita '
                          + CONVERT(NVARCHAR(12), @choque) + '.', 400);

    BEGIN TRAN;

    IF @id IS NULL
    BEGIN
        INSERT INTO dbo.appointments
            (customer_id, customer_asset_id, professional_id, service_product_id,
             starts_at, ends_at, status, notes, created_by)
        VALUES
            (@customer_id, @customer_asset_id, @professional_id, @service_product_id,
             @starts_at, @ends_at, 'AGENDADA', @notes, @user_id);
        SET @id = SCOPE_IDENTITY();
    END
    ELSE
    BEGIN
        IF EXISTS (SELECT 1 FROM dbo.appointments
                    WHERE id = @id AND status IN ('ATENDIDA', 'CANCELADA', 'NO_ASISTIO'))
        BEGIN
            ROLLBACK TRAN;
            RAISERROR('Esa cita ya esta cerrada. Para moverla, agenda una nueva.', 16, 1);
            RETURN;
        END

        UPDATE dbo.appointments
           SET customer_id = @customer_id,
               customer_asset_id = @customer_asset_id,
               professional_id = @professional_id,
               service_product_id = @service_product_id,
               starts_at = @starts_at,
               ends_at = @ends_at,
               notes = @notes,
               updated_at = SYSDATETIME()
         WHERE id = @id;

        IF @@ROWCOUNT = 0
        BEGIN
            ROLLBACK TRAN;
            RAISERROR('Esa cita ya no existe.', 16, 1);
            RETURN;
        END
    END

    COMMIT TRAN;

    EXEC dbo.sp_appointment_get @id = @id;
END
GO
