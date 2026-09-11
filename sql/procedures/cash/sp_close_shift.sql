/* sp_close_shift
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* ====================== sp_close_shift ====================== */
CREATE OR ALTER PROCEDURE [dbo].[sp_close_shift]
    @user_id        INT = NULL,
    @cash_delivered DECIMAL(12,2),
    @closure_date   DATE = NULL,
    @closure_id     INT = NULL,
    @register_id    INT = NULL,         -- multicaja
    @machine_id     NVARCHAR(64) = NULL,
    @machine_name   NVARCHAR(120) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    DECLARE @now DATETIME2(0) = SYSDATETIME();
    IF @closure_date IS NULL
        SET @closure_date = CAST(@now AS DATE);

    /* ------------------- DE QUE CAJA ES ESTE CIERRE -------------------------
       El orden importa, y elegirlo mal fue un fallo real de QA.

       Antes era una sola linea: si no venia `@register_id`, se tomaba
       `TOP 1 ... ORDER BY id`, es decir la Caja 1. Mientras la caja solo servia
       para buscar el turno daba igual -el cierre llega con `@closure_id`, que
       ya identifica el turno-, pero desde que el arriendo se valida con
       `@register_id`, ese TOP 1 pasó a significar "valida la Caja 1". La
       laptop, cerrando SU Caja 2, recibia:

           "Esta caja la esta usando DESKTOP-LNQIU8G"

       El mensaje era cierto -ese equipo tiene la Caja 1- pero la caja
       comprobada no era la suya. Un cierre nunca puede validarse contra una
       caja distinta de la del turno que cierra.

       Ahora la caja se deduce, en este orden:
         1. la que dice quien llama;
         2. la del TURNO que se esta cerrando (la fuente de verdad: cerrar un
            turno es una operacion sobre ESE turno, no sobre "una caja");
         3. la que este equipo tiene arrendada;
         4. y solo si no hay nada de eso, la unica caja que existe.
       ------------------------------------------------------------------------ */
    IF @register_id IS NULL AND @closure_id IS NOT NULL
        SELECT @register_id = register_id FROM dbo.cash_closures WHERE id = @closure_id;

    IF @register_id IS NULL AND NULLIF(LTRIM(RTRIM(ISNULL(@machine_id, N''))), N'') IS NOT NULL
        SELECT @register_id = a.register_id
        FROM dbo.register_assignments a
        WHERE a.machine_id = @machine_id
          AND a.released_at IS NULL
          AND a.lease_until > SYSUTCDATETIME();

    IF @register_id IS NULL
        SELECT TOP 1 @register_id = id FROM dbo.registers ORDER BY id;


    /* ---------------- MULTICAJA: esta caja es de este equipo ----------------
       La proteccion NO puede vivir solo en el selector de la pantalla. El
       turno es de la CAJA (`cash_closures.register_id`), asi que dos equipos
       declarados C1 comparten turno y comparten corte: cerrar en uno cierra
       para el otro y las ventas de ambos caen en el mismo arqueo. Eso es
       dinero, y tiene que rechazarse aqui, donde no hay UI que saltarse.

       `@machine_id` NULO = el que llama no dice quien es. Entonces NO se
       exige nada: es el contrato de siempre, el que usan las instalaciones de
       una sola caja, las pruebas y cualquier version anterior de la app. Una
       instalacion MonoCaja no gana ni una friccion por esto.

       Cuando SI se identifica, la llamada ademas RENUEVA el arriendo. Una
       caja que esta vendiendo no puede perder su identidad porque un
       temporizador se estrangulo: vender es la senal de vida mas fuerte que
       existe. Y si el arriendo habia caducado sin que nadie lo tomara, se
       recupera en el acto en vez de interrumpir la venta.
       ---------------------------------------------------------------------- */
    IF NULLIF(LTRIM(RTRIM(ISNULL(@machine_id, N''))), N'') IS NOT NULL
    BEGIN
        DECLARE @lease_res NVARCHAR(20), @lease_holder NVARCHAR(64),
                @lease_holder_name NVARCHAR(120), @lease_hasta DATETIME2(0);

        EXEC dbo.sp_register_lease_touch
            @register_id   = @register_id,
            @machine_id    = @machine_id,
            @machine_name  = @machine_name,
            @lease_seconds = 300,
            @resultado     = @lease_res OUTPUT,
            @holder_id     = @lease_holder OUTPUT,
            @holder_name   = @lease_holder_name OUTPUT,
            @lease_until   = @lease_hasta OUTPUT;

        IF @lease_res = N'OCUPADA'
        BEGIN
            /* Sin acentos a proposito: el texto de un error de SQL Server
               llega al cliente degradado a un byte por caracter y cualquier
               acento se convierte en basura. El nombre del equipo si viaja
               bien porque lo puso el propio equipo. */
            DECLARE @lease_quien NVARCHAR(120) =
                ISNULL(NULLIF(LTRIM(RTRIM(@lease_holder_name)), N''), N'otro equipo');
            RAISERROR('Esta caja la esta usando %s. Dos equipos no pueden operar la misma caja: cada una lleva su propio turno y su propio corte.', 16, 1, @lease_quien);
            RETURN;
        END
    END
    BEGIN TRY
        BEGIN TRAN;

        DECLARE @cid INT = NULL;
        DECLARE @opened_at DATETIME2(0);
        DECLARE @opening_cash DECIMAL(12,2);
        DECLARE @shift_user_id INT;

        /* 1) Resolver turno a cerrar */
        IF @closure_id IS NOT NULL
        BEGIN
            SELECT
                @cid          = id,
                @shift_user_id= userId,
                @opened_at    = opened_at,
                @opening_cash = opening_cash
            FROM dbo.cash_closures WITH (UPDLOCK, HOLDLOCK)
            WHERE id = @closure_id
              AND closed_at IS NULL;

            IF @cid IS NULL
            BEGIN
                RAISERROR('Ese turno no existe o ya está cerrado.', 16, 1);
                ROLLBACK TRAN;
                RETURN;
            END

            IF @user_id IS NOT NULL AND @user_id <> @shift_user_id
            BEGIN
                RAISERROR('El turno no pertenece al usuario indicado.', 16, 1);
                ROLLBACK TRAN;
                RETURN;
            END
        END
        ELSE
        BEGIN
            /* Sin closure_id: cerrar el turno abierto de ESTA CAJA */
            SELECT TOP (1)
                @cid          = id,
                @shift_user_id= userId,
                @opened_at    = opened_at,
                @opening_cash = opening_cash
            FROM dbo.cash_closures WITH (UPDLOCK, HOLDLOCK)
            WHERE register_id = @register_id
              AND closed_at IS NULL
            ORDER BY opened_at DESC, id DESC;

            IF @cid IS NULL
            BEGIN
                RAISERROR('No hay un turno abierto en esta caja.', 16, 1);
                ROLLBACK TRAN;
                RETURN;
            END
        END

        /* 2) Sumar movimientos del turno (amarrados + sueltos por caja y rango) */
        DECLARE @mov_sum DECIMAL(12,2) =
        (
            SELECT ISNULL(SUM(CASE WHEN m.typee = 'OPENING' THEN 0 ELSE m.amount END), 0.00)
            FROM dbo.cash_movements AS m WITH (UPDLOCK)
            WHERE
                (
                    m.closure_id = @cid
                    OR (
                        m.closure_id IS NULL
                        AND m.register_id = @register_id
                        AND m.datee >= @opened_at
                        AND m.datee <= @now
                    )
                )
        );

        DECLARE @cash_expected DECIMAL(12,2) = ISNULL(@opening_cash,0) + ISNULL(@mov_sum,0);
        DECLARE @difference    DECIMAL(12,2) = @cash_delivered - @cash_expected;

        /* 3) Cerrar */
        UPDATE dbo.cash_closures
           SET cash_expected  = @cash_expected,
               cash_delivered = @cash_delivered,
               difference     = @difference,
               closed_at      = @now,
               create_date    = ISNULL(create_date, CAST(@opened_at AS DATE))
         WHERE id = @cid;

        /* 4) Amarrar sueltos de esta caja al cierre */
        UPDATE dbo.cash_movements
           SET closure_id = @cid
         WHERE register_id = @register_id
           AND closure_id IS NULL
           AND datee >= @opened_at
           AND datee <= @now;

        COMMIT TRAN;

        SELECT
            @cid            AS closure_id,
            CAST(@opened_at AS DATE) AS closure_date,
            @opened_at      AS opened_at,
            @now            AS closed_at,
            ISNULL(@opening_cash,0) AS opening_cash,
            ISNULL(@mov_sum,0)      AS movements_sum,
            @cash_expected  AS cash_expected,
            @cash_delivered AS cash_delivered,
            @difference     AS difference,
            @register_id    AS register_id;

    END TRY
    BEGIN CATCH
        IF XACT_STATE() <> 0 ROLLBACK TRAN;
        DECLARE @ErrMsg NVARCHAR(4000) = ERROR_MESSAGE();
        RAISERROR(@ErrMsg, 16, 1);
    END CATCH
END
GO
