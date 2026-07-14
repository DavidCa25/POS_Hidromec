/* ============================================================
   Migracion de VENTAS historicas (una fila por partida)
   - Agrega a sales: migrated (bit) y ext_folio (folio original)
   - dbo.SaleLineImportType : TVP con las partidas del Excel
   - dbo.sp_import_sales : arma ventas historicas
       * agrupa las partidas por ext_folio -> una venta
       * resuelve el producto por No. Parte (part_number)
       * NO toca stock ni caja (son historicas)
       * marca migrated = 1 y guarda ext_folio
       * no re-importa folios ya migrados
       * devuelve resumen (ventas, partidas, sin producto)

   Correr en SSMS. Requiere que los PRODUCTOS ya esten importados
   (para poder resolver el No. Parte de cada partida).
   ============================================================ */

/* 1) Columnas de apoyo en sales (idempotente) */
IF COL_LENGTH('dbo.sales', 'migrated') IS NULL
    ALTER TABLE dbo.sales ADD migrated BIT NOT NULL CONSTRAINT DF_sales_migrated DEFAULT (0);
GO
IF COL_LENGTH('dbo.sales', 'ext_folio') IS NULL
    ALTER TABLE dbo.sales ADD ext_folio NVARCHAR(40) NULL;
GO

/* 2) Tipo y SP */
IF OBJECT_ID('dbo.sp_import_sales', 'P') IS NOT NULL
    DROP PROCEDURE dbo.sp_import_sales;
GO
IF TYPE_ID('dbo.SaleLineImportType') IS NOT NULL
    DROP TYPE dbo.SaleLineImportType;
GO

CREATE TYPE dbo.SaleLineImportType AS TABLE
(
    ext_folio       NVARCHAR(40)  NULL,
    sale_date       DATETIME      NULL,
    part_number     NVARCHAR(100) NULL,
    quantity        DECIMAL(12,2) NULL,
    unit_price      DECIMAL(10,2) NULL,
    payment_method  NVARCHAR(50)  NULL
);
GO

CREATE PROCEDURE dbo.sp_import_sales
    @Rows    dbo.SaleLineImportType READONLY,
    @user_id INT
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    IF @user_id IS NULL
    BEGIN
        RAISERROR('Falta el usuario para asignar las ventas.', 16, 1);
        RETURN;
    END

    BEGIN TRY
        BEGIN TRAN;

        DECLARE @register_id INT = (SELECT TOP 1 id FROM dbo.registers ORDER BY id);

        /* Partidas con producto resuelto por No. Parte */
        DECLARE @matched TABLE (
            ext_folio      NVARCHAR(40),
            sale_date      DATETIME,
            product_id     INT,
            quantity       DECIMAL(12,2),
            unit_price     DECIMAL(10,2),
            payment_method NVARCHAR(50)
        );

        INSERT INTO @matched
        SELECT
            LTRIM(RTRIM(r.ext_folio)),
            ISNULL(r.sale_date, GETDATE()),
            p.id,
            ISNULL(r.quantity, 0),
            ISNULL(r.unit_price, 0),
            NULLIF(LTRIM(RTRIM(ISNULL(r.payment_method, ''))), '')
        FROM @Rows r
        JOIN products p ON p.part_number = LTRIM(RTRIM(r.part_number))
        WHERE LTRIM(RTRIM(ISNULL(r.ext_folio, ''))) <> ''
          AND ISNULL(r.quantity, 0) > 0;

        DECLARE @total_lines   INT = (SELECT COUNT(*) FROM @Rows);
        DECLARE @matched_lines INT = (SELECT COUNT(*) FROM @matched);

        /* Cabeceras por folio (omitiendo folios ya migrados) */
        DECLARE @folios TABLE (
            ext_folio NVARCHAR(40),
            sale_date DATETIME,
            pm        NVARCHAR(50),
            total     DECIMAL(12,2)
        );
        INSERT INTO @folios
        SELECT ext_folio, MIN(sale_date), MAX(payment_method), SUM(quantity * unit_price)
        FROM @matched
        WHERE ext_folio NOT IN
              (SELECT ext_folio FROM sales WHERE migrated = 1 AND ext_folio IS NOT NULL)
        GROUP BY ext_folio;

        /* Insertar cabeceras y mapear id nuevo <-> folio original */
        DECLARE @map TABLE (sale_id INT, ext_folio NVARCHAR(40));

        INSERT INTO sales
            (datee, useer_id, total, payment_method, customer_id,
             paid_amount, balance, due_date, register_id, migrated, ext_folio)
        OUTPUT inserted.id, inserted.ext_folio INTO @map(sale_id, ext_folio)
        SELECT
            f.sale_date, @user_id, f.total, ISNULL(f.pm, 'EFECTIVO'), NULL,
            f.total, 0, NULL, @register_id, 1, f.ext_folio
        FROM @folios f;

        DECLARE @sales_created INT = (SELECT COUNT(*) FROM @map);

        /* Detalle: solo de los folios recien creados */
        INSERT INTO sale_detail (sale_id, product_id, quantity, unitary_price)
        SELECT mp.sale_id, m.product_id, m.quantity, m.unit_price
        FROM @matched m
        JOIN @map mp ON mp.ext_folio = m.ext_folio;

        DECLARE @details_created INT = @@ROWCOUNT;
        DECLARE @folios_omitidos INT =
            (SELECT COUNT(DISTINCT ext_folio) FROM @matched) - @sales_created;

        COMMIT TRAN;

        SELECT
            @sales_created                  AS sales_created,
            @details_created                AS details_created,
            @matched_lines                  AS matched_lines,
            (@total_lines - @matched_lines) AS unmatched_lines,
            @folios_omitidos                AS folios_omitidos;
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
