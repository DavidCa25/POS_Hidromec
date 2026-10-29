/* sp_asistencia_reglas_get
 * Definicion canonica. Mantener este archivo y generar una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* ==================== sp_asistencia_reglas_get (0071) ====================
   Las reglas de Asistencia y si el modulo esta encendido. Sin fila: el
   negocio nunca la activo.
   ==================================================================== */
CREATE OR ALTER PROCEDURE dbo.sp_asistencia_reglas_get
AS
BEGIN
    SET NOCOUNT ON;
    SELECT r.cuenta_extra, r.tolerancia_min, r.descanso_pagado, r.dia_libre_extra,
           r.marca_retardos, r.entrada_para_vender, r.updated_at, r.updated_by,
           CAST(CASE WHEN EXISTS (SELECT 1 FROM dbo.business_modules
                                   WHERE module_key = N'asistencia' AND enabled = 1)
                     THEN 1 ELSE 0 END AS BIT) AS activa
      FROM dbo.asistencia_reglas r
     WHERE r.id = 1;
END
GO
