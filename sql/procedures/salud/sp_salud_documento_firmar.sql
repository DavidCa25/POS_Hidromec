/* sp_salud_documento_firmar
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* Cierra un borrador. Desde aquí el documento no cambia: la huella SHA-256
 * de su contenido, de sus diagnósticos y de quién firma permite demostrarlo
 * después.
 *
 * Firma su autor, nadie más: firmar es responder por lo escrito.
 *
 * QUIÉN FIRMA queda COPIADO en el documento (`firmante`): nombre, cédula,
 * institución, especialidad y el establecimiento. Una receta sin cédula no
 * se firma (SIN_CEDULA); los demás documentos llevan la copia si existe.
 */
CREATE OR ALTER PROCEDURE [dbo].[sp_salud_documento_firmar]
    @id      INT,
    @user_id INT
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    BEGIN TRAN;
    DECLARE @estado NVARCHAR(10), @autor INT, @pac INT, @contenido NVARCHAR(MAX), @tipo NVARCHAR(20);
    SELECT @estado = estado, @autor = autor_id, @pac = paciente_id, @contenido = contenido, @tipo = tipo
      FROM dbo.salud_documentos WITH (UPDLOCK) WHERE id = @id;
    IF @estado IS NULL BEGIN ROLLBACK; RAISERROR('El documento no existe.', 16, 1); RETURN; END
    IF @estado = N'FIRMADO' BEGIN ROLLBACK; RAISERROR('DOCUMENTO_FIRMADO: ya estaba firmado.', 16, 1); RETURN; END
    IF @autor <> @user_id BEGIN ROLLBACK; RAISERROR('Solo quien escribió el documento puede firmarlo.', 16, 1); RETURN; END

    DECLARE @firmante NVARCHAR(MAX) = (
        SELECT p.nombre, p.cedula, p.institucion, p.especialidad, p.cedula_especialidad,
               b.business_name AS establecimiento, b.address AS domicilio, b.phone AS telefono
          FROM dbo.salud_profesionales p
          OUTER APPLY (SELECT TOP 1 business_name, address, phone FROM dbo.business_config ORDER BY id) b
         WHERE p.user_id = @user_id
           FOR JSON PATH, WITHOUT_ARRAY_WRAPPER, INCLUDE_NULL_VALUES);
    IF @tipo = N'RECETA' AND @firmante IS NULL
    BEGIN
        ROLLBACK;
        RAISERROR('SIN_CEDULA: una receta lleva el nombre y la cédula profesional de quien la firma. Captúralos en «Mis datos de firma».', 16, 1);
        RETURN;
    END

    DECLARE @dx NVARCHAR(MAX) = (
        SELECT cie10, descripcion, principal FROM dbo.salud_diagnosticos
         WHERE documento_id = @id ORDER BY id FOR JSON PATH);
    DECLARE @firmado DATETIME2(0) = SYSDATETIME();
    DECLARE @huella VARBINARY(32) = HASHBYTES('SHA2_256',
        CONCAT(@contenido, N'|', ISNULL(@dx, N'[]'), N'|', @user_id, N'|', ISNULL(@firmante, N'{}'), N'|',
               CONVERT(NVARCHAR(30), @firmado, 126)));

    UPDATE dbo.salud_documentos
       SET estado = N'FIRMADO', firmado_at = @firmado, firmado_por = @user_id, huella = @huella, firmante = @firmante
     WHERE id = @id;

    INSERT INTO dbo.salud_bitacora (user_id, paciente_id, documento_id, accion)
    VALUES (@user_id, @pac, @id, N'FIRMAR');
    COMMIT;

    SELECT @id AS id, @firmado AS firmado_at, CONVERT(VARCHAR(66), @huella, 1) AS huella;
END
GO
