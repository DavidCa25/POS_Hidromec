/* ============================================================
   0035 — QuickStart: ejecutar y deshacer

   ESTO ES LO UNICO QUE TOCA EL CATALOGO.
   Todo lo anterior -leer, mapear, validar, resolver- vive en el almacen
   intermedio. Aqui es donde una carga revisada se convierte en productos.

   POR LOTES, NO DE UN GOLPE
   -------------------------
   El importador viejo mandaba las 5,000 filas en una transaccion con
   XACT_ABORT: una sola fila mala -un nombre de 120 caracteres- abortaba
   las 5,000 y devolvia el mensaje crudo de SQL Server.

   Aqui cada lote es su propia transaccion. Un lote que falla deja los
   anteriores dentro, se marca, y la importacion sigue. Ademas las filas
   que no caben en el modelo NI SIQUIERA se eligen: la guarda de longitud
   esta en el WHERE, no en el INSERT, asi que una fila imposible se queda
   fuera en vez de tumbar a sus vecinas.

   EL STOCK ENTRA POR DONDE ENTRA TODO
   -----------------------------------
   `products.stock = 24` sin mas era lo de antes: un numero sin origen,
   sin fecha y sin responsable. Aqui la existencia inicial es un
   `inventory_movements` de entrada con `source = 'IMPORT_INICIAL'` y
   `reference = 'IMP-<carga>'`, igual que una compra o una venta. No hay
   un segundo libro mayor: es el mismo.
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

    /* QUE FILAS ENTRAN EN ESTE LOTE.
       Las guardas de tamano viven AQUI: lo que no cabe en `products` no se
       elige, y por lo tanto no puede abortar nada. Esas filas ya llevan su
       problema marcado desde la validacion. */
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
       /* La unidad tiene clave ajena contra `uoms`: una inventada
          reventaria el INSERT. Se exige que exista o se deja nula. */
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
           `sp_get_active_products` une products con categorias y marcas por
           INNER JOIN: un producto sin ellas existe en la base y NO se puede
           vender. Asi que nunca se deja ninguno sin. */
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

        /* ------------------------------------------------------ UPDATE
           Antes de tocar nada se guarda el valor anterior: sin eso,
           deshacer una subida de precio no tendria a que volver. */
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
               /* Si no tenia categoria o marca, se le ponen: sin ellas
                  desaparece del catalogo de venta. */
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
           Un servicio NO es mercancia: `inventory_mode = 'NONE'`, sin
           existencia y con las claves del SAT de servicio. */
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
                   NULLIF(LTRIM(RTRIM(ISNULL(r.bar_code,''))),'') AS bar_code,
                   ISNULL((SELECT c.id FROM dbo.CAT_categories c WHERE c.namee = LTRIM(RTRIM(r.category_name))),
                          CASE WHEN r.tipo = 'SERVICIO'
                               THEN ISNULL((SELECT id FROM dbo.CAT_categories WHERE namee = N'Servicios'), @cat_gen)
                               ELSE @cat_gen END) AS category_id,
                   ISNULL((SELECT b.id FROM dbo.CAT_brands b WHERE b.namee = LTRIM(RTRIM(r.brand_name))), @marca_gen) AS brand_id,
                   r.clave_prod_serv, r.clave_unidad, r.tasa_iva,
                   ISNULL(r.base_uom, 'pza') AS base_uom
              FROM dbo.import_rows r JOIN @lote l ON l.id = r.id
             WHERE r.accion = 'CREATE'
        ) AS origen
        ON (1 = 0)   -- nunca casa: MERGE aqui es solo para poder usar OUTPUT con origen
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
                    CASE WHEN origen.tipo = 'SERVICIO' THEN 'NONE' ELSE 'DIRECT' END,
                    1, origen.base_uom, 0)
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
           Por movimiento, como cualquier entrada. `products.stock` lo deja
           en su sitio el mismo UPDATE de siempre, pero ahora hay una fila
           que dice cuanto, cuando, quien y de que carga. */
        INSERT INTO dbo.inventory_movements
              (product_id, typee, reference, quantity, datee, descriptionn, source, unit_cost)
        SELECT r.applied_product_id, 'entrada', @ref, r.stock, SYSDATETIME(),
               CONCAT('Existencia inicial · carga #', @batch_id), 'IMPORT_INICIAL', r.cost
          FROM dbo.import_rows r JOIN @lote l ON l.id = r.id
         WHERE r.applied_product_id IS NOT NULL
           AND r.tipo <> 'SERVICIO'
           AND ISNULL(r.stock, 0) > 0
           /* Reintentar una carga no puede duplicar el movimiento. */
           AND NOT EXISTS (SELECT 1 FROM dbo.inventory_movements m
                            WHERE m.product_id = r.applied_product_id
                              AND m.reference = @ref AND m.source = 'IMPORT_INICIAL');

        SET @movs = @@ROWCOUNT;

        UPDATE p
           SET p.stock = p.stock + r.stock
          FROM dbo.products p
          JOIN dbo.import_rows r ON r.applied_product_id = p.id
          JOIN @lote l ON l.id = r.id
         WHERE r.tipo <> 'SERVICIO' AND ISNULL(r.stock, 0) > 0
           AND EXISTS (SELECT 1 FROM dbo.inventory_movements m
                        WHERE m.product_id = p.id AND m.reference = @ref
                          AND m.source = 'IMPORT_INICIAL'
                          AND m.datee >= DATEADD(MINUTE, -1, SYSDATETIME()));

        /* ------------------------------------------------------- cerrar */
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
   DESHACER

   Deshacer NO es borrar. Un producto que ya se vendio tiene historia, y
   la historia no se reescribe porque alguien se arrepienta de una
   importacion. Por eso hay tres respuestas y no una:

     TODO        ninguna fila tuvo actividad posterior
     EN_PARTE    algunas si, y esas se quedan
     NADA        el catalogo ya se movio demasiado

   Lo que se deshace se deshace con MOVIMIENTOS INVERSOS y desactivando,
   nunca con DELETE.
   ============================================================ */
