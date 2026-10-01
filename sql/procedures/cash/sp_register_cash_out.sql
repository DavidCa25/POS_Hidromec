/* sp_register_cash_out
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* ====================== sp_register_cash_out ====================== */
/* RETIRO DE CAJA. Dinero que cambia de lugar (al dueno, al banco): no es un
   gasto y sigue siendo WITHDRAW. Un gasto va por sp_register_expense y un
   pago a proveedor por sp_register_supplier_payment.
   0049: la caja ya no cae a "la primera de la tabla"; la decide
   sp_resolve_cash_register, igual que el resto del dinero. */
CREATE OR ALTER PROCEDURE [dbo].[sp_register_cash_out]
  @user_id       INT,
  @amount        DECIMAL(10,2),
  @note          NVARCHAR(255),
  @register_id   INT = NULL,            -- multicaja
  @machine_id    NVARCHAR(64) = NULL,
  @machine_name  NVARCHAR(120) = NULL
AS
BEGIN
  SET NOCOUNT ON;
  SET XACT_ABORT ON;
  DECLARE @cash_id INT;

  BEGIN TRY
    BEGIN TRAN;
    IF (@amount IS NULL OR @amount <= 0)
      RAISERROR('El monto debe ser mayor a cero.',16,1);
    IF (LTRIM(RTRIM(ISNULL(@note,''))) = '')
      RAISERROR('La nota es obligatoria.',16,1);

    DECLARE @caja INT;
    EXEC dbo.sp_resolve_cash_register
        @register_id = @register_id, @machine_id = @machine_id,
        @machine_name = @machine_name, @user_id = @user_id, @resolved = @caja OUTPUT;
    IF @caja IS NULL
      RAISERROR('No se pudo determinar la caja del retiro. Abre el turno en esta caja e intenta de nuevo.',16,1);
    SET @register_id = @caja;

    DECLARE @closure_id_open INT;
    SELECT TOP(1) @closure_id_open = id
    FROM dbo.cash_closures WITH (UPDLOCK, HOLDLOCK)
    WHERE register_id = @register_id
      AND closed_at IS NULL
    ORDER BY opened_at DESC, id DESC;

    IF @closure_id_open IS NULL
      RAISERROR('No hay un turno abierto en esta caja para registrar salida de efectivo.',16,1);

    INSERT INTO cash_movements(
      datee, userId, typee, reference_id, reference, amount, note, closure_id, register_id
    )
    VALUES(
      GETDATE(), @user_id, 'WITHDRAW', NULL, 'SALIDA CAJA', -@amount, @note, @closure_id_open, @register_id
    );

    SET @cash_id = SCOPE_IDENTITY();
    COMMIT TRAN;

    SELECT
      @cash_id AS cash_movement_id,
      @closure_id_open AS closure_id,
      @register_id AS register_id;
  END TRY
  BEGIN CATCH
    IF XACT_STATE() <> 0 ROLLBACK TRAN;
    DECLARE @msg NVARCHAR(4000) = ERROR_MESSAGE();
    RAISERROR(@msg, 16, 1);
  END CATCH
END
GO
