/* sp_salud_estudio_capturar
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* Captura (o corrige, mientras no se valide) el resultado de un estudio.
 *
 * Laboratorio: @resultados JSON [{ "clave": "GLU", "valor": "112" }]. Solo
 *   claves de los parámetros que se pidieron. La BANDERA la pone la base,
 *   no la pantalla: A si el valor numérico pasa del máximo de referencia, B
 *   si queda bajo el mínimo.
 * Imagen: @hallazgos y @conclusion; en mastografía, BI-RADS 0 a 6.
 *
 * Capturar un estudio que no se marcó como tomado lo da por tomado.
 */
CREATE OR ALTER PROCEDURE [dbo].[sp_salud_estudio_capturar]
    @item_id    INT,
    @resultados NVARCHAR(MAX)  = NULL,
    @hallazgos  NVARCHAR(MAX)  = NULL,
    @conclusion NVARCHAR(1000) = NULL,
    @birads     TINYINT        = NULL,
    @user_id    INT            = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;
    SET @hallazgos = NULLIF(LTRIM(RTRIM(@hallazgos)), N'');
    SET @conclusion = NULLIF(LTRIM(RTRIM(@conclusion)), N'');

    BEGIN TRAN;
    DECLARE @estado NVARCHAR(12), @tipo NVARCHAR(10), @modalidad NVARCHAR(20), @param NVARCHAR(MAX), @orden INT;
    SELECT @estado = estado, @tipo = tipo, @modalidad = modalidad, @param = parametros, @orden = orden_id
      FROM dbo.salud_estudio_items WITH (UPDLOCK) WHERE id = @item_id;
    IF @estado IS NULL BEGIN ROLLBACK; RAISERROR('El estudio no existe.', 16, 1); RETURN; END
    IF @estado IN (N'VALIDADO', N'CANCELADO')
    BEGIN ROLLBACK; RAISERROR('ESTUDIO_VALIDADO: este estudio ya está cerrado.', 16, 1); RETURN; END

    DECLARE @final NVARCHAR(MAX) = NULL;
    IF @tipo = N'LAB'
    BEGIN
        IF ISJSON(ISNULL(@resultados, N'')) = 0 BEGIN ROLLBACK; RAISERROR('Captura los resultados.', 16, 1); RETURN; END
        DECLARE @r TABLE (clave NVARCHAR(20), valor NVARCHAR(60));
        INSERT INTO @r
        SELECT LTRIM(RTRIM(clave)), NULLIF(LTRIM(RTRIM(valor)), N'')
          FROM OPENJSON(@resultados) WITH (clave NVARCHAR(40) '$.clave', valor NVARCHAR(100) '$.valor');
        IF EXISTS (SELECT 1 FROM @r r WHERE NOT EXISTS (
            SELECT 1 FROM OPENJSON(@param) WITH (clave NVARCHAR(20) '$.clave') p WHERE p.clave = r.clave))
        BEGIN ROLLBACK; RAISERROR('Un resultado no corresponde a ningún parámetro del estudio.', 16, 1); RETURN; END
        IF NOT EXISTS (SELECT 1 FROM @r WHERE valor IS NOT NULL)
        BEGIN ROLLBACK; RAISERROR('Captura al menos un resultado.', 16, 1); RETURN; END

        SET @final = (
            SELECT p.clave, r.valor,
                   CASE WHEN TRY_CONVERT(DECIMAL(18,4), r.valor) IS NULL THEN NULL
                        WHEN p.mx IS NOT NULL AND TRY_CONVERT(DECIMAL(18,4), r.valor) > p.mx THEN N'A'
                        WHEN p.mn IS NOT NULL AND TRY_CONVERT(DECIMAL(18,4), r.valor) < p.mn THEN N'B'
                   END AS bandera
              FROM OPENJSON(@param) WITH (clave NVARCHAR(20) '$.clave', mn DECIMAL(18,4) '$.min', mx DECIMAL(18,4) '$.max') p
              JOIN @r r ON r.clave = p.clave
             WHERE r.valor IS NOT NULL
               FOR JSON PATH, INCLUDE_NULL_VALUES);
        SET @hallazgos = NULL; SET @birads = NULL;
    END
    ELSE
    BEGIN
        IF @hallazgos IS NULL AND @conclusion IS NULL
        BEGIN ROLLBACK; RAISERROR('Escribe los hallazgos o la conclusión.', 16, 1); RETURN; END
        IF @modalidad <> N'MASTOGRAFIA' SET @birads = NULL;
        IF @modalidad = N'MASTOGRAFIA' AND @birads IS NULL
        BEGIN ROLLBACK; RAISERROR('La mastografía lleva su categoría BI-RADS (0 a 6).', 16, 1); RETURN; END
        IF @birads > 6 BEGIN ROLLBACK; RAISERROR('BI-RADS va de 0 a 6.', 16, 1); RETURN; END
    END

    UPDATE dbo.salud_estudio_items
       SET resultados = @final, hallazgos = @hallazgos, conclusion = @conclusion, birads = @birads,
           estado = N'CAPTURADO', capturado_at = SYSDATETIME(), capturado_por = @user_id,
           tomado_at = ISNULL(tomado_at, SYSDATETIME()), tomado_por = ISNULL(tomado_por, @user_id)
     WHERE id = @item_id;
    COMMIT;

    SELECT id, estado, resultados FROM dbo.salud_estudio_items WHERE id = @item_id;
END
GO
