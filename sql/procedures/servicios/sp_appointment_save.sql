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
    DECLARE @choque INT = NULL, @choque_desde DATETIME2(0);
    IF @professional_id IS NOT NULL
        SELECT TOP 1 @choque = a.id, @choque_desde = a.starts_at
          FROM dbo.appointments a
         WHERE a.professional_id = @professional_id
           AND a.status IN ('AGENDADA', 'CONFIRMADA')
           AND (@id IS NULL OR a.id <> @id)
           AND a.starts_at < @ends_at
           AND @starts_at < a.ends_at
         ORDER BY a.starts_at;

    IF @choque IS NOT NULL AND @permitir_encimar = 0
    BEGIN
        DECLARE @msg NVARCHAR(200) =
            'Ya hay una cita a esa hora (' + CONVERT(NVARCHAR(16), @choque_desde, 120) + ').';
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
