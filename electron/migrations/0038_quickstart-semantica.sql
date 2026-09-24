/* ============================================================
   0038 — QuickStart: cada cosa entra como lo que es

   QUE SE VIO EN QA
   ----------------
   Con un catalogo de cafeteria, QuickStart invirtio la semantica:

     · «Cafe en grano» —un INGREDIENTE— entro como articulo vendible, pidio
       precio de venta y acabo a la venta a $12 con 5000 g de existencia.
     · «Cafe Americano» —un PRODUCTO DE MENU— entro como mercancia DIRECT
       con stock 0, asi que la caja lo daba por agotado.

   Las dos al reves, y no por falta de modelo: `products.inventory_mode` y
   `products.sellable` ya distinguian las dos cosas, y las consultas del
   dominio ya las respetaban. El importador simplemente no las escribia.

   QUE CAMBIA AQUI
   ---------------
   1. `import_rows.tipo` admite MENU y MATERIAL, que faltaban.
   2. Cada fila lleva el `inventory_mode` y el `sellable` con los que va a
      nacer. Se decide al planificar y se guarda: asi la pantalla puede
      enseñarlo ANTES de importar, y el ejecutor no tiene que volver a
      deducirlo.
   3. El ejecutor deja de suponer DIRECT/vendible para todo.

   NO se inventa ninguna tabla ni ninguna taxonomia nueva: se escriben las
   dos columnas que Wybix ya leia.
   ============================================================ */

IF OBJECT_ID(N'dbo.CK_import_rows_tipo', 'C') IS NOT NULL
    ALTER TABLE dbo.import_rows DROP CONSTRAINT CK_import_rows_tipo;
GO

ALTER TABLE dbo.import_rows WITH CHECK ADD CONSTRAINT CK_import_rows_tipo
  CHECK (tipo IN ('PRODUCTO', 'INGREDIENTE', 'MENU', 'SERVICIO', 'MATERIAL'));
GO

/* Con que va a nacer la fila. Se decide una vez, al planificar. */
IF COL_LENGTH('dbo.import_rows', 'inventory_mode') IS NULL
    ALTER TABLE dbo.import_rows ADD inventory_mode NVARCHAR(10) NULL;
GO

IF COL_LENGTH('dbo.import_rows', 'sellable') IS NULL
    ALTER TABLE dbo.import_rows ADD sellable BIT NULL;
GO

IF OBJECT_ID(N'dbo.CK_import_rows_invmode', 'C') IS NULL
ALTER TABLE dbo.import_rows WITH CHECK ADD CONSTRAINT CK_import_rows_invmode
  CHECK (inventory_mode IS NULL OR inventory_mode IN ('DIRECT', 'RECIPE', 'NONE'));
GO

/* El tipo de tabla, con los dos campos nuevos. Un tipo no admite ALTER. */
IF TYPE_ID(N'dbo.ImportRowType') IS NOT NULL
BEGIN
    /* Los procedimientos que lo usan se recrean abajo, asi que se puede
       tirar y volver a crear sin dejar nada colgando. */
    DROP PROCEDURE IF EXISTS dbo.sp_import_rows_add;
    DROP TYPE dbo.ImportRowType;
END
GO

CREATE TYPE dbo.ImportRowType AS TABLE (
    fila INT NULL,
    crudo_json NVARCHAR(MAX) NULL,
    tipo NVARCHAR(12) NULL,
    part_number NVARCHAR(100) NULL,
    nombre NVARCHAR(200) NULL,
    price DECIMAL(10,2) NULL,
    cost DECIMAL(14,4) NULL,
    stock DECIMAL(12,2) NULL,
    bar_code NVARCHAR(60) NULL,
    category_name NVARCHAR(150) NULL,
    brand_name NVARCHAR(150) NULL,
    base_uom NVARCHAR(10) NULL,
    clave_prod_serv NVARCHAR(8) NULL,
    clave_unidad NVARCHAR(5) NULL,
    tasa_iva DECIMAL(5,4) NULL,
    duration_minutes INT NULL,
    schedulable BIT NULL,
    default_commission_pct DECIMAL(5,2) NULL,
    accion NVARCHAR(12) NULL,
    match_product_id INT NULL,
    match_motivo NVARCHAR(20) NULL,
    problemas_json NVARCHAR(MAX) NULL,
    inventory_mode NVARCHAR(10) NULL,
    sellable BIT NULL
);
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