CREATE OR ALTER PROCEDURE dbo.sp_import_undo_check
    @batch_id INT
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @ref NVARCHAR(50) = CONCAT('IMP-', @batch_id);

    ;WITH aplicadas AS (
        SELECT r.id, r.accion, r.applied_product_id
          FROM dbo.import_rows r
         WHERE r.batch_id = @batch_id AND r.aplicada = 1 AND r.applied_product_id IS NOT NULL
    ),
    con_actividad AS (
        SELECT a.id
          FROM aplicadas a
         WHERE EXISTS (SELECT 1 FROM dbo.sale_detail sd WHERE sd.product_id = a.applied_product_id)
            OR EXISTS (SELECT 1 FROM dbo.purchase_detail pd WHERE pd.product_id = a.applied_product_id)
            OR EXISTS (SELECT 1 FROM dbo.recipe_lines rl WHERE rl.ingredient_product_id = a.applied_product_id)
            OR EXISTS (SELECT 1 FROM dbo.inventory_movements m
                        WHERE m.product_id = a.applied_product_id
                          AND NOT (m.reference = @ref AND m.source = 'IMPORT_INICIAL'))
    )
    SELECT
        (SELECT COUNT(*) FROM aplicadas) AS aplicadas,
        (SELECT COUNT(*) FROM con_actividad) AS con_actividad,
        CASE
            WHEN (SELECT COUNT(*) FROM aplicadas) = 0 THEN 'NADA'
            WHEN (SELECT COUNT(*) FROM con_actividad) = 0 THEN 'TODO'
            WHEN (SELECT COUNT(*) FROM con_actividad) < (SELECT COUNT(*) FROM aplicadas) THEN 'EN_PARTE'
            ELSE 'NADA' END AS veredicto;
END
GO

