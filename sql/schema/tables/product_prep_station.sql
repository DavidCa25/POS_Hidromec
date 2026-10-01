/* product_prep_station
 * Definicion canonica del esquema. Reconstruida desde sys.* con
 * scripts/db/extraer-esquema.mjs. SQL Server no guarda el texto del
 * CREATE TABLE original, asi que esto es equivalente, no literal.
 */
IF OBJECT_ID(N'dbo.product_prep_station', 'U') IS NULL
BEGIN
CREATE TABLE dbo.product_prep_station (
    product_id INT NOT NULL,
    station_id INT NOT NULL,
    updated_at DATETIME2(7) NOT NULL CONSTRAINT DF_product_prep_station_upd DEFAULT (sysdatetime()),
    CONSTRAINT PK_product_prep_station PRIMARY KEY CLUSTERED (product_id)
);
END;

IF OBJECT_ID(N'dbo.FK_product_prep_station_product', 'F') IS NULL
ALTER TABLE dbo.product_prep_station WITH CHECK ADD CONSTRAINT FK_product_prep_station_product FOREIGN KEY (product_id) REFERENCES dbo.products (id);

IF OBJECT_ID(N'dbo.FK_product_prep_station_station', 'F') IS NULL
ALTER TABLE dbo.product_prep_station WITH CHECK ADD CONSTRAINT FK_product_prep_station_station FOREIGN KEY (station_id) REFERENCES dbo.prep_stations (id);