/* ============================================================
   EL EJECUTOR, AHORA CONSCIENTE DEL TIPO
   ============================================================ */
CREATE OR ALTER PROCEDURE dbo.sp_import_execute_chunk
    @batch_id INT,
    @user_id INT = NULL,
    @tope INT = 300
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    DECLARE @ref NVARCHAR(50) = CONCAT('IMP-', @batch_id);
    DECLARE @lote TABLE (id INT PRIMARY KEY);

    /* Las guardas de tamano viven AQUI: lo que no cabe en `products` no se
       elige, y por lo tanto no puede abortar el lote de sus vecinas. */
    INSERT INTO @lote (id)
    SELECT TOP (@tope) r.id
      FROM dbo.import_rows r
     WHERE r.batch_id = @batch_id
       AND r.aplicada = 0
       AND r.accion IN ('CREATE','UPDATE')
       AND r.nombre IS NOT NULL
       AND LEN(r.nombre) <= 100
       AND (r.bar_code IS NULL OR LEN(r.bar_code) <= 50)
       AND (r.part_number IS NULL OR LEN(r.part_number) <= 100)
       AND (r.base_uom IS NULL OR EXISTS (SELECT 1 FROM dbo.uoms u WHERE u.code = r.base_uom))
     ORDER BY r.fila;

    IF NOT EXISTS (SELECT 1 FROM @lote)
    BEGIN
        SELECT 0 AS procesadas, 0 AS creadas, 0 AS actualizadas, 0 AS movimientos;
        RETURN;
    END

    DECLARE @creadas INT = 0, @actualizadas INT = 0, @movs INT = 0;

    BEGIN TRY
        BEGIN TRAN;

        /* -------------------------------------------- categorias y marcas
           `sp_get_active_products` une con INNER JOIN: un producto sin ellas
           existe y NO se puede vender. */
        INSERT INTO dbo.CAT_categories (namee)
        SELECT DISTINCT LTRIM(RTRIM(r.category_name))
          FROM dbo.import_rows r JOIN @lote l ON l.id = r.id
         WHERE NULLIF(LTRIM(RTRIM(ISNULL(r.category_name,''))),'') IS NOT NULL
           AND NOT EXISTS (SELECT 1 FROM dbo.CAT_categories c WHERE c.namee = LTRIM(RTRIM(r.category_name)));

        INSERT INTO dbo.CAT_brands (namee)
        SELECT DISTINCT LTRIM(RTRIM(r.brand_name))
          FROM dbo.import_rows r JOIN @lote l ON l.id = r.id
         WHERE NULLIF(LTRIM(RTRIM(ISNULL(r.brand_name,''))),'') IS NOT NULL
           AND NOT EXISTS (SELECT 1 FROM dbo.CAT_brands b WHERE b.namee = LTRIM(RTRIM(r.brand_name)));

        IF NOT EXISTS (SELECT 1 FROM dbo.CAT_categories WHERE namee = N'General')
            INSERT INTO dbo.CAT_categories (namee) VALUES (N'General');
        IF NOT EXISTS (SELECT 1 FROM dbo.CAT_brands WHERE namee = N'General')
            INSERT INTO dbo.CAT_brands (namee) VALUES (N'General');

        DECLARE @cat_gen INT = (SELECT id FROM dbo.CAT_categories WHERE namee = N'General');
        DECLARE @marca_gen INT = (SELECT id FROM dbo.CAT_brands WHERE namee = N'General');

        /* ------------------------------------------------------ UPDATE */
        UPDATE r
           SET previo_json = (
                 SELECT p.price AS price, p.cost AS cost, p.nombre AS nombre,
                        p.stock AS stock, p.bar_code AS bar_code
                   FROM dbo.products p WHERE p.id = r.match_product_id
                   FOR JSON PATH, WITHOUT_ARRAY_WRAPPER)
          FROM dbo.import_rows r JOIN @lote l ON l.id = r.id
         WHERE r.accion = 'UPDATE' AND r.match_product_id IS NOT NULL;

        UPDATE p
           SET p.price  = ISNULL(r.price, p.price),
               p.cost   = ISNULL(r.cost, p.cost),
               p.nombre = ISNULL(NULLIF(LTRIM(RTRIM(r.nombre)),''), p.nombre),
               p.bar_code = ISNULL(NULLIF(LTRIM(RTRIM(r.bar_code)),''), p.bar_code),
               p.category_id = ISNULL(p.category_id, @cat_gen),
               p.brand_id    = ISNULL(p.brand_id, @marca_gen)
          FROM dbo.products p
          JOIN dbo.import_rows r ON r.match_product_id = p.id
          JOIN @lote l ON l.id = r.id
         WHERE r.accion = 'UPDATE';

        SET @actualizadas = @@ROWCOUNT;

        UPDATE r SET applied_product_id = r.match_product_id
          FROM dbo.import_rows r JOIN @lote l ON l.id = r.id
         WHERE r.accion = 'UPDATE';

        /* ------------------------------------------------------ CREATE
           Aqui esta la correccion: `inventory_mode` y `sellable` salen de lo
           que la fila DICE SER, no de un valor por omision para todo.

             INGREDIENTE -> DIRECT, sellable 0   (se consume, no se vende)
             MENU        -> NONE,   sellable 1   (se vende; sin receta no se agota)
             SERVICIO    -> NONE,   sellable 1
             PRODUCTO    -> DIRECT, sellable 1
             MATERIAL    -> DIRECT, sellable 1
        */
        DECLARE @nuevos TABLE (product_id INT, row_id INT);

        MERGE dbo.products AS destino
        USING (
            SELECT r.id AS row_id,
                   CASE WHEN NULLIF(LTRIM(RTRIM(ISNULL(r.part_number,''))),'') IS NULL
                        THEN CONCAT('WBX-', @batch_id, '-', r.fila)
                        ELSE LTRIM(RTRIM(r.part_number)) END AS part_number,
                   LEFT(LTRIM(RTRIM(r.nombre)), 100) AS nombre,
                   ISNULL(r.price, 0) AS price,
                   r.cost, r.tipo,
                   /* Lo que decidio el planificador; si faltara, se deduce
                      del tipo, nunca se supone DIRECT para todo. */
                   ISNULL(r.inventory_mode,
                          CASE WHEN r.tipo IN ('SERVICIO','MENU') THEN 'NONE' ELSE 'DIRECT' END) AS modo,
                   ISNULL(r.sellable,
                          CASE WHEN r.tipo = 'INGREDIENTE' THEN 0 ELSE 1 END) AS vendible,
                   NULLIF(LTRIM(RTRIM(ISNULL(r.bar_code,''))),'') AS bar_code,
                   ISNULL((SELECT c.id FROM dbo.CAT_categories c WHERE c.namee = LTRIM(RTRIM(r.category_name))),
                          CASE WHEN r.tipo = 'SERVICIO'
                               THEN ISNULL((SELECT id FROM dbo.CAT_categories WHERE namee = N'Servicios'), @cat_gen)
                               ELSE @cat_gen END) AS category_id,
                   ISNULL((SELECT b.id FROM dbo.CAT_brands b WHERE b.namee = LTRIM(RTRIM(r.brand_name))), @marca_gen) AS brand_id,
                   r.clave_prod_serv, r.clave_unidad, r.tasa_iva,
                   ISNULL(r.base_uom, 'pza') AS base_uom,
                   /* Un ingrediente se mide en gramos o mililitros: fraccion
                      permitida. Una pieza no. */
                   CASE WHEN r.tipo = 'INGREDIENTE' THEN 1 ELSE 0 END AS decimales
              FROM dbo.import_rows r JOIN @lote l ON l.id = r.id
             WHERE r.accion = 'CREATE'
        ) AS origen
        ON (1 = 0)
        WHEN NOT MATCHED THEN
            INSERT (part_number, nombre, price, stock, active, category_id, brand_id, cost,
                    bar_code, clave_prod_serv, clave_unidad, objeto_impuesto, tasa_iva,
                    inventory_mode, sellable, base_uom, allow_decimal_qty)
            VALUES (origen.part_number, origen.nombre, origen.price, 0, 1,
                    origen.category_id, origen.brand_id, ISNULL(origen.cost, 0),
                    origen.bar_code,
                    ISNULL(origen.clave_prod_serv, CASE WHEN origen.tipo = 'SERVICIO' THEN '80111600' ELSE NULL END),
                    ISNULL(origen.clave_unidad,    CASE WHEN origen.tipo = 'SERVICIO' THEN 'E48' ELSE NULL END),
                    '02', ISNULL(origen.tasa_iva, 0.16),
                    origen.modo, origen.vendible, origen.base_uom, origen.decimales)
        OUTPUT inserted.id, origen.row_id INTO @nuevos (product_id, row_id);

        SET @creadas = (SELECT COUNT(*) FROM @nuevos);

        UPDATE r SET applied_product_id = n.product_id
          FROM dbo.import_rows r JOIN @nuevos n ON n.row_id = r.id;

        /* --------------------------------------------- la ficha de servicio */
        INSERT INTO dbo.services (product_id, duration_minutes, requires_professional,
                                  default_commission_pct, schedulable)
        SELECT r.applied_product_id, ISNULL(r.duration_minutes, 30), 1,
               r.default_commission_pct, ISNULL(r.schedulable, 1)
          FROM dbo.import_rows r JOIN @lote l ON l.id = r.id
         WHERE r.tipo = 'SERVICIO' AND r.applied_product_id IS NOT NULL
           AND NOT EXISTS (SELECT 1 FROM dbo.services s WHERE s.product_id = r.applied_product_id);

        /* ------------------------------------------- LA EXISTENCIA INICIAL
           Solo de lo que de verdad la tiene. Un servicio y un producto de
           menu no llevan existencia: darsela seria inventar un inventario de
           horas de trabajo o de cafes que nadie ha preparado. */
        INSERT INTO dbo.inventory_movements
              (product_id, typee, reference, quantity, datee, descriptionn, source, unit_cost)
        SELECT r.applied_product_id, 'entrada', @ref, r.stock, SYSDATETIME(),
               CONCAT('Existencia inicial · carga #', @batch_id), 'IMPORT_INICIAL', r.cost
          FROM dbo.import_rows r JOIN @lote l ON l.id = r.id
         WHERE r.applied_product_id IS NOT NULL
           AND r.tipo NOT IN ('SERVICIO', 'MENU')
           AND ISNULL(r.stock, 0) > 0
           AND NOT EXISTS (SELECT 1 FROM dbo.inventory_movements m
                            WHERE m.product_id = r.applied_product_id
                              AND m.reference = @ref AND m.source = 'IMPORT_INICIAL');

        SET @movs = @@ROWCOUNT;

        UPDATE p
           SET p.stock = p.stock + r.stock
          FROM dbo.products p
          JOIN dbo.import_rows r ON r.applied_product_id = p.id
          JOIN @lote l ON l.id = r.id
         WHERE r.tipo NOT IN ('SERVICIO', 'MENU') AND ISNULL(r.stock, 0) > 0
           AND EXISTS (SELECT 1 FROM dbo.inventory_movements m
                        WHERE m.product_id = p.id AND m.reference = @ref
                          AND m.source = 'IMPORT_INICIAL'
                          AND m.datee >= DATEADD(MINUTE, -1, SYSDATETIME()));

        UPDATE r SET aplicada = 1, applied_at = SYSDATETIME()
          FROM dbo.import_rows r JOIN @lote l ON l.id = r.id;

        UPDATE dbo.import_batches
           SET creadas = creadas + @creadas,
               actualizadas = actualizadas + @actualizadas,
               updated_at = SYSDATETIME(),
               completed_at = SYSDATETIME(),
               user_id = ISNULL(@user_id, user_id)
         WHERE id = @batch_id;

        COMMIT TRAN;
    END TRY
    BEGIN CATCH
        IF XACT_STATE() <> 0 ROLLBACK TRAN;
        DECLARE @m NVARCHAR(4000) = ERROR_MESSAGE();
        RAISERROR(@m, 16, 1);
        RETURN;
    END CATCH

    EXEC dbo.sp_import_batch_touch @batch_id = @batch_id;

    SELECT (SELECT COUNT(*) FROM @lote) AS procesadas,
           @creadas AS creadas, @actualizadas AS actualizadas, @movs AS movimientos;
