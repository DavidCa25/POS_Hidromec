/* propinas_repartos
 * Definicion canonica del esquema. Reconstruida desde sys.* con
 * scripts/db/extraer-esquema.mjs. SQL Server no guarda el texto del
 * CREATE TABLE original, asi que esto es equivalente, no literal.
 */
IF OBJECT_ID(N'dbo.propinas_repartos', 'U') IS NULL
BEGIN
CREATE TABLE dbo.propinas_repartos (
    id INT IDENTITY(1, 1) NOT NULL,
    register_id INT NOT NULL,
    closure_id INT NULL,
    desde DATETIME2(0) NOT NULL,
    hasta DATETIME2(0) NOT NULL,
    modo VARCHAR(8) COLLATE Modern_Spanish_CI_AS NOT NULL,
    total DECIMAL(12, 2) NOT NULL,
    comision DECIMAL(12, 2) NOT NULL,
    neto DECIMAL(12, 2) NOT NULL,
    user_id INT NULL,
    created_at DATETIME2(0) NOT NULL CONSTRAINT DF_propinas_repartos_created DEFAULT (sysdatetime()),
    CONSTRAINT PK_propinas_repartos PRIMARY KEY CLUSTERED (id)
);
END;

IF OBJECT_ID(N'dbo.FK_propinas_repartos_register', 'F') IS NULL
ALTER TABLE dbo.propinas_repartos WITH CHECK ADD CONSTRAINT FK_propinas_repartos_register FOREIGN KEY (register_id) REFERENCES dbo.registers (id);
