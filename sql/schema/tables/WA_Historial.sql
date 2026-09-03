/* WA_Historial
 * Definicion canonica del esquema. Reconstruida desde sys.* con
 * scripts/db/extraer-esquema.mjs. SQL Server no guarda el texto del
 * CREATE TABLE original, asi que esto es equivalente, no literal.
 */
IF OBJECT_ID(N'dbo.WA_Historial', 'U') IS NULL
BEGIN
CREATE TABLE dbo.WA_Historial (
    Id INT IDENTITY(1, 1) NOT NULL,
    Telefono VARCHAR(20) COLLATE Modern_Spanish_CI_AS NOT NULL,
    MensajeEnviado NVARCHAR(MAX) COLLATE Modern_Spanish_CI_AS NOT NULL,
    Estado VARCHAR(20) COLLATE Modern_Spanish_CI_AS NOT NULL,
    ErrorLog NVARCHAR(MAX) COLLATE Modern_Spanish_CI_AS NULL,
    VentaId INT NULL,
    PlantillaId INT NULL,
    SentAt DATETIME NOT NULL DEFAULT (getdate()),
    PRIMARY KEY CLUSTERED (Id)
);
END;

ALTER TABLE dbo.WA_Historial WITH CHECK ADD FOREIGN KEY (PlantillaId) REFERENCES dbo.WA_Plantillas (Id);
