/* sp_production_formula_delete
 * Definicion canonica. No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* 0060 · Quita la fórmula de un producto. No mientras tenga tandas
   planeadas o en preparación: esas ya cuentan con ella. Las tandas
   terminadas conservan lo que consumieron (production_batch_consumption). */
CREATE OR ALTER PROCEDURE dbo.sp_production_formula_delete
    @product_id INT
AS
BEGIN
    SET NOCOUNT ON;
    IF EXISTS (SELECT 1 FROM dbo.production_batches WHERE product_id = @product_id AND status IN ('PLANNED', 'IN_PROGRESS'))
    BEGIN RAISERROR('Este producto tiene tandas planeadas o en preparacion. Terminalas o cancelalas antes de quitar su formula.', 16, 1); RETURN; END
    DELETE FROM dbo.production_formulas WHERE product_id = @product_id;
    SELECT @@ROWCOUNT AS borradas;
END
GO
