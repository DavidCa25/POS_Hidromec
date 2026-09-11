/* sp_add_user
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
-- =============================================
-- Author:		<Daniela Luna>
-- Create date: <04/08/2025>
-- Description:	<SP para agregar usuarios>
-- =============================================




CREATE OR ALTER PROCEDURE sp_add_user
    @username NVARCHAR(50),
    @password NVARCHAR(255),
    @role NVARCHAR(20)
AS
BEGIN
    SET NOCOUNT ON;

    -- Verificar si ya existe un usuario con ese nombre
    IF EXISTS (SELECT 1 FROM users WHERE usuario = @username)
    BEGIN
        RAISERROR('El nombre de usuario ya está registrado.', 16, 1);
        RETURN;
    END;

    -- Insertar el nuevo usuario con la contraseña cifrada
    INSERT INTO users (usuario, password_hash, rol, active, creation_date)
    VALUES (
        @username,
        CONVERT(NVARCHAR(255), HASHBYTES('SHA2_256', @password), 2),
        @role,
        1,
        GETDATE()
    );
END;
GO
