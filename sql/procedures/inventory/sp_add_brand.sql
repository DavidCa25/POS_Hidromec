/* sp_add_brand
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
-- =============================================
-- Author:		<David Casillas>
-- Create date: <30-12-2025>
-- Description:	<Agregar marca>
-- =============================================
CREATE OR ALTER PROCEDURE sp_add_brand
	@namee NVARCHAR(100)
AS
BEGIN
	SET NOCOUNT ON;

	SET @namee = LTRIM(RTRIM(@namee));

	  IF (@namee IS NULL OR @namee = '')
	  BEGIN
		RAISERROR('El nombre de la brand es obligatorio.', 16, 1);
		RETURN;
	  END;

	  IF EXISTS (SELECT 1 FROM dbo.CAT_brands WHERE LTRIM(RTRIM(namee)) = @namee)
	  BEGIN
		RAISERROR('Ya existe una brand con ese nombre.', 16, 1);
		RETURN;
	  END;

	INSERT INTO dbo.CAT_brands (namee)
	VALUES (@namee);
END
GO
