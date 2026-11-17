/* asistente_alias
 * Definicion canonica del esquema. Reconstruida desde sys.* con
 * scripts/db/extraer-esquema.mjs. SQL Server no guarda el texto del
 * CREATE TABLE original, asi que esto es equivalente, no literal.
 */
IF OBJECT_ID(N'dbo.asistente_alias', 'U') IS NULL
BEGIN
CREATE TABLE dbo.asistente_alias (
    id INT IDENTITY(1, 1) NOT NULL,
    alias NVARCHAR(60) COLLATE Modern_Spanish_CI_AS NOT NULL,
    tipo VARCHAR(12) COLLATE Modern_Spanish_CI_AS NOT NULL,
    ref_id INT NOT NULL,
    origen VARCHAR(12) COLLATE Modern_Spanish_CI_AS NOT NULL CONSTRAINT DF_asistente_alias_origen DEFAULT ('ensenado'),
    user_id INT NULL,
    en DATETIME2(0) NOT NULL CONSTRAINT DF_asistente_alias_en DEFAULT (sysdatetime()),
    CONSTRAINT PK_asistente_alias PRIMARY KEY CLUSTERED (id),
    CONSTRAINT UX_asistente_alias_alias UNIQUE NONCLUSTERED (alias)
);
END;

IF OBJECT_ID(N'dbo.CK_asistente_alias_origen', 'C') IS NULL
ALTER TABLE dbo.asistente_alias WITH CHECK ADD CONSTRAINT CK_asistente_alias_origen CHECK ([origen]='aprendido' OR [origen]='ensenado');

IF OBJECT_ID(N'dbo.CK_asistente_alias_tipo', 'C') IS NULL
ALTER TABLE dbo.asistente_alias WITH CHECK ADD CONSTRAINT CK_asistente_alias_tipo CHECK ([tipo]='profesional' OR [tipo]='proveedor' OR [tipo]='cliente' OR [tipo]='producto');
