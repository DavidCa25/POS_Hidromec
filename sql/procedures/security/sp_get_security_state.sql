/* sp_get_security_state
 * Definicion canonica. Modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* El estado de seguridad de la base, en una sola consulta barata.
 *
 * `security_revision` la leen las sesiones abiertas para saber si sus
 * permisos siguen siendo validos; se consulta a lo sumo cada pocos segundos
 * por maquina, no en cada accion.
 *
 * `security_model_version` la compara el binario al arrancar: si la base va
 * por delante, esta caja no sabe interpretar los permisos vigentes.
 */
CREATE OR ALTER PROCEDURE [dbo].[sp_get_security_state]
AS
BEGIN
    SET NOCOUNT ON;
    SELECT
        CONVERT(INT, ISNULL((SELECT valor FROM dbo.database_metadata
                              WHERE clave = 'security_revision'), '1')) AS security_revision,
        CONVERT(INT, ISNULL((SELECT valor FROM dbo.database_metadata
                              WHERE clave = 'security_model_version'), '1')) AS security_model_version;
END
GO
