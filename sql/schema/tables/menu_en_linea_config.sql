/* menu_en_linea_config
 * Definicion canonica del esquema. Reconstruida desde sys.* con
 * scripts/db/extraer-esquema.mjs. SQL Server no guarda el texto del
 * CREATE TABLE original, asi que esto es equivalente, no literal.
 */
IF OBJECT_ID(N'dbo.menu_en_linea_config', 'U') IS NULL
BEGIN
CREATE TABLE dbo.menu_en_linea_config (
    id INT NOT NULL CONSTRAINT DF_menu_en_linea_config_id DEFAULT ((1)),
    activo BIT NOT NULL CONSTRAINT DF_menu_en_linea_config_activo DEFAULT ((0)),
    recibe_pedidos BIT NOT NULL CONSTRAINT DF_menu_en_linea_config_recibe DEFAULT ((1)),
    slug NVARCHAR(40) COLLATE Modern_Spanish_CI_AS NULL,
    minutos_estimados INT NOT NULL CONSTRAINT DF_menu_en_linea_config_min DEFAULT ((15)),
    mensaje NVARCHAR(200) COLLATE Modern_Spanish_CI_AS NULL,
    actualizado_en DATETIME2(0) NOT NULL CONSTRAINT DF_menu_en_linea_config_act DEFAULT (sysdatetime()),
    actualizado_por INT NULL,
    color NVARCHAR(7) COLLATE Modern_Spanish_CI_AS NULL,
    acento NVARCHAR(7) COLLATE Modern_Spanish_CI_AS NULL,
    frase NVARCHAR(120) COLLATE Modern_Spanish_CI_AS NULL,
    direccion NVARCHAR(200) COLLATE Modern_Spanish_CI_AS NULL,
    horario NVARCHAR(120) COLLATE Modern_Spanish_CI_AS NULL,
    CONSTRAINT PK_menu_en_linea_config PRIMARY KEY CLUSTERED (id)
);
END;

IF OBJECT_ID(N'dbo.CK_menu_en_linea_config_min', 'C') IS NULL
ALTER TABLE dbo.menu_en_linea_config WITH CHECK ADD CONSTRAINT CK_menu_en_linea_config_min CHECK ([minutos_estimados]>=(1) AND [minutos_estimados]<=(240));

IF OBJECT_ID(N'dbo.CK_menu_en_linea_config_uno', 'C') IS NULL
ALTER TABLE dbo.menu_en_linea_config WITH CHECK ADD CONSTRAINT CK_menu_en_linea_config_uno CHECK ([id]=(1));
