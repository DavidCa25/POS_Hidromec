/* rendimiento_conteos
 * Definicion canonica del esquema. Reconstruida desde sys.* con
 * scripts/db/extraer-esquema.mjs. SQL Server no guarda el texto del
 * CREATE TABLE original, asi que esto es equivalente, no literal.
 */
IF OBJECT_ID(N'dbo.rendimiento_conteos', 'U') IS NULL
BEGIN
CREATE TABLE dbo.rendimiento_conteos (
    id INT IDENTITY(1, 1) NOT NULL,
    carne_id INT NOT NULL,
    closure_id INT NULL,
    desde DATETIME2(3) NOT NULL,
    contado_en DATETIME2(3) NOT NULL CONSTRAINT DF_rendimiento_conteos_contado_en DEFAULT (sysdatetime()),
    tenia DECIMAL(12, 2) NOT NULL,
    quedo DECIMAL(12, 2) NOT NULL,
    usado DECIMAL(12, 2) NOT NULL,
    vendidos DECIMAL(12, 2) NOT NULL,
    rinde DECIMAL(6, 2) NOT NULL,
    costo_g DECIMAL(14, 4) NOT NULL,
    precio_taco DECIMAL(10, 2) NULL,
    user_id INT NULL,
    CONSTRAINT PK_rendimiento_conteos PRIMARY KEY CLUSTERED (id)
);
END;

IF OBJECT_ID(N'dbo.FK_rendimiento_conteos_carne', 'F') IS NULL
ALTER TABLE dbo.rendimiento_conteos WITH CHECK ADD CONSTRAINT FK_rendimiento_conteos_carne FOREIGN KEY (carne_id) REFERENCES dbo.rendimiento_carnes (product_id);

IF OBJECT_ID(N'dbo.FK_rendimiento_conteos_closure', 'F') IS NULL
ALTER TABLE dbo.rendimiento_conteos WITH CHECK ADD CONSTRAINT FK_rendimiento_conteos_closure FOREIGN KEY (closure_id) REFERENCES dbo.cash_closures (id);

/* Un conteo por carne y por corte: reintentar el cierre no cuenta dos veces. */

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'UX_rendimiento_conteos_corte' AND object_id = OBJECT_ID(N'dbo.rendimiento_conteos'))
CREATE UNIQUE NONCLUSTERED INDEX UX_rendimiento_conteos_corte ON dbo.rendimiento_conteos (carne_id, closure_id) WHERE closure_id IS NOT NULL;

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_rendimiento_conteos_fecha' AND object_id = OBJECT_ID(N'dbo.rendimiento_conteos'))
CREATE NONCLUSTERED INDEX IX_rendimiento_conteos_fecha ON dbo.rendimiento_conteos (contado_en, carne_id);
