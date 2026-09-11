/* sp_get_customers
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
-- =============================================
-- Author:		<David>
-- Create date: <12-02-2025>
-- Description:	<Store procedures para obtener todos los customers>
-- =============================================
CREATE OR ALTER PROCEDURE sp_get_customers
AS
BEGIN
	SELECT
		*
	FROM
		customers AS c
END
GO
