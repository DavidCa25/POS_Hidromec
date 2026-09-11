/* supplier_payments
 * Definicion canonica del esquema. Reconstruida desde sys.* con
 * scripts/db/extraer-esquema.mjs. SQL Server no guarda el texto del
 * CREATE TABLE original, asi que esto es equivalente, no literal.
 */
IF OBJECT_ID(N'dbo.supplier_payments', 'U') IS NULL
BEGIN
CREATE TABLE dbo.supplier_payments (
    id INT IDENTITY(1, 1) NOT NULL,
    supplier_id INT NOT NULL,
    purchase_id INT NULL,
    datee DATETIME NOT NULL DEFAULT (getdate()),
    amount DECIMAL(10, 2) NOT NULL,
    payment_method NVARCHAR(50) COLLATE Modern_Spanish_CI_AS NOT NULL,
    user_id INT NOT NULL,
    note NVARCHAR(255) COLLATE Modern_Spanish_CI_AS NULL,
    cash_movement_id INT NULL,
    PRIMARY KEY CLUSTERED (id)
);
END;

IF OBJECT_ID(N'dbo.FK_supplier_payments_suppliers', 'F') IS NULL
ALTER TABLE dbo.supplier_payments WITH CHECK ADD CONSTRAINT FK_supplier_payments_suppliers FOREIGN KEY (supplier_id) REFERENCES dbo.CAT_suppliers (id);

IF OBJECT_ID(N'dbo.FK_supplier_payments_users', 'F') IS NULL
ALTER TABLE dbo.supplier_payments WITH CHECK ADD CONSTRAINT FK_supplier_payments_users FOREIGN KEY (user_id) REFERENCES dbo.users (id);
