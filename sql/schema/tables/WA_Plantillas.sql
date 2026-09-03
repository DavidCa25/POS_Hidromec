/* WA_Plantillas
 * Definicion canonica del esquema. Reconstruida desde sys.* con
 * scripts/db/extraer-esquema.mjs. SQL Server no guarda el texto del
 * CREATE TABLE original, asi que esto es equivalente, no literal.
 */
IF OBJECT_ID(N'dbo.WA_Plantillas', 'U') IS NULL
BEGIN
CREATE TABLE dbo.WA_Plantillas (
    Id INT IDENTITY(1, 1) NOT NULL,
    Nombre NVARCHAR(100) COLLATE Modern_Spanish_CI_AS NOT NULL,
    EventoTrigger VARCHAR(50) COLLATE Modern_Spanish_CI_AS NOT NULL,
    Mensaje NVARCHAR(MAX) COLLATE Modern_Spanish_CI_AS NOT NULL,
    EsPorDefecto BIT NOT NULL DEFAULT ((0)),
    Activo BIT NOT NULL DEFAULT ((1)),
    CreatedAt DATETIME NOT NULL DEFAULT (getdate()),
    PRIMARY KEY CLUSTERED (Id)
);
END;
