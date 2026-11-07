/* sp_propinas_config_guardar
 * Definicion canonica. Mantener este archivo y generar una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* ==================== sp_propinas_config_guardar (0079) ===================
   Las respuestas de "Activar Propinas". @activar = 1 guarda Y enciende el
   modulo en la misma transaccion; @activar = 0 cambia un modulo encendido.

   @reparto      ATENDIO  a quien cobro la venta
                 HORAS    bote del turno por horas trabajadas (Asistencia)
                 IGUALES  bote del turno en partes iguales
   @sugeridas    los botones de %, p. ej. '10,15,20' (de 1 a 4, de 1 a 50)
   @comision_pct comision del banco sobre la propina con tarjeta (0 a 20)
   @comision_a   NEGOCIO la absorbe; PROPINA se descuenta de la propina
   ======================================================================= */
CREATE OR ALTER PROCEDURE dbo.sp_propinas_config_guardar
    @reparto      VARCHAR(8),
    @sugeridas    VARCHAR(40),
    @comision_pct DECIMAL(5, 2) = 0,
    @comision_a   VARCHAR(8) = 'NEGOCIO',
    @activar      BIT = 0,
    @user_id      INT = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    SET @reparto = UPPER(LTRIM(RTRIM(ISNULL(@reparto, ''))));
    SET @comision_a = UPPER(LTRIM(RTRIM(ISNULL(@comision_a, 'NEGOCIO'))));
    IF @reparto NOT IN ('ATENDIO', 'HORAS', 'IGUALES') THROW 51000, N'Elige cómo se reparten las propinas.', 1;
    IF @comision_a NOT IN ('NEGOCIO', 'PROPINA') THROW 51000, N'Elige quién paga la comisión de tarjeta.', 1;
    IF @comision_pct IS NULL OR @comision_pct < 0 OR @comision_pct > 20 THROW 51000, N'La comisión va de 0 a 20 %.', 1;

    DECLARE @s TABLE (n INT);
    INSERT INTO @s (n) SELECT TRY_CAST(LTRIM(RTRIM(value)) AS INT) FROM STRING_SPLIT(ISNULL(@sugeridas, ''), ',')
     WHERE LTRIM(RTRIM(value)) <> '';
    IF NOT EXISTS (SELECT 1 FROM @s) OR (SELECT COUNT(*) FROM @s) > 4
       OR EXISTS (SELECT 1 FROM @s WHERE n IS NULL OR n < 1 OR n > 50)
        THROW 51000, N'Los porcentajes sugeridos son de 1 a 4 números entre 1 y 50.', 1;
    SET @sugeridas = (SELECT STRING_AGG(CAST(n AS VARCHAR(3)), ',') WITHIN GROUP (ORDER BY n) FROM (SELECT DISTINCT n FROM @s) x);

    IF ISNULL(@activar, 0) = 0
       AND NOT EXISTS (SELECT 1 FROM dbo.business_modules WHERE module_key = N'propinas' AND enabled = 1)
        THROW 51000, N'Propinas no está activado.', 1;

    BEGIN TRAN;
        MERGE dbo.propinas_config AS d
        USING (SELECT CAST(1 AS TINYINT) AS id) AS s ON d.id = s.id
        WHEN MATCHED THEN UPDATE SET reparto = @reparto, sugeridas = @sugeridas, comision_pct = @comision_pct,
             comision_a = @comision_a, updated_at = SYSDATETIME(), updated_by = @user_id
        WHEN NOT MATCHED THEN INSERT (id, reparto, sugeridas, comision_pct, comision_a, updated_at, updated_by)
             VALUES (1, @reparto, @sugeridas, @comision_pct, @comision_a, SYSDATETIME(), @user_id);

        IF @activar = 1
        BEGIN
            DECLARE @r TABLE (module_key NVARCHAR(40), enabled BIT, enabled_at DATETIME2(0), enabled_by INT, updated_at DATETIME2(0));
            INSERT INTO @r EXEC dbo.sp_set_business_module @module_key = N'propinas', @enabled = 1, @user_id = @user_id;
        END
    COMMIT;

    EXEC dbo.sp_propinas_config_get;
END
GO
