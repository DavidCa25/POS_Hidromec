/* expense_categories
 * Definicion canonica del esquema. Reconstruida desde sys.* con
 * scripts/db/extraer-esquema.mjs. SQL Server no guarda el texto del
 * CREATE TABLE original, asi que esto es equivalente, no literal.
 */
IF OBJECT_ID(N'dbo.expense_categories', 'U') IS NULL
BEGIN
CREATE TABLE dbo.expense_categories (
    id INT IDENTITY(1, 1) NOT NULL,
    name NVARCHAR(60) COLLATE Modern_Spanish_CI_AS NOT NULL,
    kind VARCHAR(10) COLLATE Modern_Spanish_CI_AS NOT NULL CONSTRAINT DF_expense_categories_kind DEFAULT ('GENERAL'),
    is_system BIT NOT NULL CONSTRAINT DF_expense_categories_system DEFAULT ((0)),
    active BIT NOT NULL CONSTRAINT DF_expense_categories_active DEFAULT ((1)),
    sort_order INT NOT NULL CONSTRAINT DF_expense_categories_sort DEFAULT ((100)),
    created_at DATETIME2(0) NOT NULL CONSTRAINT DF_expense_categories_created DEFAULT (sysdatetime()),
    updated_at DATETIME2(0) NULL,
    CONSTRAINT PK_expense_categories PRIMARY KEY CLUSTERED (id)
);
END;

IF OBJECT_ID(N'dbo.CK_expense_categories_kind', 'C') IS NULL
ALTER TABLE dbo.expense_categories WITH CHECK ADD CONSTRAINT CK_expense_categories_kind CHECK ([kind]='PERSONAL' OR [kind]='GENERAL');

IF OBJECT_ID(N'dbo.CK_expense_categories_name', 'C') IS NULL
ALTER TABLE dbo.expense_categories WITH CHECK ADD CONSTRAINT CK_expense_categories_name CHECK (len(ltrim(rtrim([name])))>(0));

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'UX_expense_categories_name' AND object_id = OBJECT_ID(N'dbo.expense_categories'))
CREATE UNIQUE NONCLUSTERED INDEX UX_expense_categories_name ON dbo.expense_categories (name);
