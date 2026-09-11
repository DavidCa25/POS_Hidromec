/* 0003 — sale contract v2
 *
 * Ajustes de esquema para la venta con recetas y modificadores:
 *
 *   inventory_movements.sold_product_id  que producto VENDIDO causo el consumo
 *   inventory_movements.units            cuantas unidades vendidas cubre el movimiento
 *     Con esto una devolucion repone exactamente lo que ESA venta consumio
 *     (quantity / units por unidad devuelta), sin recalcular la receta de hoy,
 *     y sobrevive aunque la linea de venta se reduzca o se borre.
 *
 *   FK_inventory_movements_sale_detail   ON DELETE SET NULL
 *   FK_sale_detail_modifiers_detail      ON DELETE CASCADE
 *     sp_update_sale y sp_refund_sale (apply_net_update) borran/recrean
 *     lineas de sale_detail; las referencias no deben impedirlo.
 */

IF COL_LENGTH('dbo.inventory_movements', 'sold_product_id') IS NULL
    ALTER TABLE dbo.inventory_movements ADD sold_product_id INT NULL;
GO
IF COL_LENGTH('dbo.inventory_movements', 'units') IS NULL
    ALTER TABLE dbo.inventory_movements ADD units DECIMAL(12, 2) NULL;
GO

IF EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = N'FK_inventory_movements_sale_detail' AND delete_referential_action_desc <> 'SET_NULL')
    ALTER TABLE dbo.inventory_movements DROP CONSTRAINT FK_inventory_movements_sale_detail;
GO
IF OBJECT_ID(N'dbo.FK_inventory_movements_sale_detail', 'F') IS NULL
    ALTER TABLE dbo.inventory_movements WITH CHECK ADD CONSTRAINT FK_inventory_movements_sale_detail
        FOREIGN KEY (sale_detail_id) REFERENCES dbo.sale_detail (id) ON DELETE SET NULL;
GO

IF EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = N'FK_sale_detail_modifiers_detail' AND delete_referential_action_desc <> 'CASCADE')
    ALTER TABLE dbo.sale_detail_modifiers DROP CONSTRAINT FK_sale_detail_modifiers_detail;
GO
IF OBJECT_ID(N'dbo.FK_sale_detail_modifiers_detail', 'F') IS NULL
    ALTER TABLE dbo.sale_detail_modifiers WITH CHECK ADD CONSTRAINT FK_sale_detail_modifiers_detail
        FOREIGN KEY (sale_detail_id) REFERENCES dbo.sale_detail (id) ON DELETE CASCADE;
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_inventory_movements_sale_ref' AND object_id = OBJECT_ID(N'dbo.inventory_movements'))
    CREATE NONCLUSTERED INDEX IX_inventory_movements_sale_ref ON dbo.inventory_movements (reference, sold_product_id) INCLUDE (product_id, quantity, units, source);
