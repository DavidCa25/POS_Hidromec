/* sp_socios_config_guardar
 * Definicion canonica. Mantener este archivo y generar una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* ===================== sp_socios_config_guardar (0079) ====================
   Las respuestas del asistente de Socios. @activar = 1 es la primera vez,
   desde Aplicaciones: guarda todo Y enciende el modulo en la MISMA
   transaccion. Con @activar = 0 cambia la configuracion de un modulo ya
   encendido. Un cambio aplica desde ese momento: lo ya repartido esta
   congelado.

   @json:
   {
     "regla": "A" | "B" | "C",  "pctVende": 30,
     "gastoRegla": "IGUALES" | "FIJO" | "VENTAS",
     "faltanteRegla": "VENTAS" | "IGUALES",
     "sinDueno": "<clave de socio>" | null,
     "liquidacion": "SEMANAL" | "MENSUAL",  "diaCierre": 7,
     "inicio": "2026-11-09",
     "socios": [ { "clave": "a", "id": 3, "nombre": "David", "userId": 2,
                   "pctFijo": 50, "activo": true }, ... ],
     "categorias": [ { "categoriaId": 4, "duenos": [ { "socio": "a", "pct": 100 } ] } ]
   }

   socios: los que vienen con id se actualizan; sin id se crean. Uno que no
   viene no se toca. Desactivar un socio le quita lo que era suyo (vuelve a
   "sin dueno"); su historia se queda.
   categorias: REEMPLAZA el dueno de todas las categorias. Una categoria que
   no viene queda sin dueno.

   Reglas: de 2 a 10 socios activos, nombres distintos, un usuario no es dos
   socios, cada categoria suma 100 %, y con gastos FIJO los % suman 100.
   ======================================================================= */
