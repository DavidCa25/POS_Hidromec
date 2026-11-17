/* empresas_grupo_bases
 * Definicion canonica del esquema. Reconstruida desde sys.* con
 * scripts/db/extraer-esquema.mjs. SQL Server no guarda el texto del
 * CREATE TABLE original, asi que esto es equivalente, no literal.
 */
IF OBJECT_ID(N'dbo.empresas_grupo_bases', 'U') IS NULL
BEGIN
CREATE TABLE dbo.empresas_grupo_bases (
    base SYSNAME COLLATE Modern_Spanish_CI_AS NOT NULL,
    agregada_en DATETIME2(0) NOT NULL CONSTRAINT DF_empresas_grupo_bases_agregada_en DEFAULT (sysdatetime()),
    CONSTRAINT PK_empresas_grupo_bases PRIMARY KEY CLUSTERED (base)
);
END;
