/* asistente_preferencias
 * Definicion canonica del esquema. Reconstruida desde sys.* con
 * scripts/db/extraer-esquema.mjs. SQL Server no guarda el texto del
 * CREATE TABLE original, asi que esto es equivalente, no literal.
 */
IF OBJECT_ID(N'dbo.asistente_preferencias', 'U') IS NULL
BEGIN
CREATE TABLE dbo.asistente_preferencias (
    user_id INT NOT NULL,
    datos NVARCHAR(1000) COLLATE Modern_Spanish_CI_AS NOT NULL CONSTRAINT DF_asistente_preferencias_datos DEFAULT (N'{}'),
    actualizado_en DATETIME2(0) NOT NULL CONSTRAINT DF_asistente_preferencias_actualizado DEFAULT (sysdatetime()),
    CONSTRAINT PK_asistente_preferencias PRIMARY KEY CLUSTERED (user_id)
);
END;

IF OBJECT_ID(N'dbo.CK_asistente_preferencias_json', 'C') IS NULL
ALTER TABLE dbo.asistente_preferencias WITH CHECK ADD CONSTRAINT CK_asistente_preferencias_json CHECK (isjson([datos])=(1));
