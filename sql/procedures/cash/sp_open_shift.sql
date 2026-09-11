/* sp_open_shift
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* ====================== sp_open_shift ====================== */
CREATE OR ALTER PROCEDURE [dbo].[sp_open_shift]
    @user_id         INT,
    @opening_cash    DECIMAL(12,2) = 0,
    @opening_note    NVARCHAR(255) = NULL,
    @opening_user_id INT = NULL,
    @register_id     INT = NULL,         -- multicaja
    -- Identidad del equipo. Ver el bloque MULTICAJA mas abajo: NULO = no se
    -- exige nada, que es el contrato de MonoCaja y el de las versiones previas.
    @machine_id      NVARCHAR(64) = NULL,
    @machine_name    NVARCHAR(120) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;
    DECLARE @now DATETIME2(0) = SYSDATETIME();

    /* Si este equipo dice quien es, SU caja es la que tiene arrendada. Caer a
       `TOP 1 ... ORDER BY id` significaria "la Caja 1", que es de otro equipo:
       el mismo error que hacia que la laptop validara la caja de la VM. */
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

        /* Un turno abierto por CAJA (no por usuario) */
        IF EXISTS (
            SELECT 1
            FROM dbo.cash_closures WITH (UPDLOCK, HOLDLOCK)
            WHERE register_id = @register_id
              AND closed_at IS NULL
        )
        BEGIN
            RAISERROR('Ya existe un turno abierto en esta caja.', 16, 1);
            ROLLBACK TRAN;
            RETURN;
        END

        INSERT INTO dbo.cash_closures (
            userId, create_date, opened_at, closed_at,
            opening_cash, opening_note, opening_user_id,
            cash_expected, cash_delivered, difference,
            register_id
        )
        VALUES (
            @user_id, CAST(@now AS DATE), @now, NULL,
            ISNULL(@opening_cash, 0), @opening_note, @opening_user_id,
            0, 0, 0,
            @register_id
        );

        DECLARE @closure_id INT = SCOPE_IDENTITY();

        IF ISNULL(@opening_cash,0) > 0
        BEGIN
            INSERT INTO dbo.cash_movements (
                datee, userId, typee, reference_id, reference, amount, note, closure_id, register_id
            )
            VALUES (
                @now, @user_id, 'OPENING', @closure_id, 'FONDO INICIAL',
                ISNULL(@opening_cash,0), @opening_note, NULL, @register_id
            );
        END

        COMMIT TRAN;

        SELECT
            @closure_id AS closure_id,
            @user_id AS user_id,
            CAST(@now AS DATE) AS create_date,
            @now AS opened_at,
            ISNULL(@opening_cash,0) AS opening_cash,
            @register_id AS register_id;
    END TRY
    BEGIN CATCH
        IF XACT_STATE() <> 0 ROLLBACK TRAN;
        DECLARE @msg NVARCHAR(4000) = ERROR_MESSAGE();
        RAISERROR(@msg, 16, 1);
    END CATCH
END
GO
