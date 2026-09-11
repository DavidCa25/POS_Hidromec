/* loyalty_redemptions
 * Definicion canonica del esquema. Reconstruida desde sys.* con
 * scripts/db/extraer-esquema.mjs. SQL Server no guarda el texto del
 * CREATE TABLE original, asi que esto es equivalente, no literal.
 */
IF OBJECT_ID(N'dbo.loyalty_redemptions', 'U') IS NULL
BEGIN
CREATE TABLE dbo.loyalty_redemptions (
    id INT IDENTITY(1, 1) NOT NULL,
    kind NVARCHAR(10) COLLATE Modern_Spanish_CI_AS NOT NULL,
    reward_instance_id INT NULL,
    coupon_instance_id INT NULL,
    sale_id INT NOT NULL,
    register_id INT NULL,
    machine_id NVARCHAR(64) COLLATE Modern_Spanish_CI_AS NULL,
    amount_applied DECIMAL(12, 2) NOT NULL CONSTRAINT DF_loyalty_redemptions_amount DEFAULT ((0)),
    created_at DATETIME2(0) NOT NULL CONSTRAINT DF_loyalty_redemptions_created_at DEFAULT (sysutcdatetime()),
    CONSTRAINT PK_loyalty_redemptions PRIMARY KEY CLUSTERED (id)
);
END;

IF OBJECT_ID(N'dbo.CK_loyalty_redemptions_kind', 'C') IS NULL
ALTER TABLE dbo.loyalty_redemptions WITH CHECK ADD CONSTRAINT CK_loyalty_redemptions_kind CHECK ([kind]='REWARD' AND [reward_instance_id] IS NOT NULL OR [kind]='COUPON' AND [coupon_instance_id] IS NOT NULL);

IF OBJECT_ID(N'dbo.FK_loyalty_redemptions_sale', 'F') IS NULL
ALTER TABLE dbo.loyalty_redemptions WITH CHECK ADD CONSTRAINT FK_loyalty_redemptions_sale FOREIGN KEY (sale_id) REFERENCES dbo.sales (id);
