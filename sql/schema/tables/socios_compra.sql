/* socios_compra
 * Definicion canonica del esquema. Reconstruida desde sys.* con
 * scripts/db/extraer-esquema.mjs. SQL Server no guarda el texto del
 * CREATE TABLE original, asi que esto es equivalente, no literal.
 */
IF OBJECT_ID(N'dbo.socios_compra', 'U') IS NULL
BEGIN
CREATE TABLE dbo.socios_compra (
    purchase_id INT NOT NULL,
    pagado_por_socio_id INT NOT NULL,
    CONSTRAINT PK_socios_compra PRIMARY KEY CLUSTERED (purchase_id)
);
END;

IF OBJECT_ID(N'dbo.FK_socios_compra_purchase', 'F') IS NULL
ALTER TABLE dbo.socios_compra WITH CHECK ADD CONSTRAINT FK_socios_compra_purchase FOREIGN KEY (purchase_id) REFERENCES dbo.purchase (id);

IF OBJECT_ID(N'dbo.FK_socios_compra_socio', 'F') IS NULL
ALTER TABLE dbo.socios_compra WITH CHECK ADD CONSTRAINT FK_socios_compra_socio FOREIGN KEY (pagado_por_socio_id) REFERENCES dbo.socios (id);
