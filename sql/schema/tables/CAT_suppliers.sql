/* CAT_suppliers
 * Definicion canonica del esquema. Reconstruida desde sys.* con
 * scripts/db/extraer-esquema.mjs. SQL Server no guarda el texto del
 * CREATE TABLE original, asi que esto es equivalente, no literal.
 */
IF OBJECT_ID(N'dbo.CAT_suppliers', 'U') IS NULL
BEGIN
CREATE TABLE dbo.CAT_suppliers (
    id INT IDENTITY(1, 1) NOT NULL,
    nombre NVARCHAR(100) COLLATE Modern_Spanish_CI_AS NOT NULL,
    contacto NVARCHAR(100) COLLATE Modern_Spanish_CI_AS NULL,
    telefono NVARCHAR(20) COLLATE Modern_Spanish_CI_AS NULL,
    correo NVARCHAR(100) COLLATE Modern_Spanish_CI_AS NULL,
    direccion NVARCHAR(255) COLLATE Modern_Spanish_CI_AS NULL,
    activo BIT NULL DEFAULT ((1)),
    fecha_creacion DATETIME NULL DEFAULT (getdate()),
    rfc NVARCHAR(20) COLLATE Modern_Spanish_CI_AS NULL,
    PRIMARY KEY CLUSTERED (id)
);
END;
