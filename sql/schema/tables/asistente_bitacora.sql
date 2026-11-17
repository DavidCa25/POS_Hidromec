/* asistente_bitacora
 * Definicion canonica del esquema. Reconstruida desde sys.* con
 * scripts/db/extraer-esquema.mjs. SQL Server no guarda el texto del
 * CREATE TABLE original, asi que esto es equivalente, no literal.
 */
IF OBJECT_ID(N'dbo.asistente_bitacora', 'U') IS NULL
BEGIN
CREATE TABLE dbo.asistente_bitacora (
    id BIGINT IDENTITY(1, 1) NOT NULL,
    evento VARCHAR(30) COLLATE Modern_Spanish_CI_AS NOT NULL,
    user_id INT NULL,
    plan_id UNIQUEIDENTIFIER NULL,
    hallazgo_id INT NULL,
    detalle NVARCHAR(600) COLLATE Modern_Spanish_CI_AS NULL,
    en DATETIME2(0) NOT NULL CONSTRAINT DF_asistente_bitacora_en DEFAULT (sysdatetime()),
    CONSTRAINT PK_asistente_bitacora PRIMARY KEY CLUSTERED (id)
);
END;
