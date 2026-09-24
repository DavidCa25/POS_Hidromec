/* sp_professional_time_off_save
 * Definicion canonica. Modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* Una ausencia: vacaciones, una tarde libre, una incapacidad.
 *
 * AVISA DE LAS CITAS QUE SE QUEDAN DENTRO, PERO NO LAS TOCA
 * ---------------------------------------------------------
 * Cancelarlas solo seria decidir por el negocio: a esas personas hay que
 * llamarlas, y hasta que alguien llame la cita sigue existiendo. Lo que se
 * hace es devolver cuales son, con su telefono, para que la pantalla lo diga
 * y alguien pueda hacer las llamadas.
 *
 * `@id = NULL` da de alta; con `@id` se corrige una existente. Borrar es otro
 * procedimiento porque devuelve horas a la agenda y eso merece ser una
 * decision aparte.
 */
CREATE OR ALTER PROCEDURE dbo.sp_professional_time_off_save
    @id              INT = NULL,
    @professional_id INT,
    @starts_at       DATETIME2(0),
    @ends_at         DATETIME2(0),
    @reason          NVARCHAR(200) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    IF @ends_at <= @starts_at
    BEGIN
        RAISERROR('La ausencia tiene que terminar despues de empezar.', 16, 1);
        RETURN;
    END

    IF NOT EXISTS (SELECT 1 FROM dbo.professionals WHERE id = @professional_id)
    BEGIN
        RAISERROR('Ese profesional no existe.', 16, 1);
        RETURN;
    END

    IF @id IS NULL
    BEGIN
        INSERT INTO dbo.professional_time_off (professional_id, starts_at, ends_at, reason)
        VALUES (@professional_id, @starts_at, @ends_at, @reason);
        SET @id = SCOPE_IDENTITY();
    END
    ELSE
    BEGIN
        UPDATE dbo.professional_time_off
           SET professional_id = @professional_id,
               starts_at = @starts_at,
               ends_at = @ends_at,
               reason = @reason
         WHERE id = @id;

        IF @@ROWCOUNT = 0
        BEGIN
            RAISERROR('Esa ausencia ya no existe.', 16, 1);
            RETURN;
        END
    END

    SELECT * FROM dbo.professional_time_off WHERE id = @id;

    /* Las citas que quedan dentro. No se tocan: se avisan. */
    SELECT a.id, a.starts_at, a.ends_at, a.status,
           c.customerName AS customer_name, c.phone, c.mobile
      FROM dbo.appointments a
      JOIN dbo.customers c ON c.id = a.customer_id
     WHERE a.professional_id = @professional_id
       AND a.status IN ('AGENDADA', 'CONFIRMADA')
       AND a.starts_at < @ends_at
       AND @starts_at < a.ends_at
     ORDER BY a.starts_at;
END
GO
