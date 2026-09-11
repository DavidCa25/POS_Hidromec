/* sp_get_registers
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* ---- Listar cajas ---- */
CREATE OR ALTER PROCEDURE [dbo].[sp_get_registers]
    @only_active BIT = 0
AS
BEGIN
    SET NOCOUNT ON;
    SELECT
        id,
        code,
        name,
        is_active,
        created_at
    FROM dbo.registers
    WHERE (@only_active = 0 OR is_active = 1)
    ORDER BY id;
END
GO
