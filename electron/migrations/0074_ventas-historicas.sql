/* ============================================================
   0074 — ventas historicas

   Generada con scripts/db/generar-migracion.mjs desde los archivos
   canonicos de sql/. No editar a mano: regenerar.

   Idempotente: todos los objetos usan CREATE OR ALTER, y los tipos
   comprueban su existencia antes de crearse. Se puede reejecutar.

   Incluye el bloque de esquema sql/schema/changes/0074_ventas-historicas.sql (tablas,
   columnas, seed). Cada paso de ese bloque comprueba su existencia.
   ============================================================ */

/* ========== ESQUEMA: sql/schema/changes/0074_ventas-historicas.sql ========== */
/* ============================================================
   0074 — Ventas historicas (esquema)

   La pantalla Migracion -> Ventas llamaba a dbo.sp_import_sales, pero su
   tipo de tabla y sus dos columnas solo existian en el script suelto
   sql/_heredado/importador_ventas.sql, que nunca entro a una migracion.
   En toda base instalada la importacion fallaba con
   «Cannot find data type dbo.SaleLineImportType».

   sales.migrated   1 = venta traida de otro sistema. No movio inventario
                    ni caja.
   sales.ext_folio  folio en el sistema anterior. Evita importar dos veces
                    el mismo folio.

   Aditiva: nada existente cambia. Las ventas que ya existen quedan con
   migrated = 0.
   ============================================================ */
IF COL_LENGTH(N'dbo.sales', N'migrated') IS NULL
    ALTER TABLE dbo.sales ADD migrated BIT NOT NULL
        CONSTRAINT DF_sales_migrated DEFAULT (0);

IF COL_LENGTH(N'dbo.sales', N'ext_folio') IS NULL
    ALTER TABLE dbo.sales ADD ext_folio NVARCHAR(40) NULL;
GO

/* ---------- SaleLineImportType (USER_TABLE_TYPE) ---------- */
/* SaleLineImportType
 * Tipo de tabla. SQL Server no conserva el texto original de un tipo, asi
 * que este DDL se reconstruye desde sys.columns. Es equivalente, no literal.
 * Un tipo NO admite CREATE OR ALTER: se comprueba antes de crearlo.
 *
 * Partidas de ventas historicas (Migracion -> Ventas), una por producto
 * vendido. Lo recibe dbo.sp_import_sales.
 */
IF TYPE_ID(N'dbo.SaleLineImportType') IS NULL
BEGIN
  CREATE TYPE dbo.SaleLineImportType AS TABLE (
    ext_folio NVARCHAR(40) NULL,
    sale_date DATETIME NULL,
    part_number NVARCHAR(100) NULL,
    quantity DECIMAL(12, 2) NULL,
    unit_price DECIMAL(10, 2) NULL,
    payment_method NVARCHAR(50) NULL
  );
END;
GO

/* ---------- sp_import_sales (SQL_STORED_PROCEDURE) ---------- */
/* sp_import_sales
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
CREATE OR ALTER PROCEDURE dbo.sp_import_sales
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
