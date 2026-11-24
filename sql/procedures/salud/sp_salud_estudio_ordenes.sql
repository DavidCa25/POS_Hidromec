/* sp_salud_estudio_ordenes
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* Las órdenes de estudios: la lista de trabajo (por estado) o las de un
 * paciente. Con @id devuelve UNA orden con sus estudios completos y lo anota
 * en la bitácora (abrir resultados es abrir el expediente).
 *
 * Conjuntos: 1) órdenes  2) estudios de esas órdenes.
 */
CREATE OR ALTER PROCEDURE [dbo].[sp_salud_estudio_ordenes]
    @id          INT           = NULL,
    @customer_id INT           = NULL,
    @estado      NVARCHAR(12)  = NULL,
    @buscar      NVARCHAR(100) = NULL,
    @top         INT           = 100,
    @user_id     INT           = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET @buscar = NULLIF(LTRIM(RTRIM(@buscar)), N'');
    SET @estado = NULLIF(UPPER(LTRIM(RTRIM(@estado))), N'');
    IF @top IS NULL OR @top NOT BETWEEN 1 AND 500 SET @top = 100;

    DECLARE @o TABLE (id INT PRIMARY KEY);
    INSERT INTO @o (id)
    SELECT TOP (@top) o.id
      FROM dbo.salud_estudio_ordenes o
      JOIN dbo.customers c ON c.id = o.paciente_id
     WHERE (@id IS NULL OR o.id = @id)
       AND (@customer_id IS NULL OR o.paciente_id = @customer_id)
       AND (@estado IS NULL OR o.estado = @estado)
       AND (@buscar IS NULL OR c.customerName LIKE N'%' + @buscar + N'%'
            OR o.folio LIKE N'%' + @buscar + N'%')
     ORDER BY o.created_at DESC, o.id DESC;

    IF @id IS NOT NULL AND EXISTS (SELECT 1 FROM @o)
        INSERT INTO dbo.salud_bitacora (user_id, paciente_id, accion)
        SELECT @user_id, paciente_id, N'VER' FROM dbo.salud_estudio_ordenes WHERE id = @id;

    SELECT o.id, o.folio, o.paciente_id, c.customerName AS paciente, c.birthdate AS fecha_nacimiento, p.sexo,
           o.medico, o.indicaciones, o.estado, o.orden_id, so.folio AS orden_folio, so.status AS orden_status,
           o.created_at, uc.usuario AS creado_por, o.entregado_at, ue.usuario AS entregado_por,
           (SELECT COUNT(*) FROM dbo.salud_estudio_items i WHERE i.orden_id = o.id AND i.estado <> N'CANCELADO') AS estudios,
           (SELECT COUNT(*) FROM dbo.salud_estudio_items i WHERE i.orden_id = o.id AND i.estado = N'VALIDADO') AS validados,
           (SELECT SUM(i.precio) FROM dbo.salud_estudio_items i WHERE i.orden_id = o.id AND i.estado <> N'CANCELADO') AS total
      FROM dbo.salud_estudio_ordenes o
      JOIN @o x ON x.id = o.id
      JOIN dbo.customers c ON c.id = o.paciente_id
      LEFT JOIN dbo.salud_pacientes p ON p.customer_id = o.paciente_id
      LEFT JOIN dbo.service_orders so ON so.id = o.orden_id
      LEFT JOIN dbo.users uc ON uc.id = o.created_by
      LEFT JOIN dbo.users ue ON ue.id = o.entregado_por
     ORDER BY o.created_at DESC, o.id DESC;

    SELECT i.id, i.orden_id, i.product_id, i.nombre, i.tipo, i.modalidad, i.precio, i.estado,
           i.tomado_at, i.capturado_at, uc.usuario AS capturado_por, i.validado_at, uv.usuario AS validado_por,
           CASE WHEN @id IS NOT NULL THEN i.parametros END AS parametros,
           CASE WHEN @id IS NOT NULL THEN i.resultados END AS resultados,
           CASE WHEN @id IS NOT NULL THEN i.hallazgos END AS hallazgos,
           CASE WHEN @id IS NOT NULL THEN i.conclusion END AS conclusion,
           i.birads,
           CASE WHEN @id IS NOT NULL THEN i.firmante END AS firmante,
           CONVERT(VARCHAR(66), i.huella, 1) AS huella
      FROM dbo.salud_estudio_items i
      JOIN @o x ON x.id = i.orden_id
      LEFT JOIN dbo.users uc ON uc.id = i.capturado_por
      LEFT JOIN dbo.users uv ON uv.id = i.validado_por
     ORDER BY i.orden_id, i.id;
END
GO
