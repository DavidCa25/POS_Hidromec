/* CAT_impuestos
 * Definicion canonica del esquema. Reconstruida desde sys.* con
 * scripts/db/extraer-esquema.mjs. SQL Server no guarda el texto del
 * CREATE TABLE original, asi que esto es equivalente, no literal.
 */
IF OBJECT_ID(N'dbo.CAT_impuestos', 'U') IS NULL
BEGIN
CREATE TABLE dbo.CAT_impuestos (
    id INT IDENTITY(1, 1) NOT NULL,
    clave VARCHAR(40) COLLATE Modern_Spanish_CI_AS NOT NULL,
    nombre NVARCHAR(80) COLLATE Modern_Spanish_CI_AS NOT NULL,
    clase VARCHAR(10) COLLATE Modern_Spanish_CI_AS NOT NULL,
    factor VARCHAR(6) COLLATE Modern_Spanish_CI_AS NOT NULL,
    tasa DECIMAL(9, 6) NULL,
    cuota DECIMAL(12, 4) NULL,
    unidad NVARCHAR(20) COLLATE Modern_Spanish_CI_AS NULL,
    en_base_iva BIT NOT NULL CONSTRAINT DF_CAT_impuestos_base_iva DEFAULT ((1)),
    nota NVARCHAR(200) COLLATE Modern_Spanish_CI_AS NULL,
    activo BIT NOT NULL CONSTRAINT DF_CAT_impuestos_activo DEFAULT ((1)),
    sistema BIT NOT NULL CONSTRAINT DF_CAT_impuestos_sistema DEFAULT ((0)),
    actualizado_en DATETIME2(0) NOT NULL CONSTRAINT DF_CAT_impuestos_actualizado DEFAULT (sysdatetime()),
    CONSTRAINT PK_CAT_impuestos PRIMARY KEY CLUSTERED (id),
    CONSTRAINT UX_CAT_impuestos_clave UNIQUE NONCLUSTERED (clave)
);
END;

IF OBJECT_ID(N'dbo.CK_CAT_impuestos_activo', 'C') IS NULL
ALTER TABLE dbo.CAT_impuestos WITH CHECK ADD CONSTRAINT CK_CAT_impuestos_activo CHECK ([activo]=(0) OR [tasa] IS NOT NULL OR [cuota] IS NOT NULL);

IF OBJECT_ID(N'dbo.CK_CAT_impuestos_clase', 'C') IS NULL
ALTER TABLE dbo.CAT_impuestos WITH CHECK ADD CONSTRAINT CK_CAT_impuestos_clase CHECK ([clase]='LOCAL' OR [clase]='IEPS');

IF OBJECT_ID(N'dbo.CK_CAT_impuestos_factor', 'C') IS NULL
ALTER TABLE dbo.CAT_impuestos WITH CHECK ADD CONSTRAINT CK_CAT_impuestos_factor CHECK ([factor]='Cuota' OR [factor]='Tasa');

IF OBJECT_ID(N'dbo.CK_CAT_impuestos_valor', 'C') IS NULL
ALTER TABLE dbo.CAT_impuestos WITH CHECK ADD CONSTRAINT CK_CAT_impuestos_valor CHECK ([factor]='Tasa' AND [cuota] IS NULL AND ([tasa] IS NULL OR [tasa]>(0) AND [tasa]<=(5)) OR [factor]='Cuota' AND [tasa] IS NULL AND ([cuota] IS NULL OR [cuota]>(0)));
