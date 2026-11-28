/* sp_mesero_entregar
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* 0097 · EL MESERO ENTREGA SU EFECTIVO EN CAJA.

   Lo que debía entregar es lo que entró a su bolsa en los turnos abiertos
   menos lo que ya se le tomó en entregas anteriores. Lo que entrega entra al
   cajón de @register_id (MESERO_ENTREGA +) en su turno abierto; la diferencia
   queda en la entrega (− le faltó, + le sobró) y NO en el corte de la caja:
   el cajón cuadra con lo que de verdad le dieron.

   Se puede entregar en partes (a media noche y al cerrar). */
CREATE OR ALTER PROCEDURE dbo.sp_mesero_entregar
    @mesero_id INT,
    @entregado DECIMAL(12, 2),
    @register_id INT,
    @user_id INT = NULL,
    @nota NVARCHAR(255) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    IF @entregado IS NULL OR @entregado < 0 THROW 51000, 'Lo entregado tiene que ser de $0 en adelante.', 1;
    IF NOT EXISTS (SELECT 1 FROM dbo.users WHERE id = @mesero_id) THROW 51000, 'Ese mesero no existe.', 1;

    BEGIN TRAN;
        DECLARE @closure INT;
        SELECT TOP (1) @closure = id FROM dbo.cash_closures WITH (UPDLOCK, HOLDLOCK)
         WHERE register_id = @register_id AND closed_at IS NULL ORDER BY opened_at DESC, id DESC;
        IF @closure IS NULL THROW 51000, 'No hay un turno abierto en esta caja para recibir la entrega.', 1;

        DECLARE @esperado DECIMAL(12, 2) =
              ISNULL((SELECT SUM(c.efectivo) FROM dbo.mesero_cobros c WITH (UPDLOCK, HOLDLOCK)
                        JOIN dbo.cash_closures z ON z.id = c.closure_id
                       WHERE c.mesero_id = @mesero_id AND z.closed_at IS NULL), 0)
            - ISNULL((SELECT SUM(e.esperado) FROM dbo.mesero_entregas e WITH (UPDLOCK, HOLDLOCK)
                        JOIN dbo.cash_closures z ON z.id = e.closure_id
                       WHERE e.mesero_id = @mesero_id AND z.closed_at IS NULL), 0);
        IF @esperado <= 0 AND @entregado = 0 THROW 51000, 'Ese mesero no tiene efectivo por entregar.', 1;

        DECLARE @mov INT = NULL;
        IF @entregado > 0
        BEGIN
            INSERT INTO dbo.cash_movements (datee, userId, typee, reference_id, reference, amount, note, closure_id, register_id)
            VALUES (GETDATE(), ISNULL(@user_id, @mesero_id), 'MESERO_ENTREGA', @mesero_id,
                    CONCAT(N'ENTREGA MESERO ', (SELECT usuario FROM dbo.users WHERE id = @mesero_id)), @entregado,
                    LEFT(CONCAT(N'Entrega del mesero', CASE WHEN @nota IS NULL THEN N'' ELSE N' · ' + @nota END), 255), @closure, @register_id);
            SET @mov = SCOPE_IDENTITY();
        END;

        DECLARE @id INT;
        INSERT INTO dbo.mesero_entregas (mesero_id, closure_id, register_id, esperado, entregado, diferencia, recibio_user_id, nota, cash_movement_id)
        VALUES (@mesero_id, @closure, @register_id, CASE WHEN @esperado < 0 THEN 0 ELSE @esperado END, @entregado,
                @entregado - CASE WHEN @esperado < 0 THEN 0 ELSE @esperado END, @user_id, @nota, @mov);
        SET @id = SCOPE_IDENTITY();
    COMMIT;

    SELECT id, mesero_id, closure_id, esperado, entregado, diferencia, entregado_en FROM dbo.mesero_entregas WHERE id = @id;
END;
GO
