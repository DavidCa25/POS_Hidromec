/* sp_salud_odontograma_get
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* El estado ACTUAL de cada diente y cara (la última marca) y, aparte, el
 * historial reciente. Lo actual sale del índice IX_salud_odontograma_actual
 * sin ordenar toda la historia.
 */
CREATE OR ALTER PROCEDURE [dbo].[sp_salud_odontograma_get]
    @customer_id INT,
    @historial   INT = 100
AS
BEGIN
    SET NOCOUNT ON;
    IF @historial IS NULL OR @historial NOT BETWEEN 0 AND 1000 SET @historial = 100;

    ;WITH ult AS (
        SELECT o.diente, o.cara, o.estado, o.nota, o.at,
               ROW_NUMBER() OVER (PARTITION BY o.diente, o.cara ORDER BY o.id DESC) AS rn
          FROM dbo.salud_odontograma o
         WHERE o.paciente_id = @customer_id
    )
    SELECT diente, cara, estado, nota, at FROM ult WHERE rn = 1 AND estado <> N'SANO'
     ORDER BY diente, cara;

    SELECT TOP (@historial) o.id, o.diente, o.cara, o.estado, o.nota, o.at, u.usuario
      FROM dbo.salud_odontograma o
      LEFT JOIN dbo.users u ON u.id = o.user_id
     WHERE o.paciente_id = @customer_id
     ORDER BY o.id DESC;
END
GO
