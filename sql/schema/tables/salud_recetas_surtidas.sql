/* salud_recetas_surtidas
 * Definicion canonica del esquema. Reconstruida desde sys.* con
 * scripts/db/extraer-esquema.mjs. SQL Server no guarda el texto del
 * CREATE TABLE original, asi que esto es equivalente, no literal.
 */
IF OBJECT_ID(N'dbo.salud_recetas_surtidas', 'U') IS NULL
BEGIN
CREATE TABLE dbo.salud_recetas_surtidas (
    id INT IDENTITY(1, 1) NOT NULL,
    sale_id INT NOT NULL,
    medico NVARCHAR(120) COLLATE Modern_Spanish_CI_AS NOT NULL,
    cedula NVARCHAR(20) COLLATE Modern_Spanish_CI_AS NOT NULL,
    fecha_receta DATE NOT NULL,
    institucion NVARCHAR(160) COLLATE Modern_Spanish_CI_AS NULL,
    paciente NVARCHAR(120) COLLATE Modern_Spanish_CI_AS NULL,
    retenida BIT NOT NULL CONSTRAINT DF_salud_rs_ret DEFAULT ((0)),
    surtidos_restantes TINYINT NULL,
    user_id INT NULL,
    at DATETIME2(0) NOT NULL CONSTRAINT DF_salud_rs_at DEFAULT (sysdatetime()),
    CONSTRAINT PK_salud_recetas_surtidas PRIMARY KEY CLUSTERED (id),
    CONSTRAINT UQ_salud_recetas_surtidas_venta UNIQUE NONCLUSTERED (sale_id)
);
END;

IF OBJECT_ID(N'dbo.FK_salud_recetas_surtidas_venta', 'F') IS NULL
ALTER TABLE dbo.salud_recetas_surtidas WITH CHECK ADD CONSTRAINT FK_salud_recetas_surtidas_venta FOREIGN KEY (sale_id) REFERENCES dbo.sales (id);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_salud_recetas_surtidas_at' AND object_id = OBJECT_ID(N'dbo.salud_recetas_surtidas'))
CREATE NONCLUSTERED INDEX IX_salud_recetas_surtidas_at ON dbo.salud_recetas_surtidas (at);
