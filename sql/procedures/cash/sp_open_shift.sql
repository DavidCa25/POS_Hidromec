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
    @register_id     INT = NULL          -- multicaja
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;
    DECLARE @now DATETIME2(0) = SYSDATETIME();

    IF @register_id IS NULL
        SELECT TOP 1 @register_id = id FROM dbo.registers ORDER BY id;

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
