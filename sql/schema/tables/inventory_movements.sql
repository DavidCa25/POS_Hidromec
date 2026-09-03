/* inventory_movements
 * Definicion canonica del esquema. Reconstruida desde sys.* con
 * scripts/db/extraer-esquema.mjs. SQL Server no guarda el texto del
 * CREATE TABLE original, asi que esto es equivalente, no literal.
 */
IF OBJECT_ID(N'dbo.inventory_movements', 'U') IS NULL
BEGIN
CREATE TABLE dbo.inventory_movements (
    id INT IDENTITY(1, 1) NOT NULL,
    product_id INT NOT NULL,
    typee NVARCHAR(20) COLLATE Modern_Spanish_CI_AS NULL,
    reference NVARCHAR(50) COLLATE Modern_Spanish_CI_AS NULL,
    quantity DECIMAL(12, 2) NOT NULL,
    datee DATETIME NULL DEFAULT (getdate()),
    descriptionn NVARCHAR(255) COLLATE Modern_Spanish_CI_AS NULL,
    PRIMARY KEY CLUSTERED (id)
);
END;

ALTER TABLE dbo.inventory_movements WITH CHECK ADD CHECK ([typee]='salida' OR [typee]='entrada');

ALTER TABLE dbo.inventory_movements WITH CHECK ADD FOREIGN KEY (product_id) REFERENCES dbo.products (id);
