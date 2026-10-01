/* sp_import_undo_check
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* ============================================================
   DESHACER

   Deshacer NO es borrar. Un producto que ya se vendio tiene historia, y
   la historia no se reescribe porque alguien se arrepienta de una
   importacion. Por eso hay tres respuestas y no una:

     TODO        ninguna fila tuvo actividad posterior
     EN_PARTE    algunas si, y esas se quedan
     NADA        el catalogo ya se movio demasiado

   Lo que se deshace se deshace con MOVIMIENTOS INVERSOS y desactivando,
   nunca con DELETE.
   ============================================================ */
CREATE OR ALTER PROCEDURE dbo.sp_import_undo_check
    @batch_id INT
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @ref NVARCHAR(50) = CONCAT('IMP-', @batch_id);

    ;WITH aplicadas AS (
        SELECT r.id, r.accion, r.applied_product_id
          FROM dbo.import_rows r
         WHERE r.batch_id = @batch_id AND r.aplicada = 1 AND r.applied_product_id IS NOT NULL
    ),
    con_actividad AS (
        SELECT a.id
          FROM aplicadas a
         WHERE EXISTS (SELECT 1 FROM dbo.sale_detail sd WHERE sd.product_id = a.applied_product_id)
            OR EXISTS (SELECT 1 FROM dbo.purchase_detail pd WHERE pd.product_id = a.applied_product_id)
            OR EXISTS (SELECT 1 FROM dbo.recipe_lines rl WHERE rl.ingredient_product_id = a.applied_product_id)
            OR EXISTS (SELECT 1 FROM dbo.inventory_movements m
                        WHERE m.product_id = a.applied_product_id
                          AND NOT (m.reference = @ref AND m.source = 'IMPORT_INICIAL'))
    )
    SELECT
        (SELECT COUNT(*) FROM aplicadas) AS aplicadas,
        (SELECT COUNT(*) FROM con_actividad) AS con_actividad,
        CASE
            WHEN (SELECT COUNT(*) FROM aplicadas) = 0 THEN 'NADA'
            WHEN (SELECT COUNT(*) FROM con_actividad) = 0 THEN 'TODO'
            WHEN (SELECT COUNT(*) FROM con_actividad) < (SELECT COUNT(*) FROM aplicadas) THEN 'EN_PARTE'
            ELSE 'NADA' END AS veredicto;
END
GO
