/* sp_get_uoms
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
-- Unidades de medida: COUNT (pza), WEIGHT (g), VOLUME (ml), LENGTH (cm) con
-- sus presentaciones (kg, L, m...). factor_to_base = cuantas unidades base
-- hay en una de estas.
CREATE OR ALTER PROCEDURE dbo.sp_get_uoms
AS
BEGIN
    SET NOCOUNT ON;
    SELECT code, name, dimension, factor_to_base, is_base, sort_order
    FROM dbo.uoms
    ORDER BY sort_order, code;
END
GO
