/* sp_register_expense
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* ------------------------------------------------------------------------
   REGISTRAR UN EGRESO (y un PAGO AL PERSONAL, que es un egreso de concepto
   "Pago al personal" ligado a una persona).

   LA REGLA CENTRAL
     EFECTIVO   sale del cajon: exige turno abierto en ESA caja y deja un
                cash_movement negativo (typee EXPENSE) amarrado a ese turno.
                Todo en una transaccion: o quedan el egreso y la salida, o no
                queda nada. Baja el efectivo esperado del corte.
     otro medio (TRANSFERENCIA, TARJETA, OTRO) se registra el egreso y NO
                toca el cajon ni el corte.
   La tabla lo exige tambien (CK_expenses_cash): no se puede escribir un
   egreso en efectivo sin su salida del cajon.

   PAGO AL PERSONAL (concepto PERSONAL)
     Exige la persona (@staff_user_id, de `users`: la entidad del personal en
     Wybix) y el tipo de periodo:
       DIA     si no se dan fechas, el periodo es el dia del pago;
       SEMANA  si no se dan fechas, la semana (lunes a domingo) del pago;
       OTRO    las dos fechas son obligatorias.
     No es nomina: no hay percepciones, deducciones ni impuestos. Es dejar
     constancia de cuanto se le pago a quien y por que periodo.
   Un concepto que NO es de personal no admite persona ni periodo: un Uber no
   se le paga a un empleado del sistema.

   Un egreso en efectivo sale HOY del cajon, asi que su fecha es la de hoy.
   Uno por transferencia puede capturarse despues con la fecha que tuvo.
   ------------------------------------------------------------------------ */
