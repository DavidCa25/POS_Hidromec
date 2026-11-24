/* sp_salud_pacientes_buscar
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* Busca entre los clientes por nombre, teléfono o CURP. Devuelve si ya es
 * paciente (tiene ficha clínica) y su última atención, para que la
 * recepción encuentre a la persona sin abrir su expediente.
 *
 * No devuelve nada clínico salvo las alergias: son lo único que quien
 * recibe al paciente necesita ver antes que nada.
 */
CREATE OR ALTER PROCEDURE [dbo].[sp_salud_pacientes_buscar]
    @buscar NVARCHAR(100) = NULL,
    @top    INT = 50
AS
BEGIN
    SET NOCOUNT ON;
    SET @buscar = NULLIF(LTRIM(RTRIM(@buscar)), N'');
    IF @top IS NULL OR @top NOT BETWEEN 1 AND 500 SET @top = 50;
    DECLARE @patron NVARCHAR(110) = N'%' + @buscar + N'%';

    SELECT TOP (@top)
           c.id AS customer_id, c.customerName AS nombre, COALESCE(c.mobile, c.phone) AS telefono,
           c.birthdate AS fecha_nacimiento, c.email,
           p.curp, p.sexo, p.alergias,
           CAST(CASE WHEN p.customer_id IS NULL THEN 0 ELSE 1 END AS BIT) AS es_paciente,
           CAST(CASE WHEN p.consentimiento_at IS NULL THEN 0 ELSE 1 END AS BIT) AS con_consentimiento,
           (SELECT MAX(d.created_at) FROM dbo.salud_documentos d WHERE d.paciente_id = c.id) AS ultima_atencion
      FROM dbo.customers c
      LEFT JOIN dbo.salud_pacientes p ON p.customer_id = c.id
     WHERE c.active = 1
       AND (@buscar IS NULL
            OR c.customerName LIKE @patron
            OR c.phone LIKE @patron OR c.mobile LIKE @patron
            OR p.curp = UPPER(@buscar))
     ORDER BY CASE WHEN p.customer_id IS NULL THEN 1 ELSE 0 END,
              (SELECT MAX(d.created_at) FROM dbo.salud_documentos d WHERE d.paciente_id = c.id) DESC,
              c.customerName;
END
GO
