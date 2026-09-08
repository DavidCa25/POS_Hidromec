/* uoms
 * Definicion canonica del esquema. Reconstruida desde sys.* con
 * scripts/db/extraer-esquema.mjs. SQL Server no guarda el texto del
 * CREATE TABLE original, asi que esto es equivalente, no literal.
 */
IF OBJECT_ID(N'dbo.uoms', 'U') IS NULL
BEGIN
CREATE TABLE dbo.uoms (
    code NVARCHAR(10) COLLATE Modern_Spanish_CI_AS NOT NULL,
    name NVARCHAR(50) COLLATE Modern_Spanish_CI_AS NOT NULL,
    dimension NVARCHAR(10) COLLATE Modern_Spanish_CI_AS NOT NULL,
    factor_to_base DECIMAL(18, 6) NOT NULL,
    is_base BIT NOT NULL CONSTRAINT DF_uoms_is_base DEFAULT ((0)),
    sort_order INT NOT NULL CONSTRAINT DF_uoms_sort_order DEFAULT ((0)),
    CONSTRAINT PK_uoms PRIMARY KEY CLUSTERED (code)
);
END;

IF OBJECT_ID(N'dbo.CK_uoms_dimension', 'C') IS NULL
ALTER TABLE dbo.uoms WITH CHECK ADD CONSTRAINT CK_uoms_dimension CHECK ([dimension]='LENGTH' OR [dimension]='VOLUME' OR [dimension]='WEIGHT' OR [dimension]='COUNT');

IF OBJECT_ID(N'dbo.CK_uoms_factor', 'C') IS NULL
ALTER TABLE dbo.uoms WITH CHECK ADD CONSTRAINT CK_uoms_factor CHECK ([factor_to_base]>(0));
