/* ============================================================================
   0052 — FASE 2: CATÁLOGO PUBLICABLE Y TRANSFERENCIAS SUCURSAL <-> EVENTO
   ----------------------------------------------------------------------------
   Aditiva y reejecutable. No borra ni reescribe datos existentes.

   1. UUID EN EL CATÁLOGO (solo lo que cruza a la tablet)
      Un EVENT (feria) vende con el catálogo de su sucursal base. La tablet no
      conoce los ids locales de esta base: producto, receta, grupo y opción de
      modificador, y categoría llevan un UUID estable. La PK local se queda.

   2. TRANSFERENCIAS (stock_transfers / stock_transfer_lines)
      La sucursal es la autoridad de SU inventario. Mandar mercancía a una
      feria es una SALIDA aquí (TRANSFER_OUT) y una ENTRADA allá
      (TRANSFER_IN); recibir el sobrante es la inversa (RETURN_TRANSFER_IN).
      Se guarda lo ENVIADO y lo RECIBIDO por separado: si salen 40 y llegan
      39, la diferencia queda a la vista, no se maquilla.

        kind     OUT        esta sucursal manda a un evento
                 RETURN_IN  esta sucursal recibe lo que regresa de un evento
        status   SENT       salió de aquí (OUT) / la tablet ya lo mandó (RETURN_IN)
                 RECEIVED   la contraparte confirmó (con lo que realmente llegó)
                 CANCELLED  anulada antes de recibirse (se revierte el stock)

      `uuid` es el mismo en la sucursal, en la nube y en la tablet: es lo que
      hace idempotente recibir dos veces la misma transferencia.

   RECUPERACIÓN: tablas nuevas y columnas con default; revertir es dejarlas
   sin uso. Las transferencias ya hechas siguen explicando el stock por sus
   movimientos en `inventory_movements` (source TRANSFER_OUT / RETURN_TRANSFER_IN).
   ========================================================================== */

/* ---------------------------------------------------------------- 1 */
IF COL_LENGTH('dbo.products', 'uuid') IS NULL
    ALTER TABLE dbo.products ADD uuid UNIQUEIDENTIFIER NOT NULL CONSTRAINT DF_products_uuid DEFAULT NEWID();
IF COL_LENGTH('dbo.recipes', 'uuid') IS NULL
    ALTER TABLE dbo.recipes ADD uuid UNIQUEIDENTIFIER NOT NULL CONSTRAINT DF_recipes_uuid DEFAULT NEWID();
IF COL_LENGTH('dbo.modifier_groups', 'uuid') IS NULL
    ALTER TABLE dbo.modifier_groups ADD uuid UNIQUEIDENTIFIER NOT NULL CONSTRAINT DF_modifier_groups_uuid DEFAULT NEWID();
IF COL_LENGTH('dbo.modifier_options', 'uuid') IS NULL
    ALTER TABLE dbo.modifier_options ADD uuid UNIQUEIDENTIFIER NOT NULL CONSTRAINT DF_modifier_options_uuid DEFAULT NEWID();
IF COL_LENGTH('dbo.CAT_categories', 'uuid') IS NULL
    ALTER TABLE dbo.CAT_categories ADD uuid UNIQUEIDENTIFIER NOT NULL CONSTRAINT DF_CAT_categories_uuid DEFAULT NEWID();
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'UX_products_uuid' AND object_id = OBJECT_ID(N'dbo.products'))
    CREATE UNIQUE NONCLUSTERED INDEX UX_products_uuid ON dbo.products (uuid);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'UX_recipes_uuid' AND object_id = OBJECT_ID(N'dbo.recipes'))
    CREATE UNIQUE NONCLUSTERED INDEX UX_recipes_uuid ON dbo.recipes (uuid);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'UX_modifier_groups_uuid' AND object_id = OBJECT_ID(N'dbo.modifier_groups'))
    CREATE UNIQUE NONCLUSTERED INDEX UX_modifier_groups_uuid ON dbo.modifier_groups (uuid);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'UX_modifier_options_uuid' AND object_id = OBJECT_ID(N'dbo.modifier_options'))
    CREATE UNIQUE NONCLUSTERED INDEX UX_modifier_options_uuid ON dbo.modifier_options (uuid);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'UX_CAT_categories_uuid' AND object_id = OBJECT_ID(N'dbo.CAT_categories'))
    CREATE UNIQUE NONCLUSTERED INDEX UX_CAT_categories_uuid ON dbo.CAT_categories (uuid);
