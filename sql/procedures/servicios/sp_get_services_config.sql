/* sp_get_services_config
 * Definicion canonica. Modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* El giro de Servicios de este negocio.
 *
 * Devuelve SIEMPRE una fila, aunque nadie haya elegido nada: con `preset` en
 * NULL. Devolver cero filas obligaria a cada sitio que lo lee a distinguir
 * «no hay fila» de «hay fila vacia», y esa es la clase de diferencia que
 * alguien acaba olvidando en uno de los sitios.
 *
 * `preset` en NULL significa «este negocio no ha elegido giro»: es lo que
 * tiene toda instalacion que encendio Servicios antes de que los giros
 * existieran. No es un error ni un estado a medias, y la interfaz lo resuelve
 * presentando el modulo como se presentaba entonces.
 */
CREATE OR ALTER PROCEDURE [dbo].[sp_get_services_config]
AS
BEGIN
    SET NOCOUNT ON;

    SELECT
        c.preset,
        c.set_at,
        c.set_by,
        u.usuario AS set_by_name
      FROM (SELECT 1 AS id) AS uno
      LEFT JOIN dbo.services_config AS c ON c.id = uno.id
      LEFT JOIN dbo.users           AS u ON u.id = c.set_by;
END
GO
