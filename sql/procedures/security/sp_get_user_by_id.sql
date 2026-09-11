/* sp_get_user_by_id
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
-- =============================================
-- Author:		<David>
-- Create date: <14-08-2025>
-- Description:	<Get users by id>
-- =============================================
CREATE OR ALTER PROCEDURE sp_get_user_by_id
	@userID INT
AS
BEGIN
	SET NOCOUNT ON;

    SELECT
		u.usuario,
		u.rol
	FROM users AS u
	WHERE
		id = @userID
END
GO
