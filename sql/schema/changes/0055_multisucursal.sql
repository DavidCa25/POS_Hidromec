/* ============================================================
   0055 — MultiSucursal (esquema)

   products.corporate      1 = lo administra la matriz (llegó en el catálogo
                           corporativo). En la sucursal, nombre, código,
                           categoría e impuestos no se editan; el precio solo
                           si la empresa lo permite. Inventario y costo siguen
                           siendo de la sucursal.
   products.corporate_price / corporate_sellable
                           lo que dijo la matriz (precio y si se vende).
   products.corporate_override / corporate_available
                           la excepción de ESTA sucursal (precio especial,
                           «no se vende aquí»). Con las cuatro se recalcula el
                           precio efectivo sin perder nada cuando cambia solo
                           el catálogo o solo las excepciones.
   users.corporate         1 = usuario de empresa recibido de la matriz.
   users.corporate_scope   EN LA MATRIZ: a qué sucursales viaja este usuario.
                           NULL = solo aquí; ["*"] = todas; o los ids de
                           sucursal de la nube.
   stock_transfers.kind    + BRANCH_OUT / BRANCH_IN: traspasos entre sucursales
                           (event_location_uuid guarda la otra sucursal).

   Aditiva: nada existente cambia de significado.
   ============================================================ */
IF COL_LENGTH('dbo.products', 'corporate') IS NULL
    ALTER TABLE dbo.products ADD corporate BIT NOT NULL CONSTRAINT DF_products_corporate DEFAULT ((0));
IF COL_LENGTH('dbo.products', 'corporate_price') IS NULL
    ALTER TABLE dbo.products ADD corporate_price DECIMAL(10, 2) NULL, corporate_sellable BIT NULL,
                                 corporate_override DECIMAL(10, 2) NULL, corporate_available BIT NULL;
IF COL_LENGTH('dbo.users', 'corporate') IS NULL
    ALTER TABLE dbo.users ADD corporate BIT NOT NULL CONSTRAINT DF_users_corporate DEFAULT ((0));
IF COL_LENGTH('dbo.users', 'corporate_scope') IS NULL
    ALTER TABLE dbo.users ADD corporate_scope NVARCHAR(MAX) COLLATE Modern_Spanish_CI_AS NULL;
GO

IF OBJECT_ID(N'dbo.CK_users_corporate_scope', 'C') IS NULL
    ALTER TABLE dbo.users WITH CHECK ADD CONSTRAINT CK_users_corporate_scope CHECK (corporate_scope IS NULL OR ISJSON(corporate_scope) = 1);

IF OBJECT_ID(N'dbo.CK_stock_transfers_kind', 'C') IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = N'CK_stock_transfers_kind' AND definition LIKE N'%BRANCH_OUT%')
    ALTER TABLE dbo.stock_transfers DROP CONSTRAINT CK_stock_transfers_kind;
IF OBJECT_ID(N'dbo.CK_stock_transfers_kind', 'C') IS NULL
    ALTER TABLE dbo.stock_transfers WITH CHECK ADD CONSTRAINT CK_stock_transfers_kind
        CHECK ([kind] = 'RETURN_IN' OR [kind] = 'OUT' OR [kind] = 'BRANCH_OUT' OR [kind] = 'BRANCH_IN');
GO
