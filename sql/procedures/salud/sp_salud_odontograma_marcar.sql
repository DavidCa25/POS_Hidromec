/* sp_salud_odontograma_marcar
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* Agrega las marcas de una visita. Nunca reescribe las anteriores: el
 * odontograma de hoy se lee como la última marca de cada diente y cara.
 *
 * @marcas: JSON [{ "diente": 36, "cara": "O", "estado": "CARIES", "nota": "" }]
 * Marcar SANO es la forma de decir «ya se resolvió».
 */
CREATE OR ALTER PROCEDURE [dbo].[sp_salud_odontograma_marcar]
    @customer_id INT,
    @marcas      NVARCHAR(MAX),
    @user_id     INT
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;
    IF @marcas IS NULL OR ISJSON(@marcas) <> 1
    BEGIN RAISERROR('Marcas inválidas.', 16, 1); RETURN; END
    IF NOT EXISTS (SELECT 1 FROM dbo.salud_pacientes WHERE customer_id = @customer_id AND consentimiento_at IS NOT NULL)
    BEGIN RAISERROR('SIN_CONSENTIMIENTO: el paciente no ha dado su consentimiento para el tratamiento de sus datos.', 16, 1); RETURN; END

    DECLARE @m TABLE (diente TINYINT, cara NVARCHAR(2), estado NVARCHAR(20), nota NVARCHAR(200));
    INSERT INTO @m (diente, cara, estado, nota)
    SELECT TRY_CAST(j.diente AS TINYINT), UPPER(LTRIM(RTRIM(j.cara))), UPPER(LTRIM(RTRIM(j.estado))),
           NULLIF(LTRIM(RTRIM(j.nota)), N'')
      FROM OPENJSON(@marcas)
           WITH (diente NVARCHAR(5) '$.diente', cara NVARCHAR(5) '$.cara',
                 estado NVARCHAR(30) '$.estado', nota NVARCHAR(200) '$.nota') j;

    IF NOT EXISTS (SELECT 1 FROM @m)
    BEGIN RAISERROR('No hay marcas que guardar.', 16, 1); RETURN; END
    IF EXISTS (SELECT 1 FROM @m WHERE diente IS NULL)
    BEGIN RAISERROR('Diente inválido.', 16, 1); RETURN; END

    BEGIN TRAN;
    /* Los CHECK de la tabla validan diente FDI, cara y estado: un valor raro
       revienta aquí con su nombre de restricción y no se guarda nada. */
    INSERT INTO dbo.salud_odontograma (paciente_id, diente, cara, estado, nota, user_id)
    SELECT @customer_id, diente, cara, estado, nota, @user_id FROM @m;
    DECLARE @guardadas INT = @@ROWCOUNT;

    INSERT INTO dbo.salud_bitacora (user_id, paciente_id, accion)
    VALUES (@user_id, @customer_id, N'ODONTOGRAMA');
    COMMIT;

    SELECT @guardadas AS guardadas;
END
GO
