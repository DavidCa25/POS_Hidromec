/* ============================================================
   0060 — Producción por tandas (esquema)

   Para lo que se FABRICA antes de venderse (donas, pan, galletas): el
   producto terminado es DIRECT -tiene existencia, se cuenta, se traspasa- y
   los ingredientes se descuentan AL FABRICAR, no al vender.

   production_formulas        La fórmula de un producto DIRECT: para cuántas
   production_formula_lines   piezas es (rendimiento) y qué lleva. Vive APARTE
                              de `recipes`: el motor de la venta
                              (sp_resolver_receta_efectiva) nunca la lee, así
                              que un producto fabricado no puede consumir sus
                              ingredientes dos veces.
   production_batches         Una tanda: planeada -> en preparación -> lista
                              (o cancelada). Quién, cuándo, en qué caja, lo
                              planeado, lo que salió bueno, la merma con su
                              motivo y el costo congelado.
   production_batch_consumption
                              Lo que la tanda consumió DE VERDAD al empezar,
                              con el costo de ese momento. La fórmula puede
                              cambiar después; esto no.
   production_waste           Merma de producto TERMINADO: lo que ya estaba a la
                              venta y se tiró (no se vendió, se cayó, caducó).
                              Sale del inventario con su motivo y su costo. La
                              merma DE PRODUCCIÓN (lo que no salió bueno de una
                              tanda) vive en la tanda: nunca entró.

   Lo preparado al momento (café, frappé) sigue siendo RECIPE: no cambia.
   Aditiva: nada existente cambia de significado.
   ============================================================ */
