/* membership_redemptions
 * Definicion canonica del esquema. Reconstruida desde sys.* con
 * scripts/db/extraer-esquema.mjs. SQL Server no guarda el texto del
 * CREATE TABLE original, asi que esto es equivalente, no literal.
 */
IF OBJECT_ID(N'dbo.membership_redemptions', 'U') IS NULL
BEGIN
CREATE TABLE dbo.membership_redemptions (
    id INT IDENTITY(1, 1) NOT NULL,
    uuid UNIQUEIDENTIFIER NOT NULL CONSTRAINT DF_membership_redemptions_uuid DEFAULT (newid()),
    membership_id INT NOT NULL,
    redeem_date DATE NOT NULL,
    units INT NOT NULL CONSTRAINT DF_membership_redemptions_units DEFAULT ((1)),
    product_id INT NULL,
    product_name NVARCHAR(100) COLLATE Modern_Spanish_CI_AS NULL,
    amount DECIMAL(12, 2) NULL,
    sale_id INT NULL,
    sale_detail_id INT NULL,
    register_id INT NULL,
    origin NVARCHAR(10) COLLATE Modern_Spanish_CI_AS NOT NULL CONSTRAINT DF_membership_redemptions_origin DEFAULT (N'LOCAL'),
    location_name NVARCHAR(120) COLLATE Modern_Spanish_CI_AS NULL,
    created_at DATETIME2(0) NOT NULL CONSTRAINT DF_membership_redemptions_created DEFAULT (sysdatetime()),
    voided_at DATETIME2(0) NULL,
    doble BIT NOT NULL CONSTRAINT DF_membership_redemptions_doble DEFAULT ((0)),
    reviewed_at DATETIME2(0) NULL,
    reviewed_by INT NULL,
    review_note NVARCHAR(200) COLLATE Modern_Spanish_CI_AS NULL,
    row_version TIMESTAMP NOT NULL,
    CONSTRAINT PK_membership_redemptions PRIMARY KEY CLUSTERED (id),
    CONSTRAINT UX_membership_redemptions_uuid UNIQUE NONCLUSTERED (uuid)
);
END;

IF OBJECT_ID(N'dbo.CK_membership_redemptions_origin', 'C') IS NULL
ALTER TABLE dbo.membership_redemptions WITH CHECK ADD CONSTRAINT CK_membership_redemptions_origin CHECK ([origin]=N'REMOTE' OR [origin]=N'LOCAL');

IF OBJECT_ID(N'dbo.CK_membership_redemptions_units', 'C') IS NULL
ALTER TABLE dbo.membership_redemptions WITH CHECK ADD CONSTRAINT CK_membership_redemptions_units CHECK ([units]>=(1) AND [units]<=(20));

IF OBJECT_ID(N'dbo.FK_membership_redemptions_membership', 'F') IS NULL
ALTER TABLE dbo.membership_redemptions WITH CHECK ADD CONSTRAINT FK_membership_redemptions_membership FOREIGN KEY (membership_id) REFERENCES dbo.customer_memberships (id);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_membership_redemptions_dia' AND object_id = OBJECT_ID(N'dbo.membership_redemptions'))
CREATE NONCLUSTERED INDEX IX_membership_redemptions_dia ON dbo.membership_redemptions (membership_id, redeem_date) INCLUDE (units, voided_at);
