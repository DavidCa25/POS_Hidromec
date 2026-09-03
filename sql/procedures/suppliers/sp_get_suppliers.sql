/* sp_get_suppliers
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




CREATE OR ALTER PROCEDURE [dbo].[sp_get_suppliers]
AS
BEGIN
    SET NOCOUNT ON;

    SELECT
        id,
        nombre
    FROM CAT_suppliers
    ORDER BY id;
END;
GO
