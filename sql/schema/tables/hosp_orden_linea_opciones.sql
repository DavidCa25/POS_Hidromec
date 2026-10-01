/* hosp_orden_linea_opciones
 * Definicion canonica del esquema. Reconstruida desde sys.* con
 * scripts/db/extraer-esquema.mjs. SQL Server no guarda el texto del
 * CREATE TABLE original, asi que esto es equivalente, no literal.
 */
IF OBJECT_ID(N'dbo.hosp_orden_linea_opciones', 'U') IS NULL
BEGIN
CREATE TABLE dbo.hosp_orden_linea_opciones (
    id INT IDENTITY(1, 1) NOT NULL,
    linea_id INT NOT NULL,
    modifier_option_id INT NOT NULL,
    group_id INT NULL,
    group_name NVARCHAR(80) COLLATE Modern_Spanish_CI_AS NULL,
    option_name NVARCHAR(80) COLLATE Modern_Spanish_CI_AS NOT NULL,
    price_delta DECIMAL(10, 2) NOT NULL CONSTRAINT DF_hosp_olo_delta DEFAULT ((0)),
    quantity INT NOT NULL CONSTRAINT DF_hosp_olo_qty DEFAULT ((1)),
    CONSTRAINT PK_hosp_orden_linea_opciones PRIMARY KEY CLUSTERED (id)
);
END;

IF OBJECT_ID(N'dbo.FK_hosp_olo_linea', 'F') IS NULL
ALTER TABLE dbo.hosp_orden_linea_opciones WITH CHECK ADD CONSTRAINT FK_hosp_olo_linea FOREIGN KEY (linea_id) REFERENCES dbo.hosp_orden_lineas (id);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_hosp_olo_linea' AND object_id = OBJECT_ID(N'dbo.hosp_orden_linea_opciones'))
CREATE NONCLUSTERED INDEX IX_hosp_olo_linea ON dbo.hosp_orden_linea_opciones (linea_id);