GO

/* ---------------------------------------------------------------- 2 */
IF OBJECT_ID(N'dbo.stock_transfers', 'U') IS NULL
BEGIN
CREATE TABLE dbo.stock_transfers (
    id                   INT IDENTITY(1, 1) NOT NULL,
    uuid                 UNIQUEIDENTIFIER NOT NULL CONSTRAINT DF_stock_transfers_uuid DEFAULT NEWID(),
    kind                 VARCHAR(12) NOT NULL,
    status               VARCHAR(12) NOT NULL,
    event_location_uuid  UNIQUEIDENTIFIER NOT NULL,
    event_name           NVARCHAR(120) NULL,
    note                 NVARCHAR(255) NULL,
    created_by           INT NOT NULL,
    created_at           DATETIME2(0) NOT NULL CONSTRAINT DF_stock_transfers_created_at DEFAULT SYSDATETIME(),
    created_machine_name NVARCHAR(120) NULL,
    received_by          INT NULL,
    received_at          DATETIME2(0) NULL,
    cancelled_at         DATETIME2(0) NULL,
    manifest_signature   NVARCHAR(200) NULL,
    rv                   ROWVERSION NOT NULL,
    CONSTRAINT PK_stock_transfers PRIMARY KEY CLUSTERED (id),
    CONSTRAINT CK_stock_transfers_kind CHECK (kind IN ('OUT', 'RETURN_IN')),
    CONSTRAINT CK_stock_transfers_status CHECK (status IN ('SENT', 'RECEIVED', 'CANCELLED')),
    CONSTRAINT FK_stock_transfers_created_by FOREIGN KEY (created_by) REFERENCES dbo.users (id)
);
END;
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'UX_stock_transfers_uuid' AND object_id = OBJECT_ID(N'dbo.stock_transfers'))
    CREATE UNIQUE NONCLUSTERED INDEX UX_stock_transfers_uuid ON dbo.stock_transfers (uuid);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_stock_transfers_rv' AND object_id = OBJECT_ID(N'dbo.stock_transfers'))
    CREATE NONCLUSTERED INDEX IX_stock_transfers_rv ON dbo.stock_transfers (rv);
GO

IF OBJECT_ID(N'dbo.stock_transfer_lines', 'U') IS NULL
BEGIN
CREATE TABLE dbo.stock_transfer_lines (
    id            INT IDENTITY(1, 1) NOT NULL,
    transfer_id   INT NOT NULL,
    product_id    INT NOT NULL,
    qty_sent      DECIMAL(12, 2) NOT NULL,
    qty_received  DECIMAL(12, 2) NULL,
    CONSTRAINT PK_stock_transfer_lines PRIMARY KEY CLUSTERED (id),
    CONSTRAINT FK_stock_transfer_lines_transfer FOREIGN KEY (transfer_id) REFERENCES dbo.stock_transfers (id),
    CONSTRAINT FK_stock_transfer_lines_product FOREIGN KEY (product_id) REFERENCES dbo.products (id),
    CONSTRAINT CK_stock_transfer_lines_qty CHECK (qty_sent >= 0 AND (qty_received IS NULL OR qty_received >= 0))
);
END;
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_stock_transfer_lines_transfer' AND object_id = OBJECT_ID(N'dbo.stock_transfer_lines'))
    CREATE NONCLUSTERED INDEX IX_stock_transfer_lines_transfer ON dbo.stock_transfer_lines (transfer_id);
GO
