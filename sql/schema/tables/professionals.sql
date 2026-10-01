/* professionals
 * Definicion canonica del esquema. Reconstruida desde sys.* con
 * scripts/db/extraer-esquema.mjs. SQL Server no guarda el texto del
 * CREATE TABLE original, asi que esto es equivalente, no literal.
 */
IF OBJECT_ID(N'dbo.professionals', 'U') IS NULL
BEGIN
CREATE TABLE dbo.professionals (
    id INT IDENTITY(1, 1) NOT NULL,
    full_name NVARCHAR(120) COLLATE Modern_Spanish_CI_AS NOT NULL,
    title NVARCHAR(60) COLLATE Modern_Spanish_CI_AS NULL,
    phone NVARCHAR(30) COLLATE Modern_Spanish_CI_AS NULL,
    email NVARCHAR(120) COLLATE Modern_Spanish_CI_AS NULL,
    user_id INT NULL,
    default_commission_pct DECIMAL(5, 2) NOT NULL CONSTRAINT DF_prof_comm DEFAULT ((0)),
    color NVARCHAR(9) COLLATE Modern_Spanish_CI_AS NULL,
    active BIT NOT NULL CONSTRAINT DF_prof_active DEFAULT ((1)),
    created_at DATETIME2(0) NOT NULL CONSTRAINT DF_prof_created DEFAULT (sysdatetime()),
    updated_at DATETIME2(0) NULL,
    CONSTRAINT PK_professionals PRIMARY KEY CLUSTERED (id)
);
END;

IF OBJECT_ID(N'dbo.CK_professionals_commission', 'C') IS NULL
ALTER TABLE dbo.professionals WITH CHECK ADD CONSTRAINT CK_professionals_commission CHECK ([default_commission_pct]>=(0) AND [default_commission_pct]<=(100));

IF OBJECT_ID(N'dbo.FK_professionals_user', 'F') IS NULL
ALTER TABLE dbo.professionals WITH CHECK ADD CONSTRAINT FK_professionals_user FOREIGN KEY (user_id) REFERENCES dbo.users (id);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'UX_professionals_user' AND object_id = OBJECT_ID(N'dbo.professionals'))
CREATE UNIQUE NONCLUSTERED INDEX UX_professionals_user ON dbo.professionals (user_id) WHERE ([user_id] IS NOT NULL);
