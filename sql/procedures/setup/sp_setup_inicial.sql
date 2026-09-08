/* sp_setup_inicial
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
CREATE OR ALTER PROCEDURE [dbo].[sp_setup_inicial]
    @usuario        NVARCHAR(50),
    @password       NVARCHAR(255),
    @business_name  NVARCHAR(200),
    @address        NVARCHAR(300) = NULL,
    @phone          NVARCHAR(50)  = NULL,
    @rfc            NVARCHAR(50)  = NULL,
    -- Que vende el negocio. Decide si existen recetas, ingredientes y
    -- modificadores, asi que forma parte de la configuracion inicial: si se
    -- deja fuera, el alta nace en RETAIL y el giro elegido se pierde.
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

    -- Mismo contrato que sp_update_business_config: se valida aqui para que el
    -- error diga que valor se esperaba, en vez de dejarlo al CHECK de la tabla.
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

        -- Mismo hash que sp_login_user y sp_add_user
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
