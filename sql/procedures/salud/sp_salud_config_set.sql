/* sp_salud_config_set
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* Elegir el preset de Salud ENCIENDE el módulo `salud`, en la misma
 * transacción y por su propia puerta (sp_set_business_module).
 *
 * Que la clínica necesite además Servicios (agenda, profesionales, cobro de
 * órdenes) lo resuelve el proceso principal: sp_set_services_preset ya usa
 * INSERT…EXEC por dentro, y anidarlo aquí no compila.
 */
CREATE OR ALTER PROCEDURE [dbo].[sp_salud_config_set]
    @preset   NVARCHAR(40),
    @farmacia BIT,
    @clinica  BIT,
    @dental   BIT,
    @estudios BIT = 0,
    @user_id  INT = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    SET @preset = UPPER(LTRIM(RTRIM(ISNULL(@preset, N''))));
    IF @preset = N''
    BEGIN
        RAISERROR('Falta el giro de Salud.', 16, 1);
        RETURN;
    END
    /* Dental es una forma de consultorio: sin expediente no hay odontograma. */
    IF ISNULL(@dental, 0) = 1 SET @clinica = 1;
    IF ISNULL(@farmacia, 0) = 0 AND ISNULL(@clinica, 0) = 0 AND ISNULL(@estudios, 0) = 0
    BEGIN
        RAISERROR('El giro de Salud necesita farmacia, consultorio o estudios.', 16, 1);
        RETURN;
    END

    BEGIN TRAN;

    MERGE dbo.salud_config AS d
    USING (SELECT CAST(1 AS TINYINT) AS id) AS s ON d.id = s.id
     WHEN MATCHED THEN
          UPDATE SET preset = @preset, farmacia = ISNULL(@farmacia, 0), clinica = ISNULL(@clinica, 0),
                     dental = ISNULL(@dental, 0), estudios = ISNULL(@estudios, 0), set_at = SYSDATETIME(), set_by = @user_id
     WHEN NOT MATCHED THEN
          INSERT (id, preset, farmacia, clinica, dental, estudios, set_at, set_by)
          VALUES (1, @preset, ISNULL(@farmacia, 0), ISNULL(@clinica, 0), ISNULL(@dental, 0), ISNULL(@estudios, 0), SYSDATETIME(), @user_id);

    /* El resultado del módulo se recoge aparte: si saliera, el primer
       conjunto que recibe quien llama sería el del módulo y no el giro. */
    DECLARE @modulo TABLE (
        module_key NVARCHAR(40), enabled BIT, enabled_at DATETIME2(0),
        enabled_by INT, updated_at DATETIME2(0));
    INSERT INTO @modulo
    EXEC dbo.sp_set_business_module @module_key = N'salud', @enabled = 1, @user_id = @user_id;

    COMMIT;

    SELECT preset, farmacia, clinica, dental, estudios, set_at, set_by
      FROM dbo.salud_config WHERE id = 1;
END
GO
