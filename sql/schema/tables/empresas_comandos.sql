/* empresas_comandos
 * Definicion canonica del esquema. Reconstruida desde sys.* con
 * scripts/db/extraer-esquema.mjs. SQL Server no guarda el texto del
 * CREATE TABLE original, asi que esto es equivalente, no literal.
 */
IF OBJECT_ID(N'dbo.empresas_comandos', 'U') IS NULL
BEGIN
CREATE TABLE dbo.empresas_comandos (
    id INT IDENTITY(1, 1) NOT NULL,
    comando_id UNIQUEIDENTIFIER NOT NULL,
    tipo NVARCHAR(30) COLLATE Modern_Spanish_CI_AS NOT NULL,
    origen_empresa NVARCHAR(200) COLLATE Modern_Spanish_CI_AS NOT NULL,
    origen_usuario NVARCHAR(50) COLLATE Modern_Spanish_CI_AS NULL,
    payload NVARCHAR(MAX) COLLATE Modern_Spanish_CI_AS NOT NULL,
    resultado NVARCHAR(10) COLLATE Modern_Spanish_CI_AS NOT NULL,
    detalle NVARCHAR(400) COLLATE Modern_Spanish_CI_AS NULL,
    product_id INT NULL,
    aplicado_en DATETIME2(0) NOT NULL CONSTRAINT DF_empresas_comandos_aplicado_en DEFAULT (sysdatetime()),
    CONSTRAINT PK_empresas_comandos PRIMARY KEY CLUSTERED (id),
    CONSTRAINT UX_empresas_comandos_comando UNIQUE NONCLUSTERED (comando_id)
);
END;

IF OBJECT_ID(N'dbo.CK_empresas_comandos_resultado', 'C') IS NULL
ALTER TABLE dbo.empresas_comandos WITH CHECK ADD CONSTRAINT CK_empresas_comandos_resultado CHECK ([resultado]=N'RECHAZADO' OR [resultado]=N'APLICADO');

IF OBJECT_ID(N'dbo.CK_empresas_comandos_tipo', 'C') IS NULL
ALTER TABLE dbo.empresas_comandos WITH CHECK ADD CONSTRAINT CK_empresas_comandos_tipo CHECK ([tipo]=N'PRODUCTO_PRECIO' OR [tipo]=N'PRODUCTO_ALTA');
