/* sp_setup_status
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* ============================================================
   Wybix - SPs del asistente de primer arranque
   Colocar en electron/migrations/
   Sin USE: el runner ya esta conectado a la base correcta.
   ============================================================ */

CREATE OR ALTER PROCEDURE [dbo].[sp_setup_status]
AS
BEGIN
    SET NOCOUNT ON;
    SELECT
        (SELECT COUNT(*) FROM dbo.users WHERE active = 1)   AS usuarios,
        (SELECT COUNT(*) FROM dbo.business_config)          AS negocio_configurado;
END
GO
