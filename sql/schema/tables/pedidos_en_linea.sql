/* pedidos_en_linea
 * Definicion canonica del esquema. Reconstruida desde sys.* con
 * scripts/db/extraer-esquema.mjs. SQL Server no guarda el texto del
 * CREATE TABLE original, asi que esto es equivalente, no literal.
 */
IF OBJECT_ID(N'dbo.pedidos_en_linea', 'U') IS NULL
BEGIN
CREATE TABLE dbo.pedidos_en_linea (
    id INT IDENTITY(1, 1) NOT NULL,
    uuid UNIQUEIDENTIFIER NOT NULL,
    origen NVARCHAR(12) COLLATE Modern_Spanish_CI_AS NULL,
    cliente_nombre NVARCHAR(60) COLLATE Modern_Spanish_CI_AS NOT NULL,
    cliente_telefono NVARCHAR(20) COLLATE Modern_Spanish_CI_AS NOT NULL,
    nota NVARCHAR(200) COLLATE Modern_Spanish_CI_AS NULL,
    lineas NVARCHAR(MAX) COLLATE Modern_Spanish_CI_AS NOT NULL,
    total_cliente DECIMAL(12, 2) NOT NULL,
    creado_en_nube DATETIME2(0) NULL,
    recibido_en DATETIME2(0) NOT NULL CONSTRAINT DF_pedidos_en_linea_recibido DEFAULT (sysdatetime()),
    estado NVARCHAR(12) COLLATE Modern_Spanish_CI_AS NOT NULL CONSTRAINT DF_pedidos_en_linea_estado DEFAULT ('PENDIENTE'),
    decidido_en DATETIME2(0) NULL,
    decidido_por INT NULL,
    motivo NVARCHAR(200) COLLATE Modern_Spanish_CI_AS NULL,
    cuenta_id INT NULL,
    estado_publicado NVARCHAR(12) COLLATE Modern_Spanish_CI_AS NULL,
    publicado_en DATETIME2(0) NULL,
    CONSTRAINT PK_pedidos_en_linea PRIMARY KEY CLUSTERED (id)
);
END;

IF OBJECT_ID(N'dbo.CK_pedidos_en_linea_cuenta', 'C') IS NULL
ALTER TABLE dbo.pedidos_en_linea WITH CHECK ADD CONSTRAINT CK_pedidos_en_linea_cuenta CHECK ([estado]<>'ACEPTADO' OR [cuenta_id] IS NOT NULL);

IF OBJECT_ID(N'dbo.CK_pedidos_en_linea_estado', 'C') IS NULL
ALTER TABLE dbo.pedidos_en_linea WITH CHECK ADD CONSTRAINT CK_pedidos_en_linea_estado CHECK ([estado]='RECHAZADO' OR [estado]='ACEPTADO' OR [estado]='PENDIENTE');

IF OBJECT_ID(N'dbo.CK_pedidos_en_linea_json', 'C') IS NULL
ALTER TABLE dbo.pedidos_en_linea WITH CHECK ADD CONSTRAINT CK_pedidos_en_linea_json CHECK (isjson([lineas])=(1));

IF OBJECT_ID(N'dbo.FK_pedidos_en_linea_cuenta', 'F') IS NULL
ALTER TABLE dbo.pedidos_en_linea WITH CHECK ADD CONSTRAINT FK_pedidos_en_linea_cuenta FOREIGN KEY (cuenta_id) REFERENCES dbo.hosp_cuentas (id);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_pedidos_en_linea_estado' AND object_id = OBJECT_ID(N'dbo.pedidos_en_linea'))
CREATE NONCLUSTERED INDEX IX_pedidos_en_linea_estado ON dbo.pedidos_en_linea (estado, recibido_en);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'UX_pedidos_en_linea_cuenta' AND object_id = OBJECT_ID(N'dbo.pedidos_en_linea'))
CREATE UNIQUE NONCLUSTERED INDEX UX_pedidos_en_linea_cuenta ON dbo.pedidos_en_linea (cuenta_id) WHERE ([cuenta_id] IS NOT NULL);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'UX_pedidos_en_linea_uuid' AND object_id = OBJECT_ID(N'dbo.pedidos_en_linea'))
CREATE UNIQUE NONCLUSTERED INDEX UX_pedidos_en_linea_uuid ON dbo.pedidos_en_linea (uuid);
