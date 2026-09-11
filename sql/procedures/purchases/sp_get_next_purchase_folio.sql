/* sp_get_next_purchase_folio
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
CREATE OR ALTER PROCEDURE sp_get_next_purchase_folio
AS
BEGIN
    SET NOCOUNT ON;

    SELECT ISNULL(MAX(id), 0) + 1 AS next_folio
    FROM purchase;
END
GO
