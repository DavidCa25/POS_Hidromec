/* WA_Configuracion
 * Definicion canonica del esquema. Reconstruida desde sys.* con
 * scripts/db/extraer-esquema.mjs. SQL Server no guarda el texto del
 * CREATE TABLE original, asi que esto es equivalente, no literal.
 */
IF OBJECT_ID(N'dbo.WA_Configuracion', 'U') IS NULL
BEGIN
CREATE TABLE dbo.WA_Configuracion (
    Id INT IDENTITY(1, 1) NOT NULL,
    SucursalId INT NULL,
    Activo BIT NOT NULL DEFAULT ((0)),
    AutoEnviarTicket BIT NOT NULL DEFAULT ((1)),
    UpdatedAt DATETIME NOT NULL DEFAULT (getdate()),
    PRIMARY KEY CLUSTERED (Id)
);
END;
