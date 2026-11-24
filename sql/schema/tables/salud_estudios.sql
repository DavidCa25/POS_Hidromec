/* salud_estudios
 * Definicion canonica del esquema. Reconstruida desde sys.* con
 * scripts/db/extraer-esquema.mjs. SQL Server no guarda el texto del
 * CREATE TABLE original, asi que esto es equivalente, no literal.
 */
IF OBJECT_ID(N'dbo.salud_estudios', 'U') IS NULL
BEGIN
CREATE TABLE dbo.salud_estudios (
    product_id INT NOT NULL,
    tipo NVARCHAR(10) COLLATE Modern_Spanish_CI_AS NOT NULL,
    modalidad NVARCHAR(20) COLLATE Modern_Spanish_CI_AS NULL,
    preparacion NVARCHAR(400) COLLATE Modern_Spanish_CI_AS NULL,
    muestra NVARCHAR(60) COLLATE Modern_Spanish_CI_AS NULL,
    entrega_horas INT NULL,
    parametros NVARCHAR(MAX) COLLATE Modern_Spanish_CI_AS NULL,
    updated_at DATETIME2(0) NOT NULL CONSTRAINT DF_salud_estudios_upd DEFAULT (sysdatetime()),
    CONSTRAINT PK_salud_estudios PRIMARY KEY CLUSTERED (product_id)
);
END;

IF OBJECT_ID(N'dbo.CK_salud_estudios_horas', 'C') IS NULL
ALTER TABLE dbo.salud_estudios WITH CHECK ADD CONSTRAINT CK_salud_estudios_horas CHECK ([entrega_horas] IS NULL OR [entrega_horas]>=(0) AND [entrega_horas]<=(2160));

IF OBJECT_ID(N'dbo.CK_salud_estudios_modalidad', 'C') IS NULL
ALTER TABLE dbo.salud_estudios WITH CHECK ADD CONSTRAINT CK_salud_estudios_modalidad CHECK ([tipo]=N'LAB' AND [modalidad] IS NULL OR [tipo]=N'IMAGEN' AND ([modalidad]=N'OTRO' OR [modalidad]=N'DENSITOMETRIA' OR [modalidad]=N'RM' OR [modalidad]=N'TAC' OR [modalidad]=N'USG' OR [modalidad]=N'MASTOGRAFIA' OR [modalidad]=N'RX'));

IF OBJECT_ID(N'dbo.CK_salud_estudios_param', 'C') IS NULL
ALTER TABLE dbo.salud_estudios WITH CHECK ADD CONSTRAINT CK_salud_estudios_param CHECK ([parametros] IS NULL OR isjson([parametros])=(1));

IF OBJECT_ID(N'dbo.CK_salud_estudios_tipo', 'C') IS NULL
ALTER TABLE dbo.salud_estudios WITH CHECK ADD CONSTRAINT CK_salud_estudios_tipo CHECK ([tipo]=N'IMAGEN' OR [tipo]=N'LAB');

IF OBJECT_ID(N'dbo.FK_salud_estudios_producto', 'F') IS NULL
ALTER TABLE dbo.salud_estudios WITH CHECK ADD CONSTRAINT FK_salud_estudios_producto FOREIGN KEY (product_id) REFERENCES dbo.products (id);
