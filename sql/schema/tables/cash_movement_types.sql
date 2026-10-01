/* cash_movement_types
 * Definicion canonica del esquema. Reconstruida desde sys.* con
 * scripts/db/extraer-esquema.mjs. SQL Server no guarda el texto del
 * CREATE TABLE original, asi que esto es equivalente, no literal.
 */
IF OBJECT_ID(N'dbo.cash_movement_types', 'U') IS NULL
BEGIN
CREATE TABLE dbo.cash_movement_types (
    code VARCHAR(30) COLLATE Modern_Spanish_CI_AS NOT NULL,
    label NVARCHAR(60) COLLATE Modern_Spanish_CI_AS NOT NULL,
    grupo VARCHAR(20) COLLATE Modern_Spanish_CI_AS NOT NULL,
    sort_order INT NOT NULL CONSTRAINT DF_cash_movement_types_sort DEFAULT ((100)),
    CONSTRAINT PK_cash_movement_types PRIMARY KEY CLUSTERED (code)
);
END;

IF OBJECT_ID(N'dbo.CK_cash_movement_types_grupo', 'C') IS NULL
ALTER TABLE dbo.cash_movement_types WITH CHECK ADD CONSTRAINT CK_cash_movement_types_grupo CHECK ([grupo]='OTROS' OR [grupo]='EGRESOS' OR [grupo]='PROVEEDORES' OR [grupo]='RETIROS' OR [grupo]='AJUSTES' OR [grupo]='DEVOLUCIONES' OR [grupo]='ENTRADAS' OR [grupo]='ABONOS' OR [grupo]='VENTAS' OR [grupo]='FONDO');
