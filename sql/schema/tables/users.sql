/* users
 * Definicion canonica del esquema. Reconstruida desde sys.* con
 * scripts/db/extraer-esquema.mjs. SQL Server no guarda el texto del
 * CREATE TABLE original, asi que esto es equivalente, no literal.
 */
IF OBJECT_ID(N'dbo.users', 'U') IS NULL
BEGIN
CREATE TABLE dbo.users (
    id INT IDENTITY(1, 1) NOT NULL,
    usuario NVARCHAR(50) COLLATE Modern_Spanish_CI_AS NOT NULL,
    password_hash NVARCHAR(255) COLLATE Modern_Spanish_CI_AS NOT NULL,
    rol NVARCHAR(20) COLLATE Modern_Spanish_CI_AS NOT NULL,
    active BIT NULL DEFAULT ((1)),
    creation_date DATETIME NULL DEFAULT (getdate()),
    PRIMARY KEY CLUSTERED (id),
    UNIQUE NONCLUSTERED (usuario)
);
END;
