/* sp_propinas_config_get
 * Definicion canonica. Mantener este archivo y generar una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* ====================== sp_propinas_config_get (0079) =====================
   La configuracion de Propinas y si esta encendido. Sin fila: nunca se
   activo.
   ======================================================================= */
CREATE OR ALTER PROCEDURE dbo.sp_propinas_config_get
AS
BEGIN
    SET NOCOUNT ON;
    SELECT c.reparto, c.sugeridas, c.comision_pct, c.comision_a, c.updated_at,
           CAST(CASE WHEN EXISTS (SELECT 1 FROM dbo.business_modules WHERE module_key = N'propinas' AND enabled = 1)
                     THEN 1 ELSE 0 END AS BIT) AS activo
      FROM dbo.propinas_config c WHERE c.id = 1;
END
GO