CREATE OR ALTER PROCEDURE dbo.sp_socios_config_guardar
    @json    NVARCHAR(MAX),
    @activar BIT = 0,
    @user_id INT = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    IF ISJSON(@json) <> 1 THROW 51000, N'Configuración inválida.', 1;
    IF ISNULL(@activar, 0) = 0
       AND NOT EXISTS (SELECT 1 FROM dbo.business_modules WHERE module_key = N'socios' AND enabled = 1)
        THROW 51000, N'Socios no está activado.', 1;

    DECLARE @regla CHAR(1) = UPPER(JSON_VALUE(@json, '$.regla')),
            @pct DECIMAL(5, 2) = TRY_CAST(JSON_VALUE(@json, '$.pctVende') AS DECIMAL(5, 2)),
            @gasto VARCHAR(8) = UPPER(JSON_VALUE(@json, '$.gastoRegla')),
            @falt VARCHAR(8) = UPPER(JSON_VALUE(@json, '$.faltanteRegla')),
            @sin NVARCHAR(40) = JSON_VALUE(@json, '$.sinDueno'),
            @liq VARCHAR(8) = UPPER(JSON_VALUE(@json, '$.liquidacion')),
            @dia TINYINT = TRY_CAST(JSON_VALUE(@json, '$.diaCierre') AS TINYINT),
            @inicio DATE = TRY_CAST(JSON_VALUE(@json, '$.inicio') AS DATE);

    IF @regla NOT IN ('A', 'B', 'C') THROW 51000, N'Elige cómo se reparte la ganancia.', 1;
    SET @pct = CASE @regla WHEN 'A' THEN 100 WHEN 'B' THEN 0 ELSE @pct END;
    IF @pct IS NULL OR @pct < 0 OR @pct > 100 THROW 51000, N'El porcentaje de quien vende va de 0 a 100.', 1;
    IF @gasto NOT IN ('IGUALES', 'FIJO', 'VENTAS') THROW 51000, N'Elige cómo se reparten los gastos comunes.', 1;
    IF ISNULL(@falt, '') NOT IN ('IGUALES', 'VENTAS') THROW 51000, N'Elige cómo se reparten los faltantes del corte.', 1;
    IF ISNULL(@liq, '') NOT IN ('SEMANAL', 'MENSUAL') THROW 51000, N'Elige cada cuánto se liquida.', 1;
    IF @liq = 'SEMANAL' AND (@dia IS NULL OR @dia NOT BETWEEN 1 AND 7) THROW 51000, N'Elige el día en que cierra la semana.', 1;
    IF @liq = 'MENSUAL' SET @dia = NULL;
    IF @inicio IS NULL THROW 51000, N'Indica desde cuándo se llevan las cuentas.', 1;

    CREATE TABLE #s (
        clave   NVARCHAR(40) COLLATE DATABASE_DEFAULT NOT NULL PRIMARY KEY,
        id      INT NULL,
        nombre  NVARCHAR(80) COLLATE DATABASE_DEFAULT NOT NULL,
        user_id INT NULL,
        pct     DECIMAL(7, 4) NULL,
        activo  BIT NOT NULL,
        orden   INT NOT NULL
    );
    INSERT INTO #s (clave, id, nombre, user_id, pct, activo, orden)
    SELECT LTRIM(RTRIM(j.clave)), j.id, LTRIM(RTRIM(j.nombre)), j.userId, j.pctFijo,
           ISNULL(j.activo, 1), ROW_NUMBER() OVER (ORDER BY (SELECT 1))
      FROM OPENJSON(@json, '$.socios') WITH (
             clave NVARCHAR(40), id INT, nombre NVARCHAR(80), userId INT,
             pctFijo DECIMAL(7, 4), activo BIT) j;

    IF EXISTS (SELECT 1 FROM #s WHERE LEN(nombre) = 0) THROW 51000, N'Cada socio necesita un nombre.', 1;
    IF EXISTS (SELECT nombre FROM #s GROUP BY nombre HAVING COUNT(*) > 1) THROW 51000, N'Dos socios no pueden llamarse igual.', 1;
    IF EXISTS (SELECT 1 FROM #s s JOIN dbo.socios x ON x.nombre = s.nombre
                WHERE ISNULL(s.id, 0) <> x.id AND NOT EXISTS (SELECT 1 FROM #s o WHERE o.id = x.id))
        THROW 51000, N'Ya hay un socio con ese nombre.', 1;
    IF EXISTS (SELECT user_id FROM #s WHERE user_id IS NOT NULL GROUP BY user_id HAVING COUNT(*) > 1)
        THROW 51000, N'Un usuario no puede ser dos socios.', 1;
    IF EXISTS (SELECT 1 FROM #s s WHERE s.user_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM dbo.users u WHERE u.id = s.user_id))
        THROW 51000, N'Ese usuario no existe.', 1;
    IF EXISTS (SELECT 1 FROM #s s WHERE s.id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM dbo.socios x WHERE x.id = s.id))
        THROW 51000, N'Ese socio no existe.', 1;

    /* Los activos al final: los de la tabla que no vienen siguen como estan. */
    DECLARE @activos INT =
        (SELECT COUNT(*) FROM #s WHERE activo = 1)
      + (SELECT COUNT(*) FROM dbo.socios x WHERE x.activo = 1 AND NOT EXISTS (SELECT 1 FROM #s s WHERE s.id = x.id));
    IF @activos < 2 THROW 51000, N'Hacen falta al menos 2 socios.', 1;
    IF @activos > 10 THROW 51000, N'Son 10 socios como máximo.', 1;
    IF @gasto = 'FIJO' AND ABS(ISNULL((SELECT SUM(pct) FROM #s WHERE activo = 1), 0)
                              + ISNULL((SELECT SUM(x.pct_fijo) FROM dbo.socios x WHERE x.activo = 1
                                         AND NOT EXISTS (SELECT 1 FROM #s s WHERE s.id = x.id)), 0) - 100) > 0.01
        THROW 51000, N'Con gastos en porcentaje fijo, los porcentajes de los socios deben sumar 100.', 1;

    CREATE TABLE #c (categoria_id INT NOT NULL, clave NVARCHAR(40) COLLATE DATABASE_DEFAULT NOT NULL, pct DECIMAL(7, 4) NOT NULL,
                     PRIMARY KEY (categoria_id, clave));
    INSERT INTO #c (categoria_id, clave, pct)
    SELECT c.categoriaId, LTRIM(RTRIM(d.socio)), SUM(d.pct)
      FROM OPENJSON(@json, '$.categorias') WITH (categoriaId INT, duenos NVARCHAR(MAX) AS JSON) c
     CROSS APPLY OPENJSON(c.duenos) WITH (socio NVARCHAR(40), pct DECIMAL(7, 4)) d
     WHERE d.pct > 0
     GROUP BY c.categoriaId, LTRIM(RTRIM(d.socio));
    IF EXISTS (SELECT 1 FROM #c c WHERE NOT EXISTS (SELECT 1 FROM #s s WHERE s.clave = c.clave AND s.activo = 1))
        THROW 51000, N'Una categoría es de un socio que no está en la lista.', 1;
    IF EXISTS (SELECT 1 FROM #c c WHERE NOT EXISTS (SELECT 1 FROM dbo.CAT_categories k WHERE k.id = c.categoria_id))
        THROW 51000, N'Esa categoría no existe.', 1;
    IF EXISTS (SELECT categoria_id FROM #c GROUP BY categoria_id HAVING ABS(SUM(pct) - 100) > 0.01)
        THROW 51000, N'Lo de cada categoría debe sumar 100 %.', 1;
    IF @sin IS NOT NULL AND NOT EXISTS (SELECT 1 FROM #s WHERE clave = @sin AND activo = 1)
        THROW 51000, N'El socio de los productos sin dueño no está en la lista.', 1;

    BEGIN TRAN;
        UPDATE x SET nombre = s.nombre, user_id = s.user_id, pct_fijo = s.pct, activo = s.activo, orden = s.orden
          FROM dbo.socios x JOIN #s s ON s.id = x.id;
        INSERT INTO dbo.socios (nombre, user_id, pct_fijo, activo, orden)
        SELECT nombre, user_id, pct, activo, orden FROM #s WHERE id IS NULL;
        UPDATE s SET id = x.id FROM #s s JOIN dbo.socios x ON x.nombre = s.nombre WHERE s.id IS NULL;

        /* Lo del socio que se desactiva vuelve a "sin dueno". */
        DELETE d FROM dbo.socios_duenos d JOIN dbo.socios x ON x.id = d.socio_id WHERE x.activo = 0;

        DELETE FROM dbo.socios_duenos WHERE entidad = 'CATEGORIA';
        INSERT INTO dbo.socios_duenos (entidad, entidad_id, socio_id, pct)
        SELECT 'CATEGORIA', c.categoria_id, s.id, c.pct FROM #c c JOIN #s s ON s.clave = c.clave;

        DECLARE @sin_id INT = (SELECT id FROM #s WHERE clave = @sin);

        MERGE dbo.socios_config AS d
        USING (SELECT CAST(1 AS TINYINT) AS id) AS s ON d.id = s.id
        WHEN MATCHED THEN UPDATE SET
            regla = @regla, pct_vende = @pct, gasto_regla = @gasto, faltante_regla = @falt,
            sin_dueno_socio_id = @sin_id, liquidacion = @liq, dia_cierre = @dia,
            /* El inicio no se mueve despues de una liquidacion: cambiaria lo cerrado. */
            inicio = CASE WHEN EXISTS (SELECT 1 FROM dbo.socios_liquidaciones) THEN d.inicio ELSE @inicio END,
            updated_at = SYSDATETIME(), updated_by = @user_id
        WHEN NOT MATCHED THEN INSERT
            (id, regla, pct_vende, gasto_regla, faltante_regla, sin_dueno_socio_id, liquidacion, dia_cierre,
             inicio, updated_at, updated_by)
            VALUES (1, @regla, @pct, @gasto, @falt, @sin_id, @liq, @dia, @inicio, SYSDATETIME(), @user_id);

        IF @activar = 1
        BEGIN
            DECLARE @r TABLE (module_key NVARCHAR(40), enabled BIT, enabled_at DATETIME2(0), enabled_by INT, updated_at DATETIME2(0));
            INSERT INTO @r EXEC dbo.sp_set_business_module @module_key = N'socios', @enabled = 1, @user_id = @user_id;
        END
    COMMIT;

    EXEC dbo.sp_socios_config_get;
END
GO
