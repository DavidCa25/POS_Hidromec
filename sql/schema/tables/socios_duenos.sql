/* socios_duenos
 * Definicion canonica del esquema. Reconstruida desde sys.* con
 * scripts/db/extraer-esquema.mjs. SQL Server no guarda el texto del
 * CREATE TABLE original, asi que esto es equivalente, no literal.
 */
IF OBJECT_ID(N'dbo.socios_duenos', 'U') IS NULL
BEGIN
CREATE TABLE dbo.socios_duenos (
    entidad VARCHAR(10) COLLATE Modern_Spanish_CI_AS NOT NULL,
    entidad_id INT NOT NULL,
    socio_id INT NOT NULL,
    pct DECIMAL(7, 4) NOT NULL,
    CONSTRAINT PK_socios_duenos PRIMARY KEY CLUSTERED (entidad, entidad_id, socio_id)
);
END;

IF OBJECT_ID(N'dbo.CK_socios_duenos_entidad', 'C') IS NULL
ALTER TABLE dbo.socios_duenos WITH CHECK ADD CONSTRAINT CK_socios_duenos_entidad CHECK ([entidad]='PRODUCTO' OR [entidad]='CATEGORIA');

IF OBJECT_ID(N'dbo.CK_socios_duenos_pct', 'C') IS NULL
ALTER TABLE dbo.socios_duenos WITH CHECK ADD CONSTRAINT CK_socios_duenos_pct CHECK ([pct]>(0) AND [pct]<=(100));

IF OBJECT_ID(N'dbo.FK_socios_duenos_socio', 'F') IS NULL
ALTER TABLE dbo.socios_duenos WITH CHECK ADD CONSTRAINT FK_socios_duenos_socio FOREIGN KEY (socio_id) REFERENCES dbo.socios (id);