IF OBJECT_ID(N'dbo.production_formulas', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.production_formulas (
        product_id  INT            NOT NULL,
        yield_qty   DECIMAL(12, 2) NOT NULL CONSTRAINT DF_production_formulas_yield DEFAULT (1),
        notes       NVARCHAR(300)  COLLATE Modern_Spanish_CI_AS NULL,
        updated_by  INT            NULL,
        updated_at  DATETIME2(0)   NOT NULL CONSTRAINT DF_production_formulas_updated_at DEFAULT (SYSDATETIME()),
        CONSTRAINT PK_production_formulas PRIMARY KEY CLUSTERED (product_id),
        CONSTRAINT FK_production_formulas_product FOREIGN KEY (product_id) REFERENCES dbo.products (id),
        CONSTRAINT CK_production_formulas_yield CHECK (yield_qty > 0)
    );
END;

IF OBJECT_ID(N'dbo.production_formula_lines', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.production_formula_lines (
        product_id            INT            NOT NULL,
        ingredient_product_id INT            NOT NULL,
        qty_base              DECIMAL(14, 4) NOT NULL,
        input_qty             DECIMAL(12, 3) NOT NULL,
        input_uom             NVARCHAR(10)   COLLATE Modern_Spanish_CI_AS NOT NULL,
        waste_pct             DECIMAL(5, 2)  NOT NULL CONSTRAINT DF_production_formula_lines_waste DEFAULT (0),
        sort_order            INT            NOT NULL CONSTRAINT DF_production_formula_lines_sort DEFAULT (0),
        CONSTRAINT PK_production_formula_lines PRIMARY KEY CLUSTERED (product_id, ingredient_product_id),
        CONSTRAINT FK_production_formula_lines_formula FOREIGN KEY (product_id) REFERENCES dbo.production_formulas (product_id) ON DELETE CASCADE,
        CONSTRAINT FK_production_formula_lines_ingredient FOREIGN KEY (ingredient_product_id) REFERENCES dbo.products (id),
        CONSTRAINT CK_production_formula_lines_qty CHECK (qty_base > 0 AND input_qty > 0),
        CONSTRAINT CK_production_formula_lines_waste CHECK (waste_pct >= 0 AND waste_pct <= 100),
        CONSTRAINT CK_production_formula_lines_self CHECK (ingredient_product_id <> product_id)
    );
END;

IF OBJECT_ID(N'dbo.production_batches', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.production_batches (
        id              INT              IDENTITY(1, 1) NOT NULL,
        uuid            UNIQUEIDENTIFIER NOT NULL CONSTRAINT DF_production_batches_uuid DEFAULT (NEWID()),
        product_id      INT              NOT NULL,
        status          VARCHAR(12)      NOT NULL CONSTRAINT DF_production_batches_status DEFAULT ('PLANNED'),
        production_date DATE             NOT NULL,
        planned_qty     DECIMAL(12, 2)   NOT NULL,
        good_qty        DECIMAL(12, 2)   NULL,
        waste_qty       DECIMAL(12, 2)   NULL,
        waste_reason    NVARCHAR(40)     COLLATE Modern_Spanish_CI_AS NULL,
        total_cost      DECIMAL(14, 4)   NULL,
        unit_cost       DECIMAL(14, 4)   NULL,
        note            NVARCHAR(255)    COLLATE Modern_Spanish_CI_AS NULL,
        machine_name    NVARCHAR(120)    COLLATE Modern_Spanish_CI_AS NULL,
        created_by      INT              NOT NULL,
        created_at      DATETIME2(0)     NOT NULL CONSTRAINT DF_production_batches_created_at DEFAULT (SYSDATETIME()),
        started_by      INT              NULL,
        started_at      DATETIME2(0)     NULL,
        finished_by     INT              NULL,
        finished_at     DATETIME2(0)     NULL,
        cancelled_by    INT              NULL,
        cancelled_at    DATETIME2(0)     NULL,
        row_version     ROWVERSION       NOT NULL,
        CONSTRAINT PK_production_batches PRIMARY KEY CLUSTERED (id),
        CONSTRAINT UQ_production_batches_uuid UNIQUE (uuid),
        CONSTRAINT FK_production_batches_product FOREIGN KEY (product_id) REFERENCES dbo.products (id),
        CONSTRAINT FK_production_batches_created_by FOREIGN KEY (created_by) REFERENCES dbo.users (id),
        CONSTRAINT FK_production_batches_started_by FOREIGN KEY (started_by) REFERENCES dbo.users (id),
        CONSTRAINT FK_production_batches_finished_by FOREIGN KEY (finished_by) REFERENCES dbo.users (id),
        CONSTRAINT FK_production_batches_cancelled_by FOREIGN KEY (cancelled_by) REFERENCES dbo.users (id),
        CONSTRAINT CK_production_batches_status CHECK (status IN ('PLANNED', 'IN_PROGRESS', 'DONE', 'CANCELLED')),
        CONSTRAINT CK_production_batches_planned CHECK (planned_qty > 0),
        CONSTRAINT CK_production_batches_good CHECK (good_qty IS NULL OR good_qty >= 0),
        CONSTRAINT CK_production_batches_waste CHECK (waste_qty IS NULL OR waste_qty >= 0)
    );
    CREATE NONCLUSTERED INDEX IX_production_batches_date ON dbo.production_batches (production_date, status);
END;

IF OBJECT_ID(N'dbo.production_waste', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.production_waste (
        id           INT              IDENTITY(1, 1) NOT NULL,
        uuid         UNIQUEIDENTIFIER NOT NULL CONSTRAINT DF_production_waste_uuid DEFAULT (NEWID()),
        product_id   INT              NOT NULL,
        waste_date   DATE             NOT NULL,
        qty          DECIMAL(12, 2)   NOT NULL,
        reason       NVARCHAR(40)     COLLATE Modern_Spanish_CI_AS NOT NULL,
        unit_cost    DECIMAL(14, 4)   NULL,
        machine_name NVARCHAR(120)    COLLATE Modern_Spanish_CI_AS NULL,
        created_by   INT              NOT NULL,
        created_at   DATETIME2(0)     NOT NULL CONSTRAINT DF_production_waste_created_at DEFAULT (SYSDATETIME()),
        row_version  ROWVERSION       NOT NULL,
        CONSTRAINT PK_production_waste PRIMARY KEY CLUSTERED (id),
        CONSTRAINT UQ_production_waste_uuid UNIQUE (uuid),
        CONSTRAINT FK_production_waste_product FOREIGN KEY (product_id) REFERENCES dbo.products (id),
        CONSTRAINT FK_production_waste_created_by FOREIGN KEY (created_by) REFERENCES dbo.users (id),
        CONSTRAINT CK_production_waste_qty CHECK (qty > 0)
    );
    CREATE NONCLUSTERED INDEX IX_production_waste_date ON dbo.production_waste (waste_date);
END;

IF OBJECT_ID(N'dbo.production_batch_consumption', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.production_batch_consumption (
        batch_id              INT            NOT NULL,
        ingredient_product_id INT            NOT NULL,
        qty                   DECIMAL(14, 4) NOT NULL,
        unit_cost             DECIMAL(14, 4) NOT NULL,
        CONSTRAINT PK_production_batch_consumption PRIMARY KEY CLUSTERED (batch_id, ingredient_product_id),
        CONSTRAINT FK_production_batch_consumption_batch FOREIGN KEY (batch_id) REFERENCES dbo.production_batches (id),
        CONSTRAINT FK_production_batch_consumption_ingredient FOREIGN KEY (ingredient_product_id) REFERENCES dbo.products (id)
    );
END;
GO
