/* salud_profesionales
 * Definicion canonica del esquema. Reconstruida desde sys.* con
 * scripts/db/extraer-esquema.mjs. SQL Server no guarda el texto del
 * CREATE TABLE original, asi que esto es equivalente, no literal.
 */
IF OBJECT_ID(N'dbo.salud_profesionales', 'U') IS NULL
BEGIN
CREATE TABLE dbo.salud_profesionales (
    user_id INT NOT NULL,
    nombre NVARCHAR(160) COLLATE Modern_Spanish_CI_AS NOT NULL,
    cedula NVARCHAR(20) COLLATE Modern_Spanish_CI_AS NOT NULL,
    institucion NVARCHAR(160) COLLATE Modern_Spanish_CI_AS NULL,
    especialidad NVARCHAR(120) COLLATE Modern_Spanish_CI_AS NULL,
    cedula_especialidad NVARCHAR(20) COLLATE Modern_Spanish_CI_AS NULL,
    updated_at DATETIME2(0) NOT NULL CONSTRAINT DF_salud_prof_updated DEFAULT (sysdatetime()),
    CONSTRAINT PK_salud_profesionales PRIMARY KEY CLUSTERED (user_id)
);
END;

IF OBJECT_ID(N'dbo.CK_salud_profesionales_cedula', 'C') IS NULL
ALTER TABLE dbo.salud_profesionales WITH CHECK ADD CONSTRAINT CK_salud_profesionales_cedula CHECK (len([cedula])>=(5) AND len([cedula])<=(20) AND NOT [cedula] like N'%[^0-9A-Za-z-]%');

IF OBJECT_ID(N'dbo.CK_salud_profesionales_esp', 'C') IS NULL
ALTER TABLE dbo.salud_profesionales WITH CHECK ADD CONSTRAINT CK_salud_profesionales_esp CHECK ([cedula_especialidad] IS NULL OR [especialidad] IS NOT NULL);

IF OBJECT_ID(N'dbo.FK_salud_profesionales_user', 'F') IS NULL
ALTER TABLE dbo.salud_profesionales WITH CHECK ADD CONSTRAINT FK_salud_profesionales_user FOREIGN KEY (user_id) REFERENCES dbo.users (id);
