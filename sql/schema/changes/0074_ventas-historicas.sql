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
