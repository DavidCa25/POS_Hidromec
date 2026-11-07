/* sp_socios_producto_dueno
 * Definicion canonica. Mantener este archivo y generar una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* ===================== sp_socios_producto_dueno (0079) ====================
   De quien es UN producto (el campo "Pertenece a" del formulario).

   @duenos = '[{"socioId":1,"pct":100}]'. Vacio o NULL: el producto vuelve a
   ser de quien sea su categoria. Debe sumar 100 %.

   Siempre devuelve el dueno RESUELTO del producto (producto, categoria o
   sin dueno) y de donde sale, para que el formulario lo ensene.
   ======================================================================= */
CREATE OR ALTER PROCEDURE dbo.sp_socios_producto_dueno
    @product_id INT,
    @duenos     NVARCHAR(MAX) = NULL,
    @guardar    BIT = 1
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    IF NOT EXISTS (SELECT 1 FROM dbo.products WHERE id = @product_id) THROW 51000, N'Ese producto no existe.', 1;

    IF @guardar = 1
    BEGIN
        IF NOT EXISTS (SELECT 1 FROM dbo.business_modules WHERE module_key = N'socios' AND enabled = 1)
            THROW 51000, N'Socios no está activado.', 1;
        IF @duenos IS NOT NULL AND ISJSON(@duenos) <> 1 THROW 51000, N'Dueños inválidos.', 1;

        DECLARE @d TABLE (socio_id INT PRIMARY KEY, pct DECIMAL(7, 4));
        INSERT INTO @d (socio_id, pct)
        SELECT socioId, SUM(pct) FROM OPENJSON(ISNULL(@duenos, '[]')) WITH (socioId INT, pct DECIMAL(7, 4))
         WHERE pct > 0 GROUP BY socioId;
        IF EXISTS (SELECT 1 FROM @d d WHERE NOT EXISTS (SELECT 1 FROM dbo.socios s WHERE s.id = d.socio_id AND s.activo = 1))
            THROW 51000, N'Ese socio no está activo.', 1;
        IF EXISTS (SELECT 1 FROM @d) AND ABS((SELECT SUM(pct) FROM @d) - 100) > 0.01
            THROW 51000, N'Lo del producto debe sumar 100 %.', 1;

        BEGIN TRAN;
            DELETE FROM dbo.socios_duenos WHERE entidad = 'PRODUCTO' AND entidad_id = @product_id;
            INSERT INTO dbo.socios_duenos (entidad, entidad_id, socio_id, pct)
            SELECT 'PRODUCTO', @product_id, socio_id, pct FROM @d;
        COMMIT;
    END

    CREATE TABLE #duenos (product_id INT NOT NULL, socio_id INT NOT NULL, pct DECIMAL(9, 6) NOT NULL,
                          PRIMARY KEY (product_id, socio_id));
    EXEC dbo.sp_socios_llenar_duenos;

    SELECT o.socio_id, s.nombre, CAST(ROUND(o.pct * 100, 2) AS DECIMAL(7, 2)) AS pct,
           CASE WHEN EXISTS (SELECT 1 FROM dbo.socios_duenos WHERE entidad = 'PRODUCTO' AND entidad_id = @product_id) THEN 'PRODUCTO'
                WHEN EXISTS (SELECT 1 FROM dbo.socios_duenos d JOIN dbo.products p ON p.id = @product_id
                              WHERE d.entidad = 'CATEGORIA' AND d.entidad_id = p.category_id) THEN 'CATEGORIA'
                ELSE 'SIN_DUENO' END AS origen
      FROM #duenos o JOIN dbo.socios s ON s.id = o.socio_id
     WHERE o.product_id = @product_id
     ORDER BY s.orden, s.id;
END
GO
