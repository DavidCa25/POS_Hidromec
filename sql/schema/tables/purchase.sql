/* purchase
 * Definicion canonica del esquema. Reconstruida desde sys.* con
 * scripts/db/extraer-esquema.mjs. SQL Server no guarda el texto del
 * CREATE TABLE original, asi que esto es equivalente, no literal.
 */
IF OBJECT_ID(N'dbo.purchase', 'U') IS NULL
BEGIN
CREATE TABLE dbo.purchase (
    id INT IDENTITY(1, 1) NOT NULL,
    datee DATETIME NULL DEFAULT (getdate()),
    useer_id INT NOT NULL,
    total DECIMAL(10, 2) NULL,
    tax_rate DECIMAL(5, 2) NULL,
    tax_amount DECIMAL(10, 2) NULL,
    supplier_id INT NULL,
    balance DECIMAL(10, 2) NULL,
    payment_status NVARCHAR(20) COLLATE Modern_Spanish_CI_AS NULL,
    PRIMARY KEY CLUSTERED (id)
);
END;

ALTER TABLE dbo.purchase WITH CHECK ADD FOREIGN KEY (useer_id) REFERENCES dbo.users (id);
