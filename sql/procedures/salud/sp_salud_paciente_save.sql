/* sp_salud_paciente_save
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* Da de alta o actualiza la ficha clínica de un paciente.
 *
 * Sin @customer_id crea primero el CLIENTE por sp_create_customer, la misma
 * puerta que usa el resto de Wybix: el paciente es un cliente con ficha.
 *
 * EL CONSENTIMIENTO se guarda una vez, con fecha y quién lo recabó. Sin él
 * no se escribe nada clínico (LFPDPPP 2025: datos sensibles).
 *
 * @version: el testigo que la pantalla leyó. Si otro lo cambió mientras
 * tanto, no se pisa: CONFLICTO_DE_VERSION.
 */
CREATE OR ALTER PROCEDURE [dbo].[sp_salud_paciente_save]
    @customer_id         INT            = NULL,
    @nombre              NVARCHAR(120),
    @telefono            NVARCHAR(30)   = NULL,
    @email               NVARCHAR(120)  = NULL,
    @fecha_nacimiento    DATE           = NULL,
    @curp                NVARCHAR(18)   = NULL,
    @sexo                CHAR(1)        = NULL,
    @tutor               NVARCHAR(120)  = NULL,
    @contacto_emergencia NVARCHAR(160)  = NULL,
    @grupo_sanguineo     NVARCHAR(5)    = NULL,
    @alergias            NVARCHAR(600)  = NULL,
    @antecedentes        NVARCHAR(MAX)  = NULL,
    @consentimiento      BIT            = 0,
    @version             BINARY(8)      = NULL,
    @user_id             INT            = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    SET @nombre = NULLIF(LTRIM(RTRIM(@nombre)), N'');
    SET @curp = NULLIF(UPPER(LTRIM(RTRIM(@curp))), N'');
    SET @sexo = NULLIF(UPPER(LTRIM(RTRIM(@sexo))), '');
    SET @alergias = NULLIF(LTRIM(RTRIM(@alergias)), N'');
    IF @nombre IS NULL BEGIN RAISERROR('Escribe el nombre del paciente.', 16, 1); RETURN; END
    IF @curp IS NOT NULL AND (LEN(@curp) <> 18 OR @curp LIKE N'%[^A-Z0-9]%')
    BEGIN RAISERROR('La CURP tiene 18 letras y números.', 16, 1); RETURN; END
    IF @sexo IS NOT NULL AND @sexo NOT IN ('F', 'M', 'X')
    BEGIN RAISERROR('Sexo inválido.', 16, 1); RETURN; END
    IF @antecedentes IS NOT NULL AND ISJSON(@antecedentes) <> 1
    BEGIN RAISERROR('Antecedentes inválidos.', 16, 1); RETURN; END
    IF @fecha_nacimiento IS NOT NULL AND @fecha_nacimiento > CAST(GETDATE() AS DATE)
    BEGIN RAISERROR('La fecha de nacimiento no puede ser futura.', 16, 1); RETURN; END
    IF @curp IS NOT NULL AND EXISTS (SELECT 1 FROM dbo.salud_pacientes WHERE curp = @curp AND customer_id <> ISNULL(@customer_id, -1))
    BEGIN RAISERROR('Ya hay otro paciente con esa CURP.', 16, 1); RETURN; END

    BEGIN TRAN;

    DECLARE @nuevo BIT = 0;
    IF @customer_id IS NULL
    BEGIN
        EXEC dbo.sp_create_customer @customerName = @nombre, @phone = @telefono, @mobile = @telefono,
             @email = @email, @birthdate = @fecha_nacimiento, @NewId = @customer_id OUTPUT;
        SET @nuevo = 1;
    END
    ELSE
    BEGIN
        IF NOT EXISTS (SELECT 1 FROM dbo.customers WITH (UPDLOCK) WHERE id = @customer_id)
        BEGIN ROLLBACK; RAISERROR('El cliente no existe.', 16, 1); RETURN; END
        UPDATE dbo.customers
           SET customerName = @nombre,
               phone = COALESCE(@telefono, phone), mobile = COALESCE(@telefono, mobile),
               email = COALESCE(@email, email), birthdate = COALESCE(@fecha_nacimiento, birthdate),
               updated_at = SYSDATETIME()
         WHERE id = @customer_id;
    END

    IF EXISTS (SELECT 1 FROM dbo.salud_pacientes WITH (UPDLOCK) WHERE customer_id = @customer_id)
    BEGIN
        IF @version IS NOT NULL AND NOT EXISTS (
            SELECT 1 FROM dbo.salud_pacientes WHERE customer_id = @customer_id AND version = @version)
        BEGIN ROLLBACK; RAISERROR('CONFLICTO_DE_VERSION', 16, 1); RETURN; END

        UPDATE dbo.salud_pacientes
           SET curp = @curp, sexo = @sexo, tutor = NULLIF(LTRIM(RTRIM(@tutor)), N''),
               contacto_emergencia = NULLIF(LTRIM(RTRIM(@contacto_emergencia)), N''),
               grupo_sanguineo = NULLIF(LTRIM(RTRIM(@grupo_sanguineo)), N''),
               alergias = @alergias, antecedentes = @antecedentes,
               consentimiento_at = CASE WHEN consentimiento_at IS NULL AND @consentimiento = 1 THEN SYSDATETIME() ELSE consentimiento_at END,
               consentimiento_por = CASE WHEN consentimiento_at IS NULL AND @consentimiento = 1 THEN @user_id ELSE consentimiento_por END,
               updated_at = SYSDATETIME()
         WHERE customer_id = @customer_id;
    END
    ELSE
        INSERT INTO dbo.salud_pacientes
            (customer_id, curp, sexo, tutor, contacto_emergencia, grupo_sanguineo, alergias, antecedentes,
             consentimiento_at, consentimiento_por)
        VALUES (@customer_id, @curp, @sexo, NULLIF(LTRIM(RTRIM(@tutor)), N''),
                NULLIF(LTRIM(RTRIM(@contacto_emergencia)), N''), NULLIF(LTRIM(RTRIM(@grupo_sanguineo)), N''),
                @alergias, @antecedentes,
                CASE WHEN @consentimiento = 1 THEN SYSDATETIME() END,
                CASE WHEN @consentimiento = 1 THEN @user_id END);

    INSERT INTO dbo.salud_bitacora (user_id, paciente_id, accion)
    VALUES (@user_id, @customer_id, CASE WHEN @nuevo = 1 THEN N'ALTA' ELSE N'FICHA' END);

    COMMIT;

    SELECT @customer_id AS customer_id;
END
GO
