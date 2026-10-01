/* sp_setup_inicial
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* ---------- sp_setup_inicial (SQL_STORED_PROCEDURE) ----------
   Definicion canonica. Modificar este archivo y crear una migracion.

   Lo unico que cambia respecto de 0007 es el bloque marcado abajo: el alta
   del negocio siembra tambien el registro de modulos. Va DENTRO de la misma
   transaccion a proposito: un negocio a medio dar de alta —con perfil y sin
   modulo— es exactamente el estado que produjo este fallo.
*/
CREATE OR ALTER PROCEDURE dbo.sp_setup_inicial
    @usuario        NVARCHAR(100),
    @password       NVARCHAR(100),
    @business_name  NVARCHAR(200) = NULL,
    @address        NVARCHAR(300) = NULL,
    @phone          NVARCHAR(50)  = NULL,
    @rfc            NVARCHAR(50)  = NULL,
    @business_profile NVARCHAR(20) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    IF EXISTS (SELECT 1 FROM dbo.users)
    BEGIN
        RAISERROR('El sistema ya fue configurado.', 16, 1);
        RETURN;
    END

    IF LEN(LTRIM(RTRIM(@usuario))) < 3
    BEGIN
        RAISERROR('El usuario debe tener al menos 3 caracteres.', 16, 1);
        RETURN;
    END

    IF LEN(@password) < 6
    BEGIN
        RAISERROR('La contrasena debe tener al menos 6 caracteres.', 16, 1);
        RETURN;
    END

    IF @business_profile IS NOT NULL
    BEGIN
        SET @business_profile = UPPER(LTRIM(RTRIM(@business_profile)));
        IF @business_profile NOT IN ('RETAIL', 'HOSPITALITY')
        BEGIN
            RAISERROR('business_profile invalido: use RETAIL o HOSPITALITY.', 16, 1);
            RETURN;
        END
    END

    BEGIN TRY
        BEGIN TRAN;

        INSERT INTO dbo.users (usuario, password_hash, rol, active, creation_date)
        VALUES (
            @usuario,
            CONVERT(NVARCHAR(255), HASHBYTES('SHA2_256', @password), 2),
            N'admin',
            1,
            GETDATE()
        );

        DECLARE @user_id INT = SCOPE_IDENTITY();

        IF NOT EXISTS (SELECT 1 FROM dbo.business_config)
        BEGIN
            INSERT INTO dbo.business_config
                (business_name, address, phone, rfc, business_profile, invoicing_enabled, updated_at)
            VALUES
                (@business_name, @address, @phone, @rfc,
                 ISNULL(@business_profile, 'RETAIL'), 0, GETDATE());
        END

        /* ------------------------------------------- EL REGISTRO DE MODULOS
           Un negocio de alimentos nace con Hospitality encendido AQUI, y no
           solo con el perfil escrito. El perfil quedo como «con que nacio el
           negocio»; quien gobierna el comportamiento es el registro, y hasta
           ahora nadie lo escribia en el alta. */
        IF OBJECT_ID(N'dbo.business_modules', 'U') IS NOT NULL
        BEGIN
            DECLARE @hosp BIT =
                CASE WHEN ISNULL(@business_profile, 'RETAIL') = 'HOSPITALITY' THEN 1 ELSE 0 END;

            MERGE dbo.business_modules AS d
            USING (SELECT 'hospitality' AS module_key) AS s ON d.module_key = s.module_key
            WHEN MATCHED AND d.enabled <> @hosp
              THEN UPDATE SET enabled = @hosp,
                              enabled_at = CASE WHEN @hosp = 1 THEN SYSDATETIME() ELSE enabled_at END,
                              updated_at = SYSDATETIME()
            WHEN NOT MATCHED
              THEN INSERT (module_key, enabled, enabled_at, updated_at)
                   VALUES ('hospitality', @hosp,
                           CASE WHEN @hosp = 1 THEN SYSDATETIME() END, SYSDATETIME());
        END

        COMMIT TRAN;

        SELECT @user_id AS user_id, @usuario AS usuario;
    END TRY
    BEGIN CATCH
        IF XACT_STATE() <> 0 ROLLBACK TRAN;
        DECLARE @msg NVARCHAR(4000) = ERROR_MESSAGE();
        RAISERROR(@msg, 16, 1);
    END CATCH
END
GO
