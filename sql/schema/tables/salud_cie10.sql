/* salud_cie10
 * Definicion canonica del esquema. Reconstruida desde sys.* con
 * scripts/db/extraer-esquema.mjs. SQL Server no guarda el texto del
 * CREATE TABLE original, asi que esto es equivalente, no literal.
 */
IF OBJECT_ID(N'dbo.salud_cie10', 'U') IS NULL
BEGIN
CREATE TABLE dbo.salud_cie10 (
    codigo NVARCHAR(10) COLLATE Modern_Spanish_CI_AS NOT NULL,
    descripcion NVARCHAR(250) COLLATE Modern_Spanish_CI_AS NOT NULL,
    CONSTRAINT PK_salud_cie10 PRIMARY KEY CLUSTERED (codigo)
);
END;
