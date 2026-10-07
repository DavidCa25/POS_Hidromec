/* hosp_cuentas
 * Definicion canonica del esquema. Reconstruida desde sys.* con
 * scripts/db/extraer-esquema.mjs. SQL Server no guarda el texto del
 * CREATE TABLE original, asi que esto es equivalente, no literal.
 */
IF OBJECT_ID(N'dbo.hosp_cuentas', 'U') IS NULL
BEGIN
CREATE TABLE dbo.hosp_cuentas (
    id INT IDENTITY(1, 1) NOT NULL,
    mesa_id INT NULL,
    etiqueta NVARCHAR(60) COLLATE Modern_Spanish_CI_AS NULL,
    estado NVARCHAR(12) COLLATE Modern_Spanish_CI_AS NOT NULL CONSTRAINT DF_hosp_cuentas_estado DEFAULT ('ABIERTA'),
    personas INT NULL,
    abierta_por INT NULL,
    abierta_en DATETIME2(7) NOT NULL CONSTRAINT DF_hosp_cuentas_abierta DEFAULT (sysdatetime()),
    cerrada_por INT NULL,
    cerrada_en DATETIME2(7) NULL,
    sale_id INT NULL,
    register_id INT NULL,
    version TIMESTAMP NOT NULL,
    numero_dia INT NULL,
    abierta_dia AS (CONVERT([date],[abierta_en])) PERSISTED,
    seguimiento CHAR(32) COLLATE Modern_Spanish_CI_AS NULL,
    customer_id INT NULL,
    commercial_context NVARCHAR(MAX) COLLATE Modern_Spanish_CI_AS NULL,
    CONSTRAINT PK_hosp_cuentas PRIMARY KEY CLUSTERED (id)
);
END;

IF OBJECT_ID(N'dbo.CK_hosp_cuentas_estado', 'C') IS NULL
ALTER TABLE dbo.hosp_cuentas WITH CHECK ADD CONSTRAINT CK_hosp_cuentas_estado CHECK ([estado]='CANCELADA' OR [estado]='COBRADA' OR [estado]='POR_COBRAR' OR [estado]='ABIERTA');

IF OBJECT_ID(N'dbo.FK_hosp_cuentas_customer', 'F') IS NULL
ALTER TABLE dbo.hosp_cuentas WITH CHECK ADD CONSTRAINT FK_hosp_cuentas_customer FOREIGN KEY (customer_id) REFERENCES dbo.customers (id);

IF OBJECT_ID(N'dbo.FK_hosp_cuentas_mesa', 'F') IS NULL
ALTER TABLE dbo.hosp_cuentas WITH CHECK ADD CONSTRAINT FK_hosp_cuentas_mesa FOREIGN KEY (mesa_id) REFERENCES dbo.salon_mesas (id);

IF OBJECT_ID(N'dbo.FK_hosp_cuentas_sale', 'F') IS NULL
ALTER TABLE dbo.hosp_cuentas WITH CHECK ADD CONSTRAINT FK_hosp_cuentas_sale FOREIGN KEY (sale_id) REFERENCES dbo.sales (id);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_hosp_cuentas_version' AND object_id = OBJECT_ID(N'dbo.hosp_cuentas'))
CREATE NONCLUSTERED INDEX IX_hosp_cuentas_version ON dbo.hosp_cuentas (version) INCLUDE (abierta_por, estado, mesa_id);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'UX_hosp_cuentas_mesa_abierta' AND object_id = OBJECT_ID(N'dbo.hosp_cuentas'))
CREATE UNIQUE NONCLUSTERED INDEX UX_hosp_cuentas_mesa_abierta ON dbo.hosp_cuentas (mesa_id) WHERE ([mesa_id] IS NOT NULL AND ([estado] IN ('ABIERTA', 'POR_COBRAR')));

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'UX_hosp_cuentas_numero_dia' AND object_id = OBJECT_ID(N'dbo.hosp_cuentas'))
CREATE UNIQUE NONCLUSTERED INDEX UX_hosp_cuentas_numero_dia ON dbo.hosp_cuentas (abierta_dia, numero_dia) WHERE ([numero_dia] IS NOT NULL);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'UX_hosp_cuentas_sale' AND object_id = OBJECT_ID(N'dbo.hosp_cuentas'))
CREATE UNIQUE NONCLUSTERED INDEX UX_hosp_cuentas_sale ON dbo.hosp_cuentas (sale_id) WHERE ([sale_id] IS NOT NULL);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'UX_hosp_cuentas_seguimiento' AND object_id = OBJECT_ID(N'dbo.hosp_cuentas'))
CREATE UNIQUE NONCLUSTERED INDEX UX_hosp_cuentas_seguimiento ON dbo.hosp_cuentas (seguimiento) WHERE ([seguimiento] IS NOT NULL);
