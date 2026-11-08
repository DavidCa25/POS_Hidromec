/* sp_empresas_locales
 * Definicion canonica. Mantener este archivo y generar una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* ======================== sp_empresas_locales (0080) ======================
   Las empresas del grupo que viven en ESTE servidor. Siempre incluye a esta
   base, tenga grupo o no (es_esta = 1).

   SOLO SE MIRAN LAS BASES DEL GRUPO (dbo.empresas_grupo_bases), nunca todas
   las del servidor. En SQL Express cada base cerrada tarda en abrirse
   (AUTO_CLOSE) y una base ajena con bloqueos colgaria el selector: medido,
   recorrer veinte bases tardaba cuatro segundos y a veces no terminaba.

   Cada miembro de la lista se comprueba en su propia base: tiene que estar
   en linea, ser accesible para este login y seguir en el MISMO grupo. Una
   que salio del grupo, se borro o no responde en LOCK_TIMEOUT se salta; no
   tumba la lista.

   @usuario     si llega, user_id y rol son los de ese usuario ACTIVO en
                cada base (NULL si ahi no existe o esta inactivo). Con eso
                el selector solo ofrece las empresas donde esa persona
                puede entrar.

   Recordset: base, nombre, giro, user_id, rol, instance_uuid, es_esta.
   instance_uuid es su identidad en la nube: con ella no se muestra dos
   veces una empresa que es local y ademas esta en el grupo de la nube.
   ======================================================================= */
CREATE OR ALTER PROCEDURE dbo.sp_empresas_locales
    @usuario NVARCHAR(50) = NULL
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @grupo NVARCHAR(255) = (SELECT valor FROM dbo.database_metadata WHERE clave = N'empresas_grupo');

    CREATE TABLE #e (
        base          SYSNAME       COLLATE DATABASE_DEFAULT NOT NULL PRIMARY KEY,
        nombre        NVARCHAR(200) COLLATE DATABASE_DEFAULT NULL,
        giro          NVARCHAR(20)  COLLATE DATABASE_DEFAULT NULL,
        user_id       INT NULL,
        rol           NVARCHAR(50)  COLLATE DATABASE_DEFAULT NULL,
        instance_uuid NVARCHAR(255) COLLATE DATABASE_DEFAULT NULL
    );

    /* La misma consulta para cada base: responde de si misma, en su propio
       contexto (USE), y solo si sigue en el grupo pedido. */
    DECLARE @consulta NVARCHAR(MAX) = N'
        SET LOCK_TIMEOUT 3000;
        IF OBJECT_ID(N''dbo.database_metadata'', N''U'') IS NOT NULL
           AND OBJECT_ID(N''dbo.business_config'', N''U'') IS NOT NULL
           AND (@g IS NULL OR EXISTS (SELECT 1 FROM dbo.database_metadata
                                       WHERE clave = N''empresas_grupo'' AND valor = @g))
            SELECT DB_NAME(),
                   (SELECT TOP (1) business_name    FROM dbo.business_config ORDER BY id),
                   (SELECT TOP (1) business_profile FROM dbo.business_config ORDER BY id),
                   u.id, u.rol,
                   (SELECT LOWER(valor) FROM dbo.database_metadata WHERE clave = N''instance_uuid'')
              FROM (SELECT 1 AS x) AS uno
              LEFT JOIN dbo.users u ON u.usuario = @u AND u.active = 1;';

    DECLARE @bases TABLE (base SYSNAME COLLATE DATABASE_DEFAULT PRIMARY KEY);
    INSERT INTO @bases (base) VALUES (DB_NAME());
    IF @grupo IS NOT NULL
        INSERT INTO @bases (base)
        SELECT g.base FROM dbo.empresas_grupo_bases g
         WHERE g.base <> DB_NAME()
           AND EXISTS (SELECT 1 FROM sys.databases d
                        WHERE d.name = g.base COLLATE DATABASE_DEFAULT
                          AND d.state = 0 AND d.user_access = 0 AND HAS_DBACCESS(d.name) = 1);

    DECLARE @base SYSNAME, @lote NVARCHAR(MAX), @g NVARCHAR(255);
    DECLARE bases CURSOR LOCAL FAST_FORWARD FOR SELECT base FROM @bases;
    OPEN bases;
    FETCH NEXT FROM bases INTO @base;
    WHILE @@FETCH_STATUS = 0
    BEGIN
        SET @lote = N'USE ' + QUOTENAME(@base) + N';' + @consulta;
        /* Esta base responde siempre; las demas, solo si siguen en el grupo. */
        SET @g = CASE WHEN @base = DB_NAME() THEN NULL ELSE @grupo END;
        BEGIN TRY
            INSERT INTO #e (base, nombre, giro, user_id, rol, instance_uuid)
            EXEC sp_executesql @lote, N'@g NVARCHAR(255), @u NVARCHAR(50)', @g, @usuario;
        END TRY
        BEGIN CATCH
            /* Una base danada, en restauracion, bloqueada o sin permisos no
               es motivo para que el selector desaparezca. */
        END CATCH;
        FETCH NEXT FROM bases INTO @base;
    END
    CLOSE bases;
    DEALLOCATE bases;

    SELECT base, nombre, giro, user_id, rol, instance_uuid,
           CAST(CASE WHEN base = DB_NAME() THEN 1 ELSE 0 END AS BIT) AS es_esta
      FROM #e
     ORDER BY CASE WHEN base = DB_NAME() THEN 0 ELSE 1 END, nombre;
END;
GO
