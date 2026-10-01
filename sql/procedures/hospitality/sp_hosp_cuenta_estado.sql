/* sp_hosp_cuenta_estado
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* ABIERTA <-> POR_COBRAR. «Por cobrar» es el cliente que pidio la cuenta. */
CREATE OR ALTER PROCEDURE dbo.sp_hosp_cuenta_estado
    @cuenta_id INT,
    @estado NVARCHAR(12),
    @user_id INT = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET @estado = UPPER(LTRIM(RTRIM(ISNULL(@estado, ''))));
    IF @estado NOT IN ('ABIERTA', 'POR_COBRAR')
    BEGIN RAISERROR('Estado no válido.', 16, 1); RETURN; END
    IF NOT EXISTS (SELECT 1 FROM dbo.hosp_cuentas WHERE id = @cuenta_id AND estado IN ('ABIERTA', 'POR_COBRAR'))
    BEGIN RAISERROR('Esta cuenta ya está cerrada.', 16, 1); RETURN; END
    UPDATE dbo.hosp_cuentas SET estado = @estado WHERE id = @cuenta_id;
    SELECT id, estado FROM dbo.hosp_cuentas WHERE id = @cuenta_id;
END
GO
