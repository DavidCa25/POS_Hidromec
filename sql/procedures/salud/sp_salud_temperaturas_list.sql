/* sp_salud_temperaturas_list
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* Las lecturas de los últimos días, más recientes primero.
 */
CREATE OR ALTER PROCEDURE [dbo].[sp_salud_temperaturas_list]
    @dias INT = 30
AS
BEGIN
    SET NOCOUNT ON;
    IF @dias IS NULL OR @dias NOT BETWEEN 1 AND 366 SET @dias = 30;
    SELECT t.id, t.equipo, t.grados, t.at, u.usuario
      FROM dbo.salud_temperaturas t
      LEFT JOIN dbo.users u ON u.id = t.user_id
     WHERE t.at >= DATEADD(DAY, -@dias, CAST(GETDATE() AS DATE))
     ORDER BY t.at DESC, t.id DESC;
END
GO
