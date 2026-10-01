/* sp_import_undo
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
CREATE OR ALTER PROCEDURE dbo.sp_import_undo
    @batch_id INT,
    @user_id INT = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    DECLARE @ref NVARCHAR(50) = CONCAT('IMP-', @batch_id);
    DECLARE @reversibles TABLE (row_id INT, product_id INT, accion NVARCHAR(12));

    INSERT INTO @reversibles (row_id, product_id, accion)
    SELECT r.id, r.applied_product_id, r.accion
      FROM dbo.import_rows r
     WHERE r.batch_id = @batch_id AND r.aplicada = 1 AND r.applied_product_id IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM dbo.sale_detail sd WHERE sd.product_id = r.applied_product_id)
       AND NOT EXISTS (SELECT 1 FROM dbo.purchase_detail pd WHERE pd.product_id = r.applied_product_id)
       AND NOT EXISTS (SELECT 1 FROM dbo.recipe_lines rl WHERE rl.ingredient_product_id = r.applied_product_id)
       AND NOT EXISTS (SELECT 1 FROM dbo.inventory_movements m
                        WHERE m.product_id = r.applied_product_id
                          AND NOT (m.reference = @ref AND m.source = 'IMPORT_INICIAL'));

    DECLARE @revertidas INT = 0, @conservadas INT = 0;

    BEGIN TRAN;

        /* La existencia vuelve por donde entro: un movimiento de salida
           que anula al de entrada. El de entrada NO se borra. */
        INSERT INTO dbo.inventory_movements
              (product_id, typee, reference, quantity, datee, descriptionn, source, unit_cost)
        SELECT m.product_id, 'salida', @ref, m.quantity, SYSDATETIME(),
               CONCAT('Deshacer carga #', @batch_id), 'IMPORT_UNDO', m.unit_cost
          FROM dbo.inventory_movements m
          JOIN @reversibles v ON v.product_id = m.product_id
         WHERE m.reference = @ref AND m.source = 'IMPORT_INICIAL'
           AND NOT EXISTS (SELECT 1 FROM dbo.inventory_movements u
                            WHERE u.product_id = m.product_id AND u.reference = @ref
                              AND u.source = 'IMPORT_UNDO');

        UPDATE p SET p.stock = p.stock - m.quantity
          FROM dbo.products p
          JOIN dbo.inventory_movements m ON m.product_id = p.id
          JOIN @reversibles v ON v.product_id = p.id
         WHERE m.reference = @ref AND m.source = 'IMPORT_INICIAL';

        /* Lo que la carga CREO se desactiva; no se borra, porque su id
           puede estar ya escrito en otro sitio que no sabemos mirar. */
        UPDATE p SET p.active = 0
          FROM dbo.products p JOIN @reversibles v ON v.product_id = p.id
         WHERE v.accion = 'CREATE';

        /* Lo que la carga ACTUALIZO vuelve a su valor anterior. */
        UPDATE p
           SET p.price = TRY_CONVERT(DECIMAL(10,2), JSON_VALUE(r.previo_json, '$.price')),
               p.cost  = TRY_CONVERT(DECIMAL(14,4), JSON_VALUE(r.previo_json, '$.cost')),
               p.nombre = ISNULL(JSON_VALUE(r.previo_json, '$.nombre'), p.nombre)
          FROM dbo.products p
          JOIN dbo.import_rows r ON r.applied_product_id = p.id
          JOIN @reversibles v ON v.row_id = r.id
         WHERE v.accion = 'UPDATE' AND r.previo_json IS NOT NULL;

        UPDATE r SET aplicada = 0, applied_at = NULL, applied_product_id = NULL
          FROM dbo.import_rows r JOIN @reversibles v ON v.row_id = r.id;

        SET @revertidas = (SELECT COUNT(*) FROM @reversibles);
        SET @conservadas = (SELECT COUNT(*) FROM dbo.import_rows
                             WHERE batch_id = @batch_id AND aplicada = 1);

        UPDATE dbo.import_batches
           SET creadas = 0, actualizadas = 0, estado = 'REVISION', updated_at = SYSDATETIME()
         WHERE id = @batch_id;

    COMMIT TRAN;

    EXEC dbo.sp_import_batch_touch @batch_id = @batch_id;

    SELECT @revertidas AS revertidas, @conservadas AS conservadas;
END
GO
