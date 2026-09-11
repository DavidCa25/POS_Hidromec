/* sp_set_product_default_supplier
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
-- =============================================
-- Author:		<David Casillas>
-- Create date: <30-12-2025>
-- Description:	<Insertar Proveedor por default>
-- =============================================
CREATE OR ALTER PROCEDURE dbo.sp_set_product_default_supplier
  @product_id  INT,
  @supplier_id INT
AS
BEGIN
  SET NOCOUNT ON;

  BEGIN TRY
    BEGIN TRAN;

    IF NOT EXISTS (SELECT 1 FROM dbo.products WHERE id = @product_id)
      THROW 50001, 'Producto no existe.', 1;

    IF NOT EXISTS (SELECT 1 FROM dbo.CAT_suppliers WHERE id = @supplier_id)
      THROW 50002, 'Proveedor no existe.', 1;

    -- Asegurar que exista el vínculo
    IF NOT EXISTS (
      SELECT 1 FROM dbo.product_suppliers
      WHERE product_id = @product_id AND supplier_id = @supplier_id
    )
    BEGIN
      INSERT INTO dbo.product_suppliers
        (product_id, supplier_id, is_default, last_cost, active, created_at, updated_at)
      VALUES
        (@product_id, @supplier_id, 0, NULL, 1, SYSDATETIME(), NULL);
    END
    ELSE
    BEGIN
      -- reactivar si estaba apagado
      UPDATE dbo.product_suppliers
         SET active = 1,
             updated_at = SYSDATETIME()
       WHERE product_id = @product_id AND supplier_id = @supplier_id;
    END

    -- Marcar default
    UPDATE dbo.product_suppliers
       SET is_default = CASE WHEN supplier_id = @supplier_id THEN 1 ELSE 0 END,
           updated_at = SYSDATETIME()
     WHERE product_id = @product_id;

    COMMIT;

    EXEC dbo.sp_get_product_suppliers @product_id = @product_id, @only_active = 0;

  END TRY
  BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK;
    THROW;
  END CATCH
END
GO
