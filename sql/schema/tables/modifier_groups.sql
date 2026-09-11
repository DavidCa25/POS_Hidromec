/* modifier_groups
 * Definicion canonica del esquema. Reconstruida desde sys.* con
 * scripts/db/extraer-esquema.mjs. SQL Server no guarda el texto del
 * CREATE TABLE original, asi que esto es equivalente, no literal.
 */
IF OBJECT_ID(N'dbo.modifier_groups', 'U') IS NULL
BEGIN
CREATE TABLE dbo.modifier_groups (
    id INT IDENTITY(1, 1) NOT NULL,
    name NVARCHAR(80) COLLATE Modern_Spanish_CI_AS NOT NULL,
    role NVARCHAR(15) COLLATE Modern_Spanish_CI_AS NOT NULL,
    min_select INT NOT NULL CONSTRAINT DF_modifier_groups_min_select DEFAULT ((0)),
    max_select INT NOT NULL CONSTRAINT DF_modifier_groups_max_select DEFAULT ((1)),
    required BIT NOT NULL CONSTRAINT DF_modifier_groups_required DEFAULT ((0)),
    active BIT NOT NULL CONSTRAINT DF_modifier_groups_active DEFAULT ((1)),
    sort_order INT NOT NULL CONSTRAINT DF_modifier_groups_sort_order DEFAULT ((0)),
    CONSTRAINT PK_modifier_groups PRIMARY KEY CLUSTERED (id)
);
END;

IF OBJECT_ID(N'dbo.CK_modifier_groups_role', 'C') IS NULL
ALTER TABLE dbo.modifier_groups WITH CHECK ADD CONSTRAINT CK_modifier_groups_role CHECK ([role]='NOTE' OR [role]='SUBSTITUTION' OR [role]='ADDON' OR [role]='SIZE');

IF OBJECT_ID(N'dbo.CK_modifier_groups_select', 'C') IS NULL
ALTER TABLE dbo.modifier_groups WITH CHECK ADD CONSTRAINT CK_modifier_groups_select CHECK ([min_select]>=(0) AND [max_select]>=(1) AND [min_select]<=[max_select]);
