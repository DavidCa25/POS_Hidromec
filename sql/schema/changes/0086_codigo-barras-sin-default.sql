/* ============================================================
   0086 — Código de barras sin valor por omisión (esquema)

   products.bar_code nació con DEFAULT ('7855745585855'). Todo alta que no
   manda el código —un servicio (sp_service_save), un producto dado de alta
   por otro camino— se quedaba con ESE código. Con dos productos así:

     - editar cualquiera de ellos fallaba con «Ese codigo de barras ya esta
       asignado a otro producto» (Inventario y el asistente mandan la ficha
       completa), y
     - escanear 7855745585855 agregaba uno de ellos al azar.

   Se quita el DEFAULT y, solo donde ese código está REPETIDO, se deja vacío
   (NULL). Si un único producto lo tiene, se respeta: puede ser su código.
   Idempotente.
   ============================================================ */
DECLARE @df SYSNAME = (
  SELECT d.name FROM sys.default_constraints d
    JOIN sys.columns c ON c.object_id = d.parent_object_id AND c.column_id = d.parent_column_id
   WHERE d.parent_object_id = OBJECT_ID(N'dbo.products') AND c.name = N'bar_code');
IF @df IS NOT NULL
BEGIN
  DECLARE @quitar NVARCHAR(400) = N'ALTER TABLE dbo.products DROP CONSTRAINT ' + QUOTENAME(@df);
  EXEC sp_executesql @quitar;
END;

IF (SELECT COUNT(*) FROM dbo.products WHERE bar_code = N'7855745585855') > 1
  UPDATE dbo.products SET bar_code = NULL WHERE bar_code = N'7855745585855';
GO
