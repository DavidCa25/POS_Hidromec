/* propinas_reparto_lineas
 * Definicion canonica del esquema. Reconstruida desde sys.* con
 * scripts/db/extraer-esquema.mjs. SQL Server no guarda el texto del
 * CREATE TABLE original, asi que esto es equivalente, no literal.
 */
IF OBJECT_ID(N'dbo.propinas_reparto_lineas', 'U') IS NULL
BEGIN
CREATE TABLE dbo.propinas_reparto_lineas (
    reparto_id INT NOT NULL,
    user_id INT NOT NULL,
    horas DECIMAL(9, 2) NULL,
    monto DECIMAL(12, 2) NOT NULL,
    cash_movement_id INT NULL,
    CONSTRAINT PK_propinas_reparto_lineas PRIMARY KEY CLUSTERED (reparto_id, user_id)
);
END;

IF OBJECT_ID(N'dbo.FK_propinas_reparto_lineas_cash', 'F') IS NULL
ALTER TABLE dbo.propinas_reparto_lineas WITH CHECK ADD CONSTRAINT FK_propinas_reparto_lineas_cash FOREIGN KEY (cash_movement_id) REFERENCES dbo.cash_movements (id);

IF OBJECT_ID(N'dbo.FK_propinas_reparto_lineas_reparto', 'F') IS NULL
ALTER TABLE dbo.propinas_reparto_lineas WITH CHECK ADD CONSTRAINT FK_propinas_reparto_lineas_reparto FOREIGN KEY (reparto_id) REFERENCES dbo.propinas_repartos (id);

IF OBJECT_ID(N'dbo.FK_propinas_reparto_lineas_user', 'F') IS NULL
ALTER TABLE dbo.propinas_reparto_lineas WITH CHECK ADD CONSTRAINT FK_propinas_reparto_lineas_user FOREIGN KEY (user_id) REFERENCES dbo.users (id);
