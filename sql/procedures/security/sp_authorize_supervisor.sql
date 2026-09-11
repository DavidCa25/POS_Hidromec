/* sp_authorize_supervisor
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* 3) Autorizar supervisor (valida usuario+contraseña con rol admin/supervisor) */
CREATE OR ALTER PROCEDURE dbo.sp_authorize_supervisor
    @usuario NVARCHAR(50), @password NVARCHAR(255)
AS
BEGIN
    SET NOCOUNT ON;
    SELECT TOP 1 id, usuario, rol
    FROM dbo.users
    WHERE usuario = @usuario
      AND active = 1
      AND rol IN ('admin', 'supervisor')
      AND password_hash = CONVERT(NVARCHAR(255), HASHBYTES('SHA2_256', @password), 2);
END
GO
