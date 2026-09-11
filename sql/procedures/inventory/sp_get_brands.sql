/* sp_get_brands
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




CREATE OR ALTER PROCEDURE sp_get_brands
AS
BEGIN
    SELECT id, namee FROM CAT_brands;
END
GO
