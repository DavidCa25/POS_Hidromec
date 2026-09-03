/* sp_add_supplier
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
CREATE OR ALTER PROCEDURE dbo.sp_add_supplier
  @nombre NVARCHAR(150)
AS
BEGIN
  SET NOCOUNT ON;

  SET @nombre = LTRIM(RTRIM(@nombre));

  IF (@nombre IS NULL OR @nombre = '')
  BEGIN
    RAISERROR('El nombre del proveedor es obligatorio.', 16, 1);
    RETURN;
  END;

  IF EXISTS (SELECT 1 FROM dbo.CAT_suppliers WHERE LTRIM(RTRIM(nombre)) = @nombre)
  BEGIN
    RAISERROR('Ya existe un proveedor con ese nombre.', 16, 1);
    RETURN;
  END;

  INSERT INTO dbo.CAT_suppliers (nombre)
  VALUES (@nombre);

  SELECT SCOPE_IDENTITY() AS id;
END
GO
