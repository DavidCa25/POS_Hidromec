/* sp_salud_estudio_ficha_save
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* La ficha de un estudio del catálogo. El servicio (nombre, precio, IVA) lo
 * guarda sp_service_save en la misma transacción; aquí va lo clínico:
 * laboratorio o imagen, modalidad, preparación y los parámetros con sus
 * valores de referencia.
 *
 * @parametros: JSON [{ "clave": "GLU", "nombre": "Glucosa", "unidad": "mg/dL",
 *                      "min": 70, "max": 100, "texto": null }]
 */
CREATE OR ALTER PROCEDURE [dbo].[sp_salud_estudio_ficha_save]
    @product_id    INT,
    @tipo          NVARCHAR(10),
    @modalidad     NVARCHAR(20)  = NULL,
    @preparacion   NVARCHAR(400) = NULL,
    @muestra       NVARCHAR(60)  = NULL,
    @entrega_horas INT           = NULL,
    @parametros    NVARCHAR(MAX) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET @tipo = UPPER(LTRIM(RTRIM(ISNULL(@tipo, N''))));
    SET @modalidad = NULLIF(UPPER(LTRIM(RTRIM(@modalidad))), N'');
    SET @preparacion = NULLIF(LTRIM(RTRIM(@preparacion)), N'');
    SET @muestra = NULLIF(LTRIM(RTRIM(@muestra)), N'');

    IF NOT EXISTS (SELECT 1 FROM dbo.services WHERE product_id = @product_id)
    BEGIN RAISERROR('El estudio tiene que ser un servicio del catálogo.', 16, 1); RETURN; END
    IF @tipo NOT IN (N'LAB', N'IMAGEN')
    BEGIN RAISERROR('El estudio es de laboratorio o de imagen.', 16, 1); RETURN; END
    IF @tipo = N'LAB' SET @modalidad = NULL;
    IF @tipo = N'IMAGEN' AND ISNULL(@modalidad, N'') NOT IN (N'RX', N'MASTOGRAFIA', N'USG', N'TAC', N'RM', N'DENSITOMETRIA', N'OTRO')
    BEGIN RAISERROR('Elige la modalidad del estudio de imagen.', 16, 1); RETURN; END
    IF @tipo = N'IMAGEN' SET @parametros = NULL;

    IF @parametros IS NOT NULL
    BEGIN
        IF ISJSON(@parametros) = 0 BEGIN RAISERROR('Los parámetros no son válidos.', 16, 1); RETURN; END
        DECLARE @p TABLE (clave NVARCHAR(20), nombre NVARCHAR(100), unidad NVARCHAR(20), mn DECIMAL(18,4), mx DECIMAL(18,4), texto NVARCHAR(120));
        INSERT INTO @p
        SELECT NULLIF(LTRIM(RTRIM(clave)), N''), NULLIF(LTRIM(RTRIM(nombre)), N''), NULLIF(LTRIM(RTRIM(unidad)), N''),
               TRY_CONVERT(DECIMAL(18,4), mn), TRY_CONVERT(DECIMAL(18,4), mx), NULLIF(LTRIM(RTRIM(texto)), N'')
          FROM OPENJSON(@parametros)
          WITH (clave NVARCHAR(40) '$.clave', nombre NVARCHAR(200) '$.nombre', unidad NVARCHAR(40) '$.unidad',
                mn NVARCHAR(30) '$.min', mx NVARCHAR(30) '$.max', texto NVARCHAR(200) '$.texto');
        IF EXISTS (SELECT 1 FROM @p WHERE clave IS NULL OR nombre IS NULL)
        BEGIN RAISERROR('Cada parámetro necesita clave y nombre.', 16, 1); RETURN; END
        IF EXISTS (SELECT clave FROM @p GROUP BY clave HAVING COUNT(*) > 1)
        BEGIN RAISERROR('Hay dos parámetros con la misma clave.', 16, 1); RETURN; END
        IF EXISTS (SELECT 1 FROM @p WHERE mn IS NOT NULL AND mx IS NOT NULL AND mn > mx)
        BEGIN RAISERROR('El mínimo de referencia es mayor que el máximo.', 16, 1); RETURN; END
        /* Se guarda normalizado: lo que lee la captura es siempre lo mismo. */
        SET @parametros = (SELECT clave, nombre, unidad, mn AS [min], mx AS [max], texto FROM @p FOR JSON PATH, INCLUDE_NULL_VALUES);
    END
    IF @tipo = N'LAB' AND (@parametros IS NULL OR @parametros = N'[]')
    BEGIN RAISERROR('Un estudio de laboratorio necesita al menos un parámetro.', 16, 1); RETURN; END

    MERGE dbo.salud_estudios WITH (HOLDLOCK) AS t
    USING (SELECT @product_id AS product_id) AS s ON t.product_id = s.product_id
    WHEN MATCHED THEN UPDATE SET tipo = @tipo, modalidad = @modalidad, preparacion = @preparacion, muestra = @muestra,
         entrega_horas = @entrega_horas, parametros = @parametros, updated_at = SYSDATETIME()
    WHEN NOT MATCHED THEN INSERT (product_id, tipo, modalidad, preparacion, muestra, entrega_horas, parametros)
         VALUES (@product_id, @tipo, @modalidad, @preparacion, @muestra, @entrega_horas, @parametros);

    SELECT @product_id AS product_id;
END
GO
