/* sp_import_products
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
CREATE OR ALTER PROCEDURE dbo.sp_import_products
    @Rows dbo.ProductImportType READONLY
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    BEGIN TRY
        BEGIN TRAN;

        /* 1) Normalizar filas validas (con part_number y nombre) y defaults */
        DECLARE @norm TABLE (
            part_number     NVARCHAR(100),
            name            NVARCHAR(100),
            brand_name      NVARCHAR(150),
            category_name   NVARCHAR(150),
            price           DECIMAL(10,2),
            stock           DECIMAL(12,2),
            bar_code        NVARCHAR(100),
            clave_prod_serv NVARCHAR(8),
            clave_unidad    NVARCHAR(5),
            objeto_impuesto NVARCHAR(2),
            tasa_iva        DECIMAL(5,4)
        );

        INSERT INTO @norm
        SELECT
            LTRIM(RTRIM(part_number)),
            LTRIM(RTRIM(name)),
            NULLIF(LTRIM(RTRIM(ISNULL(brand_name, ''))), ''),
            NULLIF(LTRIM(RTRIM(ISNULL(category_name, ''))), ''),
            ISNULL(price, 0),
            ISNULL(stock, 0),
            NULLIF(LTRIM(RTRIM(ISNULL(bar_code, ''))), ''),
            NULLIF(LTRIM(RTRIM(ISNULL(clave_prod_serv, ''))), ''),
            NULLIF(LTRIM(RTRIM(ISNULL(clave_unidad, ''))), ''),
            NULLIF(LTRIM(RTRIM(ISNULL(objeto_impuesto, ''))), ''),
            tasa_iva
        FROM @Rows
        WHERE LTRIM(RTRIM(ISNULL(part_number, ''))) <> ''
          AND LTRIM(RTRIM(ISNULL(name, ''))) <> '';

        /* Defaults: marca/categoria vacia y campos fiscales */
        UPDATE @norm SET brand_name      = 'SIN MARCA' WHERE brand_name IS NULL;
        UPDATE @norm SET category_name   = 'GENERAL'   WHERE category_name IS NULL;
        UPDATE @norm SET objeto_impuesto = '02'        WHERE objeto_impuesto IS NULL;
        UPDATE @norm SET tasa_iva        = 0.16        WHERE tasa_iva IS NULL;

        /* 2) Crear marcas faltantes */
        DECLARE @brands_before INT = (SELECT COUNT(*) FROM CAT_brands);
        INSERT INTO CAT_brands (namee)
        SELECT DISTINCT n.brand_name
        FROM @norm n
        WHERE NOT EXISTS (SELECT 1 FROM CAT_brands b WHERE b.namee = n.brand_name);
        DECLARE @brands_created INT = (SELECT COUNT(*) FROM CAT_brands) - @brands_before;

        /* 3) Crear categorias faltantes */
        DECLARE @cats_before INT = (SELECT COUNT(*) FROM CAT_categories);
        INSERT INTO CAT_categories (namee)
        SELECT DISTINCT n.category_name
        FROM @norm n
        WHERE NOT EXISTS (SELECT 1 FROM CAT_categories c WHERE c.namee = n.category_name);
        DECLARE @cats_created INT = (SELECT COUNT(*) FROM CAT_categories) - @cats_before;

        /* 4) Insertar productos.
              - Se omiten part_number/bar_code repetidos dentro del archivo
                (ROW_NUMBER) y los que ya existen en products (NOT EXISTS),
                para no romper por indices UNIQUE. */
        ;WITH dedup AS (
            SELECT *,
                   ROW_NUMBER() OVER (PARTITION BY part_number ORDER BY (SELECT 0)) AS rn_pn,
                   ROW_NUMBER() OVER (PARTITION BY bar_code    ORDER BY (SELECT 0)) AS rn_bc
            FROM @norm
        )
        INSERT INTO products
            (part_number, nombre, price, stock, active, category_id, brand_id,
             bar_code, clave_prod_serv, clave_unidad, objeto_impuesto, tasa_iva)
        SELECT
            d.part_number, d.name, d.price, d.stock, 1, c.id, b.id,
            d.bar_code, d.clave_prod_serv, d.clave_unidad, d.objeto_impuesto, d.tasa_iva
        FROM dedup d
        JOIN CAT_brands     b ON b.namee = d.brand_name
        JOIN CAT_categories c ON c.namee = d.category_name
        WHERE d.rn_pn = 1
          AND (d.bar_code IS NULL OR d.rn_bc = 1)
          AND NOT EXISTS (SELECT 1 FROM products p WHERE p.part_number = d.part_number)
          AND (d.bar_code IS NULL OR NOT EXISTS (SELECT 1 FROM products p WHERE p.bar_code = d.bar_code));

        DECLARE @inserted   INT = @@ROWCOUNT;
        DECLARE @total_rows INT = (SELECT COUNT(*) FROM @norm);
        DECLARE @skipped    INT = @total_rows - @inserted;

        COMMIT TRAN;

        SELECT
            @inserted        AS inserted,
            @skipped         AS skipped,
            @brands_created  AS brands_created,
            @cats_created    AS categories_created,
            @total_rows      AS total_rows;
    END TRY
    BEGIN CATCH
        IF XACT_STATE() <> 0 ROLLBACK TRAN;
        DECLARE @ErrMsg NVARCHAR(4000) = ERROR_MESSAGE();
        DECLARE @ErrSev INT = ERROR_SEVERITY();
        DECLARE @ErrSta INT = ERROR_STATE();
        RAISERROR(@ErrMsg, @ErrSev, @ErrSta);
    END CATCH
END
GO
