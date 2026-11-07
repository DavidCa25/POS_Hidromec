/* sp_socios_llenar_duenos
 * Definicion canonica. Mantener este archivo y generar una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* ===================== sp_socios_llenar_duenos (0079) =====================
   De quien es cada producto, ya resuelto. Llena la tabla temporal #duenos
   que CREA QUIEN LLAMA:

       CREATE TABLE #duenos (product_id INT NOT NULL, socio_id INT NOT NULL,
                             pct DECIMAL(9, 6) NOT NULL,
                             PRIMARY KEY (product_id, socio_id));

   Una sola regla para todos (reparto de ventas, anticipos, el ejemplo del
   asistente):
     1. lo del PRODUCTO, si tiene;
     2. si no, lo de su CATEGORIA;
     3. si no, el socio "sin dueno" de la configuracion;
     4. si no hay, partes iguales entre los socios activos.
   pct es fraccion (0..1) y por producto suma 1.
   ======================================================================= */
CREATE OR ALTER PROCEDURE dbo.sp_socios_llenar_duenos
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @sin_dueno INT = (SELECT sin_dueno_socio_id FROM dbo.socios_config WHERE id = 1);
    DECLARE @activos INT = (SELECT COUNT(*) FROM dbo.socios WHERE activo = 1);
    IF @activos = 0 RETURN;

    INSERT INTO #duenos (product_id, socio_id, pct)
    SELECT d.entidad_id, d.socio_id, CAST(d.pct / 100.0 AS DECIMAL(9, 6))
      FROM dbo.socios_duenos d
      JOIN dbo.socios s ON s.id = d.socio_id AND s.activo = 1
      JOIN dbo.products p ON p.id = d.entidad_id
     WHERE d.entidad = 'PRODUCTO';

    INSERT INTO #duenos (product_id, socio_id, pct)
    SELECT p.id, d.socio_id, CAST(d.pct / 100.0 AS DECIMAL(9, 6))
      FROM dbo.products p
      JOIN dbo.socios_duenos d ON d.entidad = 'CATEGORIA' AND d.entidad_id = p.category_id
      JOIN dbo.socios s ON s.id = d.socio_id AND s.activo = 1
     WHERE NOT EXISTS (SELECT 1 FROM #duenos x WHERE x.product_id = p.id);

    IF @sin_dueno IS NOT NULL AND EXISTS (SELECT 1 FROM dbo.socios WHERE id = @sin_dueno AND activo = 1)
        INSERT INTO #duenos (product_id, socio_id, pct)
        SELECT p.id, @sin_dueno, 1
          FROM dbo.products p
         WHERE NOT EXISTS (SELECT 1 FROM #duenos x WHERE x.product_id = p.id);
    ELSE
        INSERT INTO #duenos (product_id, socio_id, pct)
        SELECT p.id, s.id, CAST(1.0 / @activos AS DECIMAL(9, 6))
          FROM dbo.products p
         CROSS JOIN dbo.socios s
         WHERE s.activo = 1
           AND NOT EXISTS (SELECT 1 FROM #duenos x WHERE x.product_id = p.id);
END
GO
