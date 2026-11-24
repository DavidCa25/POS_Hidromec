/* sp_salud_profesional_get
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* Los datos con los que firma un profesional: nombre, cédula, institución
 * y especialidad. Sin fila, el usuario todavía no los ha capturado.
 */
CREATE OR ALTER PROCEDURE [dbo].[sp_salud_profesional_get]
    @user_id INT
AS
BEGIN
    SET NOCOUNT ON;
    SELECT p.user_id, p.nombre, p.cedula, p.institucion, p.especialidad, p.cedula_especialidad, p.updated_at
      FROM dbo.salud_profesionales p
     WHERE p.user_id = @user_id;
END
GO
