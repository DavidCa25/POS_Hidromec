/* sp_get_actual_folio
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
-- =============================================
-- Author:		<David Casillas>
-- Create date: <20-12-2025>
-- Description:	<Obtnener actual folio>
-- =============================================
CREATE OR ALTER PROCEDURE sp_get_actual_folio
AS
BEGIN
    SET NOCOUNT ON;

    SELECT ISNULL(MAX(id), 0) + 1 AS next_folio
    FROM sales;
END
GO
