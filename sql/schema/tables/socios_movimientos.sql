/* socios_movimientos
 * Definicion canonica del esquema. Reconstruida desde sys.* con
 * scripts/db/extraer-esquema.mjs. SQL Server no guarda el texto del
 * CREATE TABLE original, asi que esto es equivalente, no literal.
 */
IF OBJECT_ID(N'dbo.socios_movimientos', 'U') IS NULL
BEGIN
CREATE TABLE dbo.socios_movimientos (
    id INT IDENTITY(1, 1) NOT NULL,
    socio_id INT NOT NULL,
    fecha DATETIME2(0) NOT NULL CONSTRAINT DF_socios_movimientos_fecha DEFAULT (sysdatetime()),
    tipo VARCHAR(12) COLLATE Modern_Spanish_CI_AS NOT NULL,
    monto DECIMAL(12, 2) NOT NULL,
    metodo VARCHAR(20) COLLATE Modern_Spanish_CI_AS NOT NULL,
    register_id INT NULL,
    cash_movement_id INT NULL,
    nota NVARCHAR(255) COLLATE Modern_Spanish_CI_AS NULL,
    user_id INT NULL,
    CONSTRAINT PK_socios_movimientos PRIMARY KEY CLUSTERED (id)
);
END;

IF OBJECT_ID(N'dbo.CK_socios_movimientos_cash', 'C') IS NULL
ALTER TABLE dbo.socios_movimientos WITH CHECK ADD CONSTRAINT CK_socios_movimientos_cash CHECK ([metodo]<>'EFECTIVO' OR [cash_movement_id] IS NOT NULL);

IF OBJECT_ID(N'dbo.CK_socios_movimientos_metodo', 'C') IS NULL
ALTER TABLE dbo.socios_movimientos WITH CHECK ADD CONSTRAINT CK_socios_movimientos_metodo CHECK ([metodo]='OTRO' OR [metodo]='TRANSFERENCIA' OR [metodo]='EFECTIVO');

IF OBJECT_ID(N'dbo.CK_socios_movimientos_monto', 'C') IS NULL
ALTER TABLE dbo.socios_movimientos WITH CHECK ADD CONSTRAINT CK_socios_movimientos_monto CHECK ([monto]>(0));

IF OBJECT_ID(N'dbo.CK_socios_movimientos_tipo', 'C') IS NULL
ALTER TABLE dbo.socios_movimientos WITH CHECK ADD CONSTRAINT CK_socios_movimientos_tipo CHECK ([tipo]='APORTACION' OR [tipo]='PAGO' OR [tipo]='RETIRO');

IF OBJECT_ID(N'dbo.FK_socios_movimientos_cash', 'F') IS NULL
ALTER TABLE dbo.socios_movimientos WITH CHECK ADD CONSTRAINT FK_socios_movimientos_cash FOREIGN KEY (cash_movement_id) REFERENCES dbo.cash_movements (id);

IF OBJECT_ID(N'dbo.FK_socios_movimientos_socio', 'F') IS NULL
ALTER TABLE dbo.socios_movimientos WITH CHECK ADD CONSTRAINT FK_socios_movimientos_socio FOREIGN KEY (socio_id) REFERENCES dbo.socios (id);
