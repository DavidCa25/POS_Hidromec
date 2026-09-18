/* sp_get_business_modules
 * Definicion canonica. Modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* Que modulos tiene encendidos el NEGOCIO.
 *
 * Una fila ausente significa apagado, asi que esto devuelve solo lo que
 * alguna vez se encendio. Quien pregunta decide por omision, y la omision es
 * siempre "no".
 */
CREATE OR ALTER PROCEDURE [dbo].[sp_get_business_modules]
AS
BEGIN
    SET NOCOUNT ON;
    SELECT module_key, enabled, enabled_at, enabled_by, updated_at
      FROM dbo.business_modules
     ORDER BY module_key;
END
GO
