/* sp_reactivate_product
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
-- =============================================
-- Author:		<Daniela Luna>
-- Create date: <04/08/2025>
-- Description:	<SP para agregar usuarios>
-- =============================================




CREATE OR ALTER PROCEDURE sp_reactivate_product
    @product_id INT
AS
BEGIN
    UPDATE products
    SET active = 1
    WHERE id = @product_id;
END;
GO
