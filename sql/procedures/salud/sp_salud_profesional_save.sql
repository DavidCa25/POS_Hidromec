/* sp_salud_profesional_save
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* Guarda los datos con los que firma un profesional. Cada quien captura los
 * suyos: la cédula es de la persona, no del negocio. Lo ya firmado no cambia
 * (cada documento guardó su copia al firmarse).
 */
CREATE OR ALTER PROCEDURE [dbo].[sp_salud_profesional_save]
    @user_id             INT,
    @nombre              NVARCHAR(160),
    @cedula              NVARCHAR(20),
    @institucion         NVARCHAR(160) = NULL,
    @especialidad        NVARCHAR(120) = NULL,
    @cedula_especialidad NVARCHAR(20)  = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET @nombre              = NULLIF(LTRIM(RTRIM(@nombre)), N'');
    SET @cedula              = NULLIF(REPLACE(LTRIM(RTRIM(@cedula)), N' ', N''), N'');
    SET @institucion         = NULLIF(LTRIM(RTRIM(@institucion)), N'');
    SET @especialidad        = NULLIF(LTRIM(RTRIM(@especialidad)), N'');
    SET @cedula_especialidad = NULLIF(REPLACE(LTRIM(RTRIM(@cedula_especialidad)), N' ', N''), N'');

    IF @nombre IS NULL BEGIN RAISERROR('Escribe tu nombre completo como aparece en tu título.', 16, 1); RETURN; END
    IF @cedula IS NULL OR LEN(@cedula) NOT BETWEEN 5 AND 20 OR @cedula LIKE N'%[^0-9A-Za-z-]%'
    BEGIN RAISERROR('CEDULA_INVALIDA: la cédula profesional tiene de 5 a 20 letras o números.', 16, 1); RETURN; END
    IF @cedula_especialidad IS NOT NULL AND @especialidad IS NULL
    BEGIN RAISERROR('Escribe la especialidad de esa cédula.', 16, 1); RETURN; END
    IF @cedula_especialidad IS NOT NULL AND (LEN(@cedula_especialidad) < 5 OR @cedula_especialidad LIKE N'%[^0-9A-Za-z-]%')
    BEGIN RAISERROR('CEDULA_INVALIDA: la cédula de especialidad tiene de 5 a 20 letras o números.', 16, 1); RETURN; END

    MERGE dbo.salud_profesionales WITH (HOLDLOCK) AS t
    USING (SELECT @user_id AS user_id) AS s ON t.user_id = s.user_id
    WHEN MATCHED THEN UPDATE SET nombre = @nombre, cedula = @cedula, institucion = @institucion,
         especialidad = @especialidad, cedula_especialidad = @cedula_especialidad, updated_at = SYSDATETIME()
    WHEN NOT MATCHED THEN INSERT (user_id, nombre, cedula, institucion, especialidad, cedula_especialidad)
         VALUES (@user_id, @nombre, @cedula, @institucion, @especialidad, @cedula_especialidad);

    EXEC dbo.sp_salud_profesional_get @user_id = @user_id;
END
GO
