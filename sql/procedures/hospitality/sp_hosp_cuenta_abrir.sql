/* sp_hosp_cuenta_abrir
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* ABRIR: igual que en 0046, mas el cliente opcional. */
CREATE OR ALTER PROCEDURE dbo.sp_hosp_cuenta_abrir
    @mesa_id INT = NULL,
    @etiqueta NVARCHAR(60) = NULL,
    @personas INT = NULL,
    @user_id INT = NULL,
    @register_id INT = NULL,
    @customer_id INT = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;
    DECLARE @id INT, @numero INT = NULL, @ahora DATETIME2 = SYSDATETIME();

    IF @mesa_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM dbo.salon_mesas WHERE id = @mesa_id AND activa = 1)
    BEGIN RAISERROR('La mesa no existe.', 16, 1); RETURN; END

    IF @mesa_id IS NULL AND LTRIM(RTRIM(ISNULL(@etiqueta, ''))) = ''
    BEGIN RAISERROR('Una cuenta sin mesa necesita un nombre.', 16, 1); RETURN; END

    IF @customer_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM dbo.customers WHERE id = @customer_id)
    BEGIN RAISERROR('El cliente no existe.', 16, 1); RETURN; END

    BEGIN TRAN;
    IF @mesa_id IS NOT NULL
        SELECT @id = id FROM dbo.hosp_cuentas WITH (UPDLOCK, HOLDLOCK)
         WHERE mesa_id = @mesa_id AND estado IN ('ABIERTA', 'POR_COBRAR');

    IF @id IS NULL
    BEGIN
        IF @mesa_id IS NULL
            SELECT @numero = ISNULL(MAX(numero_dia), 0) + 1
              FROM dbo.hosp_cuentas WITH (UPDLOCK, HOLDLOCK)
             WHERE abierta_dia = CAST(@ahora AS DATE);

        INSERT INTO dbo.hosp_cuentas (mesa_id, etiqueta, personas, abierta_por, register_id, abierta_en, numero_dia, seguimiento, customer_id)
        VALUES (@mesa_id, NULLIF(LTRIM(RTRIM(@etiqueta)), ''), @personas, @user_id, @register_id, @ahora, @numero,
                CASE WHEN @numero IS NOT NULL THEN CONVERT(CHAR(32), CRYPT_GEN_RANDOM(16), 2) END, @customer_id);
        SET @id = SCOPE_IDENTITY();
    END
    /* Una mesa ya abierta toma el cliente solo si aun no tenia: abrirla desde
       otra caja no cambia de quien es. */
    ELSE IF @customer_id IS NOT NULL
        UPDATE dbo.hosp_cuentas SET customer_id = @customer_id WHERE id = @id AND customer_id IS NULL;
    COMMIT TRAN;

    EXEC dbo.sp_hosp_cuenta_get @cuenta_id = @id;
END
GO
