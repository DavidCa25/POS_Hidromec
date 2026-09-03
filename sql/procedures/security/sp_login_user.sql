/* sp_login_user
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




CREATE OR ALTER PROCEDURE sp_login_user
    @username NVARCHAR(50),
    @password NVARCHAR(255)
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @hashed_password NVARCHAR(255);
    SET @hashed_password = CONVERT(NVARCHAR(255), HASHBYTES('SHA2_256', @password), 2);

    SELECT id, usuario, rol, active, creation_date
    FROM users
    WHERE usuario = @username
      AND password_hash = @hashed_password
      AND active = 1;
END;
GO
