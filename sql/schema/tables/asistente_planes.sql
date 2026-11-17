/* asistente_planes
 * Definicion canonica del esquema. Reconstruida desde sys.* con
 * scripts/db/extraer-esquema.mjs. SQL Server no guarda el texto del
 * CREATE TABLE original, asi que esto es equivalente, no literal.
 */
IF OBJECT_ID(N'dbo.asistente_planes', 'U') IS NULL
BEGIN
CREATE TABLE dbo.asistente_planes (
    id UNIQUEIDENTIFIER NOT NULL,
    intent VARCHAR(60) COLLATE Modern_Spanish_CI_AS NOT NULL,
    nivel VARCHAR(12) COLLATE Modern_Spanish_CI_AS NOT NULL,
    titulo NVARCHAR(200) COLLATE Modern_Spanish_CI_AS NOT NULL,
    vista NVARCHAR(MAX) COLLATE Modern_Spanish_CI_AS NULL,
    ejecutar NVARCHAR(MAX) COLLATE Modern_Spanish_CI_AS NULL,
    origen VARCHAR(12) COLLATE Modern_Spanish_CI_AS NOT NULL,
    texto NVARCHAR(400) COLLATE Modern_Spanish_CI_AS NULL,
    hallazgo_id INT NULL,
    user_id INT NULL,
    estado VARCHAR(12) COLLATE Modern_Spanish_CI_AS NOT NULL CONSTRAINT DF_asistente_planes_estado DEFAULT ('borrador'),
    creado_en DATETIME2(0) NOT NULL CONSTRAINT DF_asistente_planes_creado DEFAULT (sysdatetime()),
    caduca_en DATETIME2(0) NOT NULL,
    cerrado_en DATETIME2(0) NULL,
    resultado NVARCHAR(MAX) COLLATE Modern_Spanish_CI_AS NULL,
    CONSTRAINT PK_asistente_planes PRIMARY KEY CLUSTERED (id)
);
END;

IF OBJECT_ID(N'dbo.CK_asistente_planes_estado', 'C') IS NULL
ALTER TABLE dbo.asistente_planes WITH CHECK ADD CONSTRAINT CK_asistente_planes_estado CHECK ([estado]='caducado' OR [estado]='cancelado' OR [estado]='fallido' OR [estado]='ejecutado' OR [estado]='borrador');

IF OBJECT_ID(N'dbo.CK_asistente_planes_origen', 'C') IS NULL
ALTER TABLE dbo.asistente_planes WITH CHECK ADD CONSTRAINT CK_asistente_planes_origen CHECK ([origen]='hallazgo' OR [origen]='comando');
