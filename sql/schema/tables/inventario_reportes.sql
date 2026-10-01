/* inventario_reportes
 * Definicion canonica del esquema. Reconstruida desde sys.* con
 * scripts/db/extraer-esquema.mjs. SQL Server no guarda el texto del
 * CREATE TABLE original, asi que esto es equivalente, no literal.
 */
IF OBJECT_ID(N'dbo.inventario_reportes', 'U') IS NULL
BEGIN
CREATE TABLE dbo.inventario_reportes (
    id INT IDENTITY(1, 1) NOT NULL,
    product_id INT NOT NULL,
    tipo NVARCHAR(10) COLLATE Modern_Spanish_CI_AS NOT NULL,
    cantidad DECIMAL(12, 2) NULL,
    stock_al_reportar DECIMAL(12, 2) NULL,
    nota NVARCHAR(200) COLLATE Modern_Spanish_CI_AS NULL,
    estado NVARCHAR(10) COLLATE Modern_Spanish_CI_AS NOT NULL CONSTRAINT DF_inv_rep_estado DEFAULT ('PENDIENTE'),
    reportado_en DATETIME2(0) NOT NULL CONSTRAINT DF_inv_rep_en DEFAULT (sysutcdatetime()),
    local_creado_en DATETIME2(0) NULL,
    user_id INT NULL,
    professional_id INT NULL,
    dispositivo_id UNIQUEIDENTIFIER NULL,
    resuelto_en DATETIME2(0) NULL,
    resuelto_por INT NULL,
    version TIMESTAMP NOT NULL,
    CONSTRAINT PK_inventario_reportes PRIMARY KEY CLUSTERED (id)
);
END;

IF OBJECT_ID(N'dbo.CK_inv_rep_estado', 'C') IS NULL
ALTER TABLE dbo.inventario_reportes WITH CHECK ADD CONSTRAINT CK_inv_rep_estado CHECK ([estado]='DESCARTADO' OR [estado]='APLICADO' OR [estado]='PENDIENTE');

IF OBJECT_ID(N'dbo.CK_inv_rep_tipo', 'C') IS NULL
ALTER TABLE dbo.inventario_reportes WITH CHECK ADD CONSTRAINT CK_inv_rep_tipo CHECK ([tipo]='FALTANTE' OR [tipo]='CONTEO');

IF OBJECT_ID(N'dbo.FK_inv_rep_product', 'F') IS NULL
ALTER TABLE dbo.inventario_reportes WITH CHECK ADD CONSTRAINT FK_inv_rep_product FOREIGN KEY (product_id) REFERENCES dbo.products (id);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_inv_rep_pendientes' AND object_id = OBJECT_ID(N'dbo.inventario_reportes'))
CREATE NONCLUSTERED INDEX IX_inv_rep_pendientes ON dbo.inventario_reportes (estado, reportado_en DESC);
