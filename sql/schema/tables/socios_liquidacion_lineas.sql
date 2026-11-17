/* socios_liquidacion_lineas
 * Definicion canonica del esquema. Reconstruida desde sys.* con
 * scripts/db/extraer-esquema.mjs. SQL Server no guarda el texto del
 * CREATE TABLE original, asi que esto es equivalente, no literal.
 */
IF OBJECT_ID(N'dbo.socios_liquidacion_lineas', 'U') IS NULL
BEGIN
CREATE TABLE dbo.socios_liquidacion_lineas (
    liquidacion_id INT NOT NULL,
    socio_id INT NOT NULL,
    vendido DECIMAL(14, 2) NOT NULL,
    costo DECIMAL(14, 2) NOT NULL,
    ganancia DECIMAL(14, 2) NOT NULL,
    gastos DECIMAL(14, 2) NOT NULL,
    anticipos DECIMAL(14, 2) NOT NULL,
    aportaciones DECIMAL(14, 2) NOT NULL,
    retiros DECIMAL(14, 2) NOT NULL,
    faltantes DECIMAL(14, 2) NOT NULL,
    resultado DECIMAL(14, 2) NOT NULL,
    saldo_inicial DECIMAL(14, 2) NOT NULL,
    saldo_final DECIMAL(14, 2) NOT NULL,
    CONSTRAINT PK_socios_liquidacion_lineas PRIMARY KEY CLUSTERED (liquidacion_id, socio_id)
);
END;

IF OBJECT_ID(N'dbo.FK_socios_liq_lineas_liq', 'F') IS NULL
ALTER TABLE dbo.socios_liquidacion_lineas WITH CHECK ADD CONSTRAINT FK_socios_liq_lineas_liq FOREIGN KEY (liquidacion_id) REFERENCES dbo.socios_liquidaciones (id);

IF OBJECT_ID(N'dbo.FK_socios_liq_lineas_socio', 'F') IS NULL
ALTER TABLE dbo.socios_liquidacion_lineas WITH CHECK ADD CONSTRAINT FK_socios_liq_lineas_socio FOREIGN KEY (socio_id) REFERENCES dbo.socios (id);
