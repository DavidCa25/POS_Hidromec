/* sp_salud_config_get
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* Qué partes del giro Salud usa este negocio. Sin fila: el módulo nunca se
 * configuró y no se inventa nada.
 */
CREATE OR ALTER PROCEDURE [dbo].[sp_salud_config_get]
AS
BEGIN
    SET NOCOUNT ON;
    SELECT preset, farmacia, clinica, dental, estudios, set_at, set_by
      FROM dbo.salud_config
     WHERE id = 1;
END
GO
