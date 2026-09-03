/* sp_remove_product_supplier
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
-- =============================================
-- Author:		<David Casillas>
-- Create date: <30-12-2025>
-- Description:	<Eliminar Proveedor por producto>
-- =============================================
CREATE OR ALTER PROCEDURE dbo.sp_remove_product_supplier
  @product_id  INT,
  @supplier_id INT
AS
BEGIN
  SET NOCOUNT ON;

  BEGIN TRY
    BEGIN TRAN;

    DECLARE @was_default BIT = 0;

    SELECT @was_default = is_default
    FROM dbo.product_suppliers
    WHERE product_id = @product_id AND supplier_id = @supplier_id;

    UPDATE dbo.product_suppliers
       SET active = 0,
           is_default = 0,
           updated_at = SYSDATETIME()
     WHERE product_id = @product_id
       AND supplier_id = @supplier_id;

    IF @was_default = 1
    BEGIN
      DECLARE @new_default INT;

      SELECT TOP 1 @new_default = supplier_id
      FROM dbo.product_suppliers
      WHERE product_id = @product_id AND active = 1
      ORDER BY supplier_id;

      IF @new_default IS NOT NULL
      BEGIN
        UPDATE dbo.product_suppliers
           SET is_default = CASE WHEN supplier_id = @new_default THEN 1 ELSE 0 END,
               updated_at = SYSDATETIME()
         WHERE product_id = @product_id;
      END
    END

    COMMIT;

    EXEC dbo.sp_get_product_suppliers @product_id = @product_id, @only_active = 0;

  END TRY
  BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK;
    THROW;
  END CATCH
END
GO
