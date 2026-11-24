/* sp_salud_temperatura_save
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* Una lectura de temperatura del local o del refrigerador, con quién la tomó.
 */
CREATE OR ALTER PROCEDURE [dbo].[sp_salud_temperatura_save]
    @equipo  NVARCHAR(40),
    @grados  DECIMAL(4,1),
    @user_id INT = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET @equipo = NULLIF(LTRIM(RTRIM(@equipo)), N'');
    IF @equipo IS NULL BEGIN RAISERROR('Elige el equipo.', 16, 1); RETURN; END
    IF @grados IS NULL OR @grados NOT BETWEEN -40 AND 60
    BEGIN RAISERROR('Temperatura fuera de rango.', 16, 1); RETURN; END

    INSERT INTO dbo.salud_temperaturas (equipo, grados, user_id) VALUES (@equipo, @grados, @user_id);
    SELECT CAST(SCOPE_IDENTITY() AS INT) AS id;
END
GO
