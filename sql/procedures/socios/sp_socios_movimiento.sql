/* sp_socios_movimiento
 * Definicion canonica. Mantener este archivo y generar una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* ======================= sp_socios_movimiento (0079) ======================
   Dinero que un socio se lleva o mete.

   RETIRO      se llevo dinero del negocio a cuenta de lo suyo.
   PAGO        el negocio le paga su saldo (despues de liquidar).
   APORTACION  metio dinero suyo al negocio.

   En EFECTIVO pasa por el cajon del turno abierto de la caja: un retiro o
   pago es salida (PARTNER_OUT) y una aportacion es entrada (PARTNER_IN), y
   el corte los cuenta. Por transferencia u otro no toca la caja.
   ======================================================================= */
CREATE OR ALTER PROCEDURE dbo.sp_socios_movimiento
    @socio_id    INT,
    @tipo        VARCHAR(12),
    @monto       DECIMAL(12, 2),
    @metodo      VARCHAR(20),
    @register_id INT = NULL,
    @nota        NVARCHAR(255) = NULL,
    @user_id     INT = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    IF NOT EXISTS (SELECT 1 FROM dbo.business_modules WHERE module_key = N'socios' AND enabled = 1)
        THROW 51000, N'Socios no está activado.', 1;
    SET @tipo = UPPER(LTRIM(RTRIM(ISNULL(@tipo, ''))));
    SET @metodo = UPPER(LTRIM(RTRIM(ISNULL(@metodo, ''))));
    IF @tipo NOT IN ('RETIRO', 'PAGO', 'APORTACION') THROW 51000, N'Movimiento no válido.', 1;
    IF @metodo NOT IN ('EFECTIVO', 'TRANSFERENCIA', 'OTRO') THROW 51000, N'Método no válido.', 1;
    IF @monto IS NULL OR @monto <= 0 THROW 51000, N'El monto debe ser mayor a cero.', 1;
    DECLARE @nombre NVARCHAR(80) = (SELECT nombre FROM dbo.socios WHERE id = @socio_id);
    IF @nombre IS NULL THROW 51000, N'Ese socio no existe.', 1;

    DECLARE @cash_id INT = NULL, @closure INT = NULL, @id INT;
    BEGIN TRAN;
        IF @metodo = 'EFECTIVO'
        BEGIN
            /* Una instalacion de una sola caja sin configurar: esa. */
            IF @register_id IS NULL AND (SELECT COUNT(*) FROM dbo.registers WHERE is_active = 1) = 1
                SELECT @register_id = id FROM dbo.registers WHERE is_active = 1;
            IF @register_id IS NULL THROW 51000, N'Indica la caja.', 1;
            SELECT TOP (1) @closure = id FROM dbo.cash_closures WITH (UPDLOCK, HOLDLOCK)
             WHERE register_id = @register_id AND closed_at IS NULL
             ORDER BY opened_at DESC, id DESC;
            IF @closure IS NULL THROW 51000, N'No hay un turno abierto en esta caja para mover efectivo.', 1;

            INSERT INTO dbo.cash_movements (datee, userId, typee, reference_id, reference, amount, note, closure_id, register_id)
            VALUES (GETDATE(), @user_id,
                    CASE WHEN @tipo = 'APORTACION' THEN 'PARTNER_IN' ELSE 'PARTNER_OUT' END,
                    @socio_id, LEFT(CONCAT(N'SOCIO ', @nombre), 100),
                    CASE WHEN @tipo = 'APORTACION' THEN @monto ELSE -@monto END,
                    LEFT(ISNULL(NULLIF(LTRIM(RTRIM(@nota)), N''),
                         CONCAT(CASE @tipo WHEN 'APORTACION' THEN N'Aportación de ' WHEN 'PAGO' THEN N'Pago a ' ELSE N'Retiro de ' END, @nombre)), 200),
                    @closure, @register_id);
            SET @cash_id = SCOPE_IDENTITY();
        END

        INSERT INTO dbo.socios_movimientos (socio_id, fecha, tipo, monto, metodo, register_id, cash_movement_id, nota, user_id)
        VALUES (@socio_id, SYSDATETIME(), @tipo, @monto, @metodo,
                CASE WHEN @metodo = 'EFECTIVO' THEN @register_id END, @cash_id, NULLIF(LTRIM(RTRIM(@nota)), N''), @user_id);
        SET @id = SCOPE_IDENTITY();
    COMMIT;

    SELECT m.id, m.socio_id, s.nombre, m.fecha, m.tipo, m.monto, m.metodo, m.register_id, m.cash_movement_id, m.nota
      FROM dbo.socios_movimientos m JOIN dbo.socios s ON s.id = m.socio_id
     WHERE m.id = @id;
END
GO
