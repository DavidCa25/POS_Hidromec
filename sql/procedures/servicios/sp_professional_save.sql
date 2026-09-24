/* sp_professional_save
 * Definicion canonica. Modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* Da de alta a quien hace el trabajo.
 *
 * ENLAZAR CON UN USUARIO NO LE DA PERMISOS
 * ----------------------------------------
 * `@user_id` dice "este profesional ademas entra a Wybix". Sirve para que vea
 * su propia agenda y para saber quien atendio. Lo que puede hacer lo sigue
 * decidiendo `users.rol` y el catalogo de paquetes del binario.
 *
 * Es opcional porque hay negocios donde el mecanico no toca la caja: exigirle
 * un usuario seria crear credenciales que nadie usa, y unas credenciales que
 * nadie usa son las que acaban compartidas.
 *
 * Y es unico: una persona no puede ser dos profesionales. Si lo fuera, sus
 * comisiones se repartirian entre dos filas y ninguna de las dos seria la
 * suya.
 */
CREATE OR ALTER PROCEDURE dbo.sp_professional_save
    @id                     INT = NULL,
    @full_name              NVARCHAR(120),
    @title                  NVARCHAR(60) = NULL,
    @phone                  NVARCHAR(30) = NULL,
    @email                  NVARCHAR(120) = NULL,
    @user_id                INT = NULL,
    @default_commission_pct DECIMAL(5, 2) = 0,
    @color                  NVARCHAR(9) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    IF @full_name IS NULL OR LTRIM(RTRIM(@full_name)) = ''
    BEGIN
        RAISERROR('El profesional necesita un nombre.', 16, 1);
        RETURN;
    END

    IF @default_commission_pct IS NULL OR @default_commission_pct < 0 OR @default_commission_pct > 100
    BEGIN
        RAISERROR('La comision va de 0 a 100.', 16, 1);
        RETURN;
    END

    IF @user_id IS NOT NULL
    BEGIN
        IF NOT EXISTS (SELECT 1 FROM dbo.users WHERE id = @user_id)
        BEGIN
            RAISERROR('Ese usuario no existe.', 16, 1);
            RETURN;
        END
        IF EXISTS (SELECT 1 FROM dbo.professionals
                    WHERE user_id = @user_id AND (@id IS NULL OR id <> @id))
        BEGIN
            RAISERROR('Ese usuario ya esta enlazado con otro profesional.', 16, 1);
            RETURN;
        END
    END

    IF @id IS NULL
    BEGIN
        INSERT INTO dbo.professionals
            (full_name, title, phone, email, user_id, default_commission_pct, color)
        VALUES
            (@full_name, @title, @phone, @email, @user_id, @default_commission_pct, @color);
        SET @id = SCOPE_IDENTITY();
    END
    ELSE
    BEGIN
        UPDATE dbo.professionals
           SET full_name = @full_name,
               title = @title,
               phone = @phone,
               email = @email,
               user_id = @user_id,
               default_commission_pct = @default_commission_pct,
               color = @color,
               updated_at = SYSDATETIME()
         WHERE id = @id;

        IF @@ROWCOUNT = 0
        BEGIN
            RAISERROR('Ese profesional ya no existe.', 16, 1);
            RETURN;
        END
    END

    SELECT * FROM dbo.professionals WHERE id = @id;
END
GO