CREATE OR ALTER PROCEDURE dbo.sp_import_undo
    @batch_id INT,
    @user_id INT = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    DECLARE @ref NVARCHAR(50) = CONCAT('IMP-', @batch_id);
    DECLARE @reversibles TABLE (row_id INT, product_id INT, accion NVARCHAR(12));

    INSERT INTO @reversibles (row_id, product_id, accion)
    SELECT r.id, r.applied_product_id, r.accion
      FROM dbo.import_rows r
     WHERE r.batch_id = @batch_id AND r.aplicada = 1 AND r.applied_product_id IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM dbo.sale_detail sd WHERE sd.product_id = r.applied_product_id)
       AND NOT EXISTS (SELECT 1 FROM dbo.purchase_detail pd WHERE pd.product_id = r.applied_product_id)
       AND NOT EXISTS (SELECT 1 FROM dbo.recipe_lines rl WHERE rl.ingredient_product_id = r.applied_product_id)
       AND NOT EXISTS (SELECT 1 FROM dbo.inventory_movements m
                        WHERE m.product_id = r.applied_product_id
                          AND NOT (m.reference = @ref AND m.source = 'IMPORT_INICIAL'));

    DECLARE @revertidas INT = 0, @conservadas INT = 0;

    BEGIN TRAN;

        /* La existencia vuelve por donde entro: un movimiento de salida
           que anula al de entrada. El de entrada NO se borra. */
        INSERT INTO dbo.inventory_movements
              (product_id, typee, reference, quantity, datee, descriptionn, source, unit_cost)
        SELECT m.product_id, 'salida', @ref, m.quantity, SYSDATETIME(),
               CONCAT('Deshacer carga #', @batch_id), 'IMPORT_UNDO', m.unit_cost
          FROM dbo.inventory_movements m
          JOIN @reversibles v ON v.product_id = m.product_id
         WHERE m.reference = @ref AND m.source = 'IMPORT_INICIAL'
           AND NOT EXISTS (SELECT 1 FROM dbo.inventory_movements u
                            WHERE u.product_id = m.product_id AND u.reference = @ref
                              AND u.source = 'IMPORT_UNDO');

        UPDATE p SET p.stock = p.stock - m.quantity
          FROM dbo.products p
          JOIN dbo.inventory_movements m ON m.product_id = p.id
          JOIN @reversibles v ON v.product_id = p.id
         WHERE m.reference = @ref AND m.source = 'IMPORT_INICIAL';

        /* Lo que la carga CREO se desactiva; no se borra, porque su id
           puede estar ya escrito en otro sitio que no sabemos mirar. */
        UPDATE p SET p.active = 0
          FROM dbo.products p JOIN @reversibles v ON v.product_id = p.id
         WHERE v.accion = 'CREATE';

        /* Lo que la carga ACTUALIZO vuelve a su valor anterior. */
        UPDATE p
           SET p.price = TRY_CONVERT(DECIMAL(10,2), JSON_VALUE(r.previo_json, '$.price')),
               p.cost  = TRY_CONVERT(DECIMAL(14,4), JSON_VALUE(r.previo_json, '$.cost')),
               p.nombre = ISNULL(JSON_VALUE(r.previo_json, '$.nombre'), p.nombre)
          FROM dbo.products p
          JOIN dbo.import_rows r ON r.applied_product_id = p.id
          JOIN @reversibles v ON v.row_id = r.id
         WHERE v.accion = 'UPDATE' AND r.previo_json IS NOT NULL;

        UPDATE r SET aplicada = 0, applied_at = NULL, applied_product_id = NULL
          FROM dbo.import_rows r JOIN @reversibles v ON v.row_id = r.id;

        SET @revertidas = (SELECT COUNT(*) FROM @reversibles);
        SET @conservadas = (SELECT COUNT(*) FROM dbo.import_rows
                             WHERE batch_id = @batch_id AND aplicada = 1);

        UPDATE dbo.import_batches
           SET creadas = 0, actualizadas = 0, estado = 'REVISION', updated_at = SYSDATETIME()
         WHERE id = @batch_id;

    COMMIT TRAN;

    EXEC dbo.sp_import_batch_touch @batch_id = @batch_id;

    SELECT @revertidas AS revertidas, @conservadas AS conservadas;
END
GO
