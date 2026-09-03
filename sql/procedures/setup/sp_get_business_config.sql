/* sp_get_business_config
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
-- =============================================
-- Author:		<David Casillas>
-- Create date: <11-12-2025>
-- Description:	<Obtener Datos del Negocio>
-- =============================================
CREATE OR ALTER PROCEDURE sp_get_business_config
AS
BEGIN
    SELECT TOP 1 * FROM business_config;
END
GO
