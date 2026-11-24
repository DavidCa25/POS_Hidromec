/* sp_salud_documento_guardar
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* Crea o actualiza un BORRADOR del expediente (historia, nota SOAP, receta,
 * consentimiento, solicitud, referencia) con sus diagnósticos.
 *
 * Solo su autor edita un borrador. Uno firmado no pasa de aquí, y si
 * alguien lo intentara por fuera, el trigger de la tabla lo rechaza.
 *
 * @diagnosticos: JSON [{ "cie10": "J02.9", "descripcion": "...", "principal": true }]
 */
CREATE OR ALTER PROCEDURE [dbo].[sp_salud_documento_guardar]
    @id           INT           = NULL,
    @paciente_id  INT,
    @tipo         NVARCHAR(20),
    @titulo       NVARCHAR(160) = NULL,
    @contenido    NVARCHAR(MAX),
    @diagnosticos NVARCHAR(MAX) = NULL,
    @cita_id      INT           = NULL,
    @orden_id     INT           = NULL,
    @user_id      INT
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    SET @tipo = UPPER(LTRIM(RTRIM(ISNULL(@tipo, N''))));
    IF @user_id IS NULL BEGIN RAISERROR('Falta quién escribe el documento.', 16, 1); RETURN; END
    IF @tipo NOT IN (N'HISTORIA', N'NOTA', N'RECETA', N'CONSENTIMIENTO', N'SOLICITUD', N'REFERENCIA')
    BEGIN RAISERROR('Tipo de documento inválido.', 16, 1); RETURN; END
    IF @contenido IS NULL OR ISJSON(@contenido) <> 1
    BEGIN RAISERROR('El contenido del documento es inválido.', 16, 1); RETURN; END
    IF @diagnosticos IS NOT NULL AND ISJSON(@diagnosticos) <> 1
    BEGIN RAISERROR('Diagnósticos inválidos.', 16, 1); RETURN; END

    DECLARE @consent DATETIME2(0);
    SELECT @consent = consentimiento_at FROM dbo.salud_pacientes WHERE customer_id = @paciente_id;
    IF NOT EXISTS (SELECT 1 FROM dbo.salud_pacientes WHERE customer_id = @paciente_id)
    BEGIN RAISERROR('SIN_FICHA: primero da de alta la ficha del paciente.', 16, 1); RETURN; END
    IF @consent IS NULL
    BEGIN RAISERROR('SIN_CONSENTIMIENTO: el paciente no ha dado su consentimiento para el tratamiento de sus datos.', 16, 1); RETURN; END

    BEGIN TRAN;

    IF @id IS NULL
    BEGIN
        INSERT INTO dbo.salud_documentos (paciente_id, tipo, titulo, contenido, autor_id, cita_id, orden_id)
        VALUES (@paciente_id, @tipo, NULLIF(LTRIM(RTRIM(@titulo)), N''), @contenido, @user_id, @cita_id, @orden_id);
        SET @id = SCOPE_IDENTITY();
    END
    ELSE
    BEGIN
        DECLARE @estado NVARCHAR(10), @autor INT, @pac INT;
        SELECT @estado = estado, @autor = autor_id, @pac = paciente_id
          FROM dbo.salud_documentos WITH (UPDLOCK) WHERE id = @id;
        IF @estado IS NULL OR @pac <> @paciente_id
        BEGIN ROLLBACK; RAISERROR('El documento no existe.', 16, 1); RETURN; END
        IF @estado = N'FIRMADO'
        BEGIN ROLLBACK; RAISERROR('DOCUMENTO_FIRMADO: un documento firmado no se modifica; agrega una adenda.', 16, 1); RETURN; END
        IF @autor <> @user_id
        BEGIN ROLLBACK; RAISERROR('Solo quien escribió el borrador puede cambiarlo.', 16, 1); RETURN; END

        UPDATE dbo.salud_documentos
           SET tipo = @tipo, titulo = NULLIF(LTRIM(RTRIM(@titulo)), N''), contenido = @contenido,
               cita_id = @cita_id, orden_id = @orden_id, updated_at = SYSDATETIME()
         WHERE id = @id;
        DELETE FROM dbo.salud_diagnosticos WHERE documento_id = @id;
    END

    IF @diagnosticos IS NOT NULL
        INSERT INTO dbo.salud_diagnosticos (documento_id, cie10, descripcion, principal)
        SELECT @id,
               NULLIF(UPPER(LTRIM(RTRIM(j.cie10))), N''),
               LEFT(LTRIM(RTRIM(j.descripcion)), 250),
               ISNULL(j.principal, 0)
          FROM OPENJSON(@diagnosticos)
               WITH (cie10 NVARCHAR(10) '$.cie10', descripcion NVARCHAR(400) '$.descripcion', principal BIT '$.principal') j
         WHERE NULLIF(LTRIM(RTRIM(j.descripcion)), N'') IS NOT NULL;

    INSERT INTO dbo.salud_bitacora (user_id, paciente_id, documento_id, accion)
    VALUES (@user_id, @paciente_id, @id, N'EDITAR');

    COMMIT;
    SELECT @id AS id;
END
GO
