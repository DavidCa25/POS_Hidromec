/* sp_upsert_product_supplier
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
-- =============================================
-- Author:		<David Casillas>
-- Create date: <30-12-2025>
-- Description:	<Re insertar Proveedores por producto>
-- =============================================
CREATE OR ALTER PROCEDURE dbo.sp_upsert_product_supplier
  @product_id  INT,
  @supplier_id INT,
  @is_default  BIT = 0,
  @last_cost   DECIMAL(10,2) = NULL,
  @active      BIT = 1
AS
BEGIN
  SET NOCOUNT ON;

  BEGIN TRY
    BEGIN TRAN;

    IF NOT EXISTS (SELECT 1 FROM dbo.products WHERE id = @product_id)
      THROW 50001, 'Producto no existe.', 1;

    IF NOT EXISTS (SELECT 1 FROM dbo.CAT_suppliers WHERE id = @supplier_id)
      THROW 50002, 'Proveedor no existe.', 1;

    IF EXISTS (
      SELECT 1 FROM dbo.product_suppliers
      WHERE product_id = @product_id AND supplier_id = @supplier_id
    )
    BEGIN
      UPDATE dbo.product_suppliers
         SET is_default = CASE WHEN @is_default = 1 THEN 1 ELSE is_default END,
             last_cost  = COALESCE(@last_cost, last_cost),
             active     = @active,
             updated_at = SYSDATETIME()
       WHERE product_id = @product_id
         AND supplier_id = @supplier_id;
    END
    ELSE
    BEGIN
      INSERT INTO dbo.product_suppliers
        (product_id, supplier_id, is_default, last_cost, active, created_at, updated_at)
      VALUES
        (@product_id, @supplier_id, @is_default, @last_cost, @active, SYSDATETIME(), NULL);
    END

    IF @is_default = 1
    BEGIN
      UPDATE dbo.product_suppliers
         SET is_default = 0,
             updated_at = SYSDATETIME()
       WHERE product_id = @product_id
         AND supplier_id <> @supplier_id;
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
