/* sp_salud_expediente_get
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* El expediente de un paciente. Cada apertura queda en la bitácora: leer un
 * expediente es un acceso a datos sensibles, no una consulta cualquiera.
 *
 * Cuatro conjuntos, en este orden:
 *   1. ficha     cliente + datos clínicos + testigo de versión
 *   2. documentos los 200 más recientes (sin el contenido de los que no se
 *                 piden: la lista no necesita el JSON completo)
 *   3. diagnósticos de esos documentos
 *   4. adendas de esos documentos
 */
CREATE OR ALTER PROCEDURE [dbo].[sp_salud_expediente_get]
    @customer_id INT,
    @user_id     INT = NULL
AS
BEGIN
    SET NOCOUNT ON;
    IF NOT EXISTS (SELECT 1 FROM dbo.customers WHERE id = @customer_id)
    BEGIN RAISERROR('El paciente no existe.', 16, 1); RETURN; END

    INSERT INTO dbo.salud_bitacora (user_id, paciente_id, accion) VALUES (@user_id, @customer_id, N'VER');

    SELECT c.id AS customer_id, c.customerName AS nombre, COALESCE(c.mobile, c.phone) AS telefono,
           c.email, c.birthdate AS fecha_nacimiento,
           p.curp, p.sexo, p.tutor, p.contacto_emergencia, p.grupo_sanguineo, p.alergias, p.antecedentes,
           p.consentimiento_at, p.consentimiento_por,
           CAST(CASE WHEN p.customer_id IS NULL THEN 0 ELSE 1 END AS BIT) AS es_paciente,
           CONVERT(VARCHAR(18), p.version, 1) AS version
      FROM dbo.customers c
      LEFT JOIN dbo.salud_pacientes p ON p.customer_id = c.id
     WHERE c.id = @customer_id;

    DECLARE @docs TABLE (id INT PRIMARY KEY);
    INSERT INTO @docs (id)
    SELECT TOP (200) id FROM dbo.salud_documentos WHERE paciente_id = @customer_id ORDER BY created_at DESC, id DESC;

    SELECT d.id, d.tipo, d.titulo, d.contenido, d.estado, d.autor_id, ua.usuario AS autor,
           d.cita_id, d.orden_id, d.created_at, d.updated_at, d.firmado_at, uf.usuario AS firmado_por,
           CONVERT(VARCHAR(66), d.huella, 1) AS huella, d.firmante
      FROM dbo.salud_documentos d
      JOIN @docs x ON x.id = d.id
      LEFT JOIN dbo.users ua ON ua.id = d.autor_id
      LEFT JOIN dbo.users uf ON uf.id = d.firmado_por
     ORDER BY d.created_at DESC, d.id DESC;

    SELECT g.id, g.documento_id, g.cie10, g.descripcion, g.principal
      FROM dbo.salud_diagnosticos g JOIN @docs x ON x.id = g.documento_id
     ORDER BY g.documento_id, g.principal DESC, g.id;

    SELECT a.id, a.documento_id, a.texto, a.at, u.usuario AS autor
      FROM dbo.salud_adendas a JOIN @docs x ON x.id = a.documento_id
      LEFT JOIN dbo.users u ON u.id = a.autor_id
     ORDER BY a.documento_id, a.at;
END
GO
