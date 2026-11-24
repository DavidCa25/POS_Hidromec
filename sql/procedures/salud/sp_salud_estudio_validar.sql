/* sp_salud_estudio_validar
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* Firma el resultado. Lo hace un profesional con cédula (el químico o el
 * radiólogo responsable): su copia queda en `firmante` y la huella SHA-256
 * del resultado permite demostrar después que no cambió. Desde aquí el
 * estudio no se toca (TR_salud_estudio_items_inmutable).
 *
 * Cuando todos los estudios vivos de la orden están validados, la orden
 * queda LISTA para entregarse.
 */
CREATE OR ALTER PROCEDURE [dbo].[sp_salud_estudio_validar]
    @item_id INT,
    @user_id INT
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    BEGIN TRAN;
    DECLARE @estado NVARCHAR(12), @orden INT, @pac INT, @res NVARCHAR(MAX), @hall NVARCHAR(MAX), @concl NVARCHAR(1000), @birads TINYINT;
    SELECT @estado = i.estado, @orden = i.orden_id, @pac = o.paciente_id,
           @res = i.resultados, @hall = i.hallazgos, @concl = i.conclusion, @birads = i.birads
      FROM dbo.salud_estudio_items i WITH (UPDLOCK)
      JOIN dbo.salud_estudio_ordenes o ON o.id = i.orden_id
     WHERE i.id = @item_id;
    IF @estado IS NULL BEGIN ROLLBACK; RAISERROR('El estudio no existe.', 16, 1); RETURN; END
    IF @estado = N'VALIDADO' BEGIN ROLLBACK; RAISERROR('ESTUDIO_VALIDADO: ya estaba validado.', 16, 1); RETURN; END
    IF @estado <> N'CAPTURADO' BEGIN ROLLBACK; RAISERROR('Primero captura el resultado.', 16, 1); RETURN; END

    DECLARE @firmante NVARCHAR(MAX) = (
        SELECT p.nombre, p.cedula, p.institucion, p.especialidad, p.cedula_especialidad,
               b.business_name AS establecimiento, b.address AS domicilio, b.phone AS telefono
          FROM dbo.salud_profesionales p
          OUTER APPLY (SELECT TOP 1 business_name, address, phone FROM dbo.business_config ORDER BY id) b
         WHERE p.user_id = @user_id
           FOR JSON PATH, WITHOUT_ARRAY_WRAPPER, INCLUDE_NULL_VALUES);
    IF @firmante IS NULL
    BEGIN
        ROLLBACK;
        RAISERROR('SIN_CEDULA: valida quien tiene cédula profesional. Captura la tuya en «Mis datos de firma».', 16, 1);
        RETURN;
    END

    DECLARE @at DATETIME2(0) = SYSDATETIME();
    DECLARE @huella VARBINARY(32) = HASHBYTES('SHA2_256', CONCAT(
        ISNULL(@res, N'[]'), N'|', ISNULL(@hall, N''), N'|', ISNULL(@concl, N''), N'|', ISNULL(CONVERT(NVARCHAR(3), @birads), N''),
        N'|', @user_id, N'|', @firmante, N'|', CONVERT(NVARCHAR(30), @at, 126)));

    UPDATE dbo.salud_estudio_items
       SET estado = N'VALIDADO', validado_at = @at, validado_por = @user_id, firmante = @firmante, huella = @huella
     WHERE id = @item_id;

    UPDATE dbo.salud_estudio_ordenes SET estado = N'LISTA'
     WHERE id = @orden AND estado = N'ABIERTA'
       AND NOT EXISTS (SELECT 1 FROM dbo.salud_estudio_items WHERE orden_id = @orden AND estado NOT IN (N'VALIDADO', N'CANCELADO'));

    INSERT INTO dbo.salud_bitacora (user_id, paciente_id, accion) VALUES (@user_id, @pac, N'VALIDAR');
    COMMIT;

    SELECT i.id, i.estado, i.validado_at, CONVERT(VARCHAR(66), i.huella, 1) AS huella, o.estado AS orden_estado
      FROM dbo.salud_estudio_items i JOIN dbo.salud_estudio_ordenes o ON o.id = i.orden_id
     WHERE i.id = @item_id;
END
GO
