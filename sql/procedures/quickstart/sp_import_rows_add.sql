/* sp_import_rows_add
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
CREATE OR ALTER PROCEDURE dbo.sp_import_rows_add
    @batch_id INT,
    @Rows dbo.ImportRowType READONLY
AS
BEGIN
    SET NOCOUNT ON;
    INSERT INTO dbo.import_rows
      (batch_id, fila, crudo_json, tipo, part_number, nombre, price, cost, stock,
       bar_code, category_name, brand_name, base_uom, clave_prod_serv, clave_unidad,
       tasa_iva, duration_minutes, schedulable, default_commission_pct,
       accion, match_product_id, match_motivo, problemas_json, inventory_mode, sellable)
    SELECT @batch_id, ISNULL(fila, 0), crudo_json, ISNULL(tipo,'PRODUCTO'),
           part_number, nombre, price, cost, stock,
           bar_code, category_name, brand_name, base_uom, clave_prod_serv, clave_unidad,
           tasa_iva, duration_minutes, schedulable, default_commission_pct,
           ISNULL(accion,'PENDIENTE'), match_product_id, match_motivo, problemas_json,
           inventory_mode, sellable
      FROM @Rows;

    SELECT @@ROWCOUNT AS insertadas;
END
GO
