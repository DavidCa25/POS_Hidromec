/* sp_rendimiento_mapear
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* 0095 · QUÉ PLATILLO CUENTA TACOS DE QUÉ CARNE.

   Sin que nadie lo configure: por el NOMBRE. Un producto que se vende y
   cuyo nombre lleva el de la carne («Taco al pastor», «Gringa al pastor»,
   «Orden de 5 al pastor») cuenta tacos de esa carne, sin importar acentos ni
   mayúsculas:

     «… kilo …» / «… kg …»      rinde × los kilos (½ y ¼ se entienden)
     «Orden de 5», «3 tacos»     el número
     lo demás                    1 taco

   Lo que una persona fijó a mano (`manual = 1`) no se toca. Se vuelve a
   calcular al guardar las carnes, al ajustar un rendimiento y antes de cada
   cierre, así un platillo nuevo del menú entra solo. */
CREATE OR ALTER PROCEDURE dbo.sp_rendimiento_mapear
AS
BEGIN
    SET NOCOUNT ON;

    DELETE FROM dbo.rendimiento_platillos WHERE manual = 0;

    ;WITH cand AS (
        SELECT p.id AS product_id, c.product_id AS carne_id, c.rinde,
               LOWER(p.nombre) COLLATE Modern_Spanish_CI_AI AS nom,
               PATINDEX(N'%[0-9]%', p.nombre) AS pos, p.nombre
          FROM dbo.rendimiento_carnes c
          JOIN dbo.products ci ON ci.id = c.product_id
          JOIN dbo.products p
            ON p.sellable = 1 AND ISNULL(p.active, 1) = 1 AND p.id <> c.product_id
           AND p.nombre COLLATE Modern_Spanish_CI_AI LIKE N'%' + LTRIM(RTRIM(ci.nombre)) COLLATE Modern_Spanish_CI_AI + N'%'
         WHERE c.activo = 1
           AND NOT EXISTS (SELECT 1 FROM dbo.rendimiento_platillos m WHERE m.product_id = p.id AND m.carne_id = c.product_id)),
    num AS (
        SELECT cand.*,
               CASE WHEN pos > 0 THEN TRY_CONVERT(INT, SUBSTRING(nombre, pos,
                    ISNULL(NULLIF(PATINDEX(N'%[^0-9]%', SUBSTRING(nombre, pos, 10) + N'x'), 0), 1) - 1)) END AS n
          FROM cand)
    INSERT INTO dbo.rendimiento_platillos (product_id, carne_id, tacos, manual)
    SELECT product_id, carne_id,
           CASE WHEN nom LIKE N'%kilo%' OR nom LIKE N'% kg%'
                THEN rinde * CASE WHEN nom LIKE N'%1/2%' OR nom LIKE N'%medio%' THEN 0.5
                                  WHEN nom LIKE N'%1/4%' OR nom LIKE N'%cuarto%' THEN 0.25
                                  ELSE 1 END
                WHEN n BETWEEN 2 AND 50 AND (nom LIKE N'%orden%' OR nom LIKE N'%taco%') THEN n
                ELSE 1 END,
           0
      FROM num;
END;
GO
