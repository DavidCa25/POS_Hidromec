/* hosp_orden_lineas
 * Definicion canonica del esquema. Reconstruida desde sys.* con
 * scripts/db/extraer-esquema.mjs. SQL Server no guarda el texto del
 * CREATE TABLE original, asi que esto es equivalente, no literal.
 */
IF OBJECT_ID(N'dbo.hosp_orden_lineas', 'U') IS NULL
BEGIN
CREATE TABLE dbo.hosp_orden_lineas (
    id INT IDENTITY(1, 1) NOT NULL,
    orden_id INT NOT NULL,
    cuenta_id INT NOT NULL,
    product_id INT NOT NULL,
    nombre NVARCHAR(150) COLLATE Modern_Spanish_CI_AS NOT NULL,
    cantidad DECIMAL(12, 3) NOT NULL,
    precio_unitario DECIMAL(10, 2) NOT NULL,
    nota NVARCHAR(200) COLLATE Modern_Spanish_CI_AS NULL,
    station_id INT NULL,
    comanda_id INT NULL,
    estado NVARCHAR(10) COLLATE Modern_Spanish_CI_AS NOT NULL CONSTRAINT DF_hosp_orden_lineas_estado DEFAULT ('ACTIVA'),
    origen UNIQUEIDENTIFIER NULL,
    commercial_component NVARCHAR(MAX) COLLATE Modern_Spanish_CI_AS NULL,
    CONSTRAINT PK_hosp_orden_lineas PRIMARY KEY CLUSTERED (id)
);
END;

IF OBJECT_ID(N'dbo.CK_hosp_orden_lineas_cant', 'C') IS NULL
ALTER TABLE dbo.hosp_orden_lineas WITH CHECK ADD CONSTRAINT CK_hosp_orden_lineas_cant CHECK ([cantidad]>(0));

IF OBJECT_ID(N'dbo.CK_hosp_orden_lineas_estado', 'C') IS NULL
ALTER TABLE dbo.hosp_orden_lineas WITH CHECK ADD CONSTRAINT CK_hosp_orden_lineas_estado CHECK ([estado]='CANCELADA' OR [estado]='ACTIVA');

IF OBJECT_ID(N'dbo.FK_hosp_orden_lineas_comanda', 'F') IS NULL
ALTER TABLE dbo.hosp_orden_lineas WITH CHECK ADD CONSTRAINT FK_hosp_orden_lineas_comanda FOREIGN KEY (comanda_id) REFERENCES dbo.comandas (id);

IF OBJECT_ID(N'dbo.FK_hosp_orden_lineas_cuenta', 'F') IS NULL
ALTER TABLE dbo.hosp_orden_lineas WITH CHECK ADD CONSTRAINT FK_hosp_orden_lineas_cuenta FOREIGN KEY (cuenta_id) REFERENCES dbo.hosp_cuentas (id);

IF OBJECT_ID(N'dbo.FK_hosp_orden_lineas_orden', 'F') IS NULL
ALTER TABLE dbo.hosp_orden_lineas WITH CHECK ADD CONSTRAINT FK_hosp_orden_lineas_orden FOREIGN KEY (orden_id) REFERENCES dbo.hosp_ordenes (id);

IF OBJECT_ID(N'dbo.FK_hosp_orden_lineas_product', 'F') IS NULL
ALTER TABLE dbo.hosp_orden_lineas WITH CHECK ADD CONSTRAINT FK_hosp_orden_lineas_product FOREIGN KEY (product_id) REFERENCES dbo.products (id);

IF OBJECT_ID(N'dbo.FK_hosp_orden_lineas_station', 'F') IS NULL
ALTER TABLE dbo.hosp_orden_lineas WITH CHECK ADD CONSTRAINT FK_hosp_orden_lineas_station FOREIGN KEY (station_id) REFERENCES dbo.prep_stations (id);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_hosp_orden_lineas_comanda' AND object_id = OBJECT_ID(N'dbo.hosp_orden_lineas'))
CREATE NONCLUSTERED INDEX IX_hosp_orden_lineas_comanda ON dbo.hosp_orden_lineas (comanda_id);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_hosp_orden_lineas_cuenta' AND object_id = OBJECT_ID(N'dbo.hosp_orden_lineas'))
CREATE NONCLUSTERED INDEX IX_hosp_orden_lineas_cuenta ON dbo.hosp_orden_lineas (cuenta_id);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'UX_hosp_orden_lineas_origen' AND object_id = OBJECT_ID(N'dbo.hosp_orden_lineas'))
CREATE UNIQUE NONCLUSTERED INDEX UX_hosp_orden_lineas_origen ON dbo.hosp_orden_lineas (origen) WHERE ([origen] IS NOT NULL);