END
GO

/* ============================================================
   EL RESUMEN, QUE AHORA DICE LA VERDAD DE UNA CARGA A MEDIAS
   ------------------------------------------------------------
   En QA se importaron 9 de 10 y la pantalla seguia ofreciendo «Importar 9»
   sobre filas que ya estaban dentro. El CTA se calculaba con el total de
   filas listas, sin mirar cuales ya se habian aplicado.

   Ahora el resumen separa lo que queda POR hacer de lo que YA se hizo, y la
   pantalla no tiene que deducirlo.
   ============================================================ */
CREATE OR ALTER PROCEDURE dbo.sp_import_batch_summary
    @batch_id INT
AS
BEGIN
    SET NOCOUNT ON;

    SELECT * FROM dbo.import_batches WHERE id = @batch_id;

    SELECT
        /* Lo que queda por entrar: aplicada = 0. Es de donde sale el boton. */
        SUM(CASE WHEN accion = 'CREATE' AND aplicada = 0 THEN 1 ELSE 0 END) AS crear,
        SUM(CASE WHEN accion = 'UPDATE' AND aplicada = 0 THEN 1 ELSE 0 END) AS actualizar,
        SUM(CASE WHEN accion = 'UNCHANGED' THEN 1 ELSE 0 END) AS igual,
        SUM(CASE WHEN accion = 'CONFLICT'  THEN 1 ELSE 0 END) AS conflicto,
        SUM(CASE WHEN accion = 'PENDIENTE' THEN 1 ELSE 0 END) AS pendiente,
        SUM(CASE WHEN accion = 'OMITIR'    THEN 1 ELSE 0 END) AS omitir,
        SUM(CASE WHEN aplicada = 1         THEN 1 ELSE 0 END) AS aplicadas,
        COUNT(*) AS total
    FROM dbo.import_rows WHERE batch_id = @batch_id;

    SELECT codigo, COUNT(*) AS cuantos
    FROM dbo.import_rows r
    CROSS APPLY OPENJSON(ISNULL(r.problemas_json, '[]'))
         WITH (codigo NVARCHAR(40) '$.codigo') j
    WHERE r.batch_id = @batch_id AND r.aplicada = 0
    GROUP BY codigo
    ORDER BY cuantos DESC;

    /* Que tipos trae esta carga. Decide las columnas de la revision: una
       hoja de ingredientes no se mira con las mismas que una de menu. */
    SELECT tipo, COUNT(*) AS cuantos
    FROM dbo.import_rows WHERE batch_id = @batch_id
    GROUP BY tipo ORDER BY cuantos DESC;
END
GO
