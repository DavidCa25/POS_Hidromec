/* sp_update_user
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




CREATE OR ALTER PROCEDURE sp_update_user
    @user_id INT,
    @usuario NVARCHAR(100),
    @rol BIT,
    @nuevo_password NVARCHAR(100) = NULL
AS
BEGIN
    -- Opcional: Actualizar contraseña solo si se proporciona una nueva
    IF @nuevo_password IS NOT NULL
    BEGIN
        UPDATE users
        SET usuario = @usuario,
            rol = @rol,
            password_hash = HASHBYTES('SHA2_256', CONVERT(VARBINARY(256), @nuevo_password))
        WHERE id = @user_id;
    END
    ELSE
    BEGIN
        UPDATE users
        SET usuario = @usuario,
            rol = @rol
        WHERE id = @user_id;
    END
END;
GO
