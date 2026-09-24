/* sp_professional_time_off_delete
 * Definicion canonica. Modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* Quita una ausencia y devuelve esas horas a la agenda.
 *
 * Esto SI borra, y es de las pocas cosas del modulo que lo hacen. Una ausencia
 * no es un hecho del negocio -no se le cobro nada a nadie, no cambio ningun
 * saldo-: es una prevision que dejo de serlo. Conservarla marcada como
 * "anulada" solo llenaria la pantalla de horarios de ruido.
 */
CREATE OR ALTER PROCEDURE dbo.sp_professional_time_off_delete
    @id INT
AS
BEGIN
    SET NOCOUNT ON;

    DELETE FROM dbo.professional_time_off WHERE id = @id;

    IF @@ROWCOUNT = 0
    BEGIN
        RAISERROR('Esa ausencia ya no existe.', 16, 1);
        RETURN;
    END

    SELECT @id AS id;
END
GO