CREATE OR ALTER PROCEDURE dbo.sp_register_expense
    @user_id         INT,
    @category_id     INT,
    @amount          DECIMAL(12,2),
    @payment_method  VARCHAR(20),
    @expense_date    DATE = NULL,
    @note            NVARCHAR(255) = NULL,
    @beneficiary     NVARCHAR(120) = NULL,
    @staff_user_id   INT = NULL,
    @period_kind     VARCHAR(10) = NULL,
    @period_from     DATE = NULL,
    @period_to       DATE = NULL,
    @register_id     INT = NULL,
    @machine_id      NVARCHAR(64) = NULL,
    @machine_name    NVARCHAR(120) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    DECLARE @hoy DATE = CAST(SYSDATETIME() AS DATE);
    DECLARE @metodo VARCHAR(20) = UPPER(LTRIM(RTRIM(ISNULL(@payment_method, ''))));
    DECLARE @kind VARCHAR(10), @cat_name NVARCHAR(60), @cat_active BIT;
    DECLARE @caja INT = NULL, @closure_id INT = NULL, @cash_id INT = NULL, @expense_id INT;

    SET @note = NULLIF(LTRIM(RTRIM(@note)), N'');
    SET @beneficiary = NULLIF(LTRIM(RTRIM(@beneficiary)), N'');
    SET @period_kind = NULLIF(UPPER(LTRIM(RTRIM(@period_kind))), '');

    BEGIN TRY
        BEGIN TRAN;

        IF @amount IS NULL OR @amount <= 0
            RAISERROR('El monto del egreso debe ser mayor a cero.', 16, 1);
        IF @metodo NOT IN ('EFECTIVO', 'TRANSFERENCIA', 'TARJETA', 'OTRO')
            RAISERROR('Forma de pago no valida para un egreso.', 16, 1);

        SELECT @kind = kind, @cat_name = name, @cat_active = active
          FROM dbo.expense_categories WHERE id = @category_id;
        IF @kind IS NULL
            RAISERROR('El concepto de egreso no existe.', 16, 1);
        IF @cat_active = 0
            RAISERROR('Ese concepto esta desactivado. Activalo o elige otro.', 16, 1);

        IF @expense_date IS NULL SET @expense_date = @hoy;
        IF @metodo = 'EFECTIVO' AND @expense_date <> @hoy
            RAISERROR('Un egreso en efectivo sale hoy del cajon: su fecha es la de hoy. Si lo pagaste otro dia, registralo con la forma de pago que tuvo.', 16, 1);
        IF @expense_date > @hoy
            RAISERROR('La fecha del egreso no puede ser futura.', 16, 1);

        /* ---------------- pago al personal ---------------- */
        IF @kind = 'PERSONAL'
        BEGIN
            IF @staff_user_id IS NULL
                RAISERROR('Elige a quien se le paga.', 16, 1);
            IF NOT EXISTS (SELECT 1 FROM dbo.users WHERE id = @staff_user_id)
                RAISERROR('La persona elegida no existe.', 16, 1);
            IF @period_kind IS NULL OR @period_kind NOT IN ('DIA', 'SEMANA', 'OTRO')
                RAISERROR('Indica el periodo que se paga: dia, semana u otro.', 16, 1);

            IF @period_kind = 'DIA'
            BEGIN
                SET @period_from = ISNULL(@period_from, @expense_date);
                SET @period_to   = ISNULL(@period_to, @period_from);
            END
            ELSE IF @period_kind = 'SEMANA' AND (@period_from IS NULL OR @period_to IS NULL)
            BEGIN
                /* Lunes de la semana del pago, sin depender de DATEFIRST. */
                DECLARE @base DATE = ISNULL(@period_from, @expense_date);
                SET @period_from = DATEADD(DAY, -((DATEDIFF(DAY, '19000101', @base)) % 7), @base);
                SET @period_to   = DATEADD(DAY, 6, @period_from);
            END
            ELSE IF @period_kind = 'OTRO' AND (@period_from IS NULL OR @period_to IS NULL)
                RAISERROR('Para un periodo "otro" indica desde y hasta que fecha se paga.', 16, 1);

            IF @period_from > @period_to
                RAISERROR('El periodo pagado esta al reves: "desde" es posterior a "hasta".', 16, 1);
        END
        ELSE
        BEGIN
            IF @staff_user_id IS NOT NULL
                RAISERROR('Solo un pago al personal va ligado a una persona. Elige el concepto "pago al personal".', 16, 1);
            SELECT @period_kind = NULL, @period_from = NULL, @period_to = NULL;
        END

        /* ---------------- efectivo: sale del cajon ---------------- */
        IF @metodo = 'EFECTIVO'
        BEGIN
            EXEC dbo.sp_resolve_cash_register
                @register_id = @register_id, @machine_id = @machine_id,
                @machine_name = @machine_name, @user_id = @user_id, @resolved = @caja OUTPUT;
            IF @caja IS NULL
                RAISERROR('No se pudo determinar la caja de la que sale el efectivo. Abre el turno en esta caja e intenta de nuevo.', 16, 1);

            SELECT TOP (1) @closure_id = id
              FROM dbo.cash_closures WITH (UPDLOCK, HOLDLOCK)
             WHERE register_id = @caja AND closed_at IS NULL
             ORDER BY opened_at DESC, id DESC;
            IF @closure_id IS NULL
                RAISERROR('Para pagar en efectivo hace falta un turno abierto en esta caja.', 16, 1);

            INSERT INTO dbo.cash_movements (datee, userId, typee, reference_id, reference, amount, note, closure_id, register_id)
            VALUES (GETDATE(), @user_id, 'EXPENSE', NULL, LEFT(CONCAT(N'Egreso: ', @cat_name), 100),
                    -@amount, LEFT(@note, 200), @closure_id, @caja);
            SET @cash_id = SCOPE_IDENTITY();
        END
        ELSE
            /* Fuera del cajon la caja es solo informativa: se guarda si se dio. */
            SET @caja = @register_id;

        INSERT INTO dbo.expenses (
            expense_date, category_id, amount, payment_method, note, user_id,
            register_id, closure_id, cash_movement_id, beneficiary,
            staff_user_id, period_kind, period_from, period_to)
        VALUES (
            @expense_date, @category_id, @amount, @metodo, @note, @user_id,
            @caja, @closure_id, @cash_id, @beneficiary,
            @staff_user_id, @period_kind, @period_from, @period_to);
        SET @expense_id = SCOPE_IDENTITY();

        IF @cash_id IS NOT NULL
            UPDATE dbo.cash_movements SET reference_id = @expense_id WHERE id = @cash_id;

        COMMIT TRAN;

        SELECT @expense_id AS expense_id, @cash_id AS cash_movement_id,
               @closure_id AS closure_id, @caja AS register_id,
               @period_from AS period_from, @period_to AS period_to;
    END TRY
    BEGIN CATCH
        IF XACT_STATE() <> 0 ROLLBACK TRAN;
        DECLARE @msg NVARCHAR(4000) = ERROR_MESSAGE();
        RAISERROR(@msg, 16, 1);
    END CATCH
END
GO
