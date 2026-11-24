/* salud_lote_movimientos
 * Definicion canonica del esquema. Reconstruida desde sys.* con
 * scripts/db/extraer-esquema.mjs. SQL Server no guarda el texto del
 * CREATE TABLE original, asi que esto es equivalente, no literal.
 */
IF OBJECT_ID(N'dbo.salud_lote_movimientos', 'U') IS NULL
BEGIN
CREATE TABLE dbo.salud_lote_movimientos (
    id BIGINT IDENTITY(1, 1) NOT NULL,
    product_id INT NOT NULL,
    lote_id INT NULL,
    tipo NVARCHAR(10) COLLATE Modern_Spanish_CI_AS NOT NULL,
    cantidad DECIMAL(12, 3) NOT NULL,
    sale_id INT NULL,
    receta_id INT NULL,
    user_id INT NULL,
    nota NVARCHAR(200) COLLATE Modern_Spanish_CI_AS NULL,
    at DATETIME2(0) NOT NULL CONSTRAINT DF_salud_lote_mov_at DEFAULT (sysdatetime()),
    CONSTRAINT PK_salud_lote_mov PRIMARY KEY CLUSTERED (id)
);
END;

IF OBJECT_ID(N'dbo.CK_salud_lote_mov_cant', 'C') IS NULL
ALTER TABLE dbo.salud_lote_movimientos WITH CHECK ADD CONSTRAINT CK_salud_lote_mov_cant CHECK ([cantidad]>(0));

IF OBJECT_ID(N'dbo.CK_salud_lote_mov_tipo', 'C') IS NULL
ALTER TABLE dbo.salud_lote_movimientos WITH CHECK ADD CONSTRAINT CK_salud_lote_mov_tipo CHECK ([tipo]=N'MERMA' OR [tipo]=N'AJUSTE' OR [tipo]=N'SALIDA' OR [tipo]=N'ENTRADA');

IF OBJECT_ID(N'dbo.FK_salud_lote_mov_lote', 'F') IS NULL
ALTER TABLE dbo.salud_lote_movimientos WITH CHECK ADD CONSTRAINT FK_salud_lote_mov_lote FOREIGN KEY (lote_id) REFERENCES dbo.salud_lotes (id);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_salud_lote_mov_producto' AND object_id = OBJECT_ID(N'dbo.salud_lote_movimientos'))
CREATE NONCLUSTERED INDEX IX_salud_lote_mov_producto ON dbo.salud_lote_movimientos (product_id, at);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_salud_lote_mov_venta' AND object_id = OBJECT_ID(N'dbo.salud_lote_movimientos'))
CREATE NONCLUSTERED INDEX IX_salud_lote_mov_venta ON dbo.salud_lote_movimientos (sale_id) WHERE ([sale_id] IS NOT NULL);
