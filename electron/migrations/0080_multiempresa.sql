/* ============================================================
   0080 — multiempresa

   Generada con scripts/db/generar-migracion.mjs desde los archivos
   canonicos de sql/. No editar a mano: regenerar.

   Idempotente: todos los objetos usan CREATE OR ALTER, y los tipos
   comprueban su existencia antes de crearse. Se puede reejecutar.

   Incluye el bloque de esquema sql/schema/changes/0080_multiempresa.sql (tablas,
   columnas, seed). Cada paso de ese bloque comprueba su existencia.
   ============================================================ */

/* ========== ESQUEMA: sql/schema/changes/0080_multiempresa.sql ========== */
/* ============================================================
   0080 — MultiEmpresa (esquema)

   Varias empresas del mismo dueño, cada una en su propia base
   (docs/multiempresa.md).

   database_metadata('empresas_grupo')
                        el uuid del grupo. Sin la clave, la base no
                        pertenece a ningún grupo. No se crea aquí: la
                        escribe sp_empresas_grupo_fijar.

   empresas_grupo_bases las bases del grupo en ESTE servidor, incluida ella.
                        Cada miembro guarda la lista completa. Listar las
                        empresas lee solo esas bases (y comprueba que sigan
                        en el mismo grupo), nunca recorre todas las del
                        servidor: en SQL Express cada base cerrada tarda en
                        abrirse (AUTO_CLOSE) y una ajena con bloqueos
                        colgaría el selector.

   empresas_comandos    los cambios que pidió OTRA empresa del grupo desde
                        su computadora (Fase 3), con su resultado. Es la
                        bitácora y el candado de idempotencia: un comando
                        de la nube se aplica una sola vez aunque llegue dos.

   Aditiva: nada existente cambia.
   ============================================================ */

IF OBJECT_ID(N'dbo.empresas_grupo_bases', N'U') IS NULL
CREATE TABLE dbo.empresas_grupo_bases (
    base        SYSNAME      COLLATE DATABASE_DEFAULT NOT NULL CONSTRAINT PK_empresas_grupo_bases PRIMARY KEY CLUSTERED,
    agregada_en DATETIME2(0) NOT NULL CONSTRAINT DF_empresas_grupo_bases_agregada_en DEFAULT SYSDATETIME()
);
GO

IF OBJECT_ID(N'dbo.empresas_comandos', N'U') IS NULL
CREATE TABLE dbo.empresas_comandos (
    id              INT IDENTITY(1, 1) NOT NULL CONSTRAINT PK_empresas_comandos PRIMARY KEY CLUSTERED,
    comando_id      UNIQUEIDENTIFIER NOT NULL,
    tipo            NVARCHAR(30)  COLLATE Modern_Spanish_CI_AS NOT NULL,
    origen_empresa  NVARCHAR(200) COLLATE Modern_Spanish_CI_AS NOT NULL,
    origen_usuario  NVARCHAR(50)  COLLATE Modern_Spanish_CI_AS NULL,
    payload         NVARCHAR(MAX) COLLATE Modern_Spanish_CI_AS NOT NULL,
    resultado       NVARCHAR(10)  COLLATE Modern_Spanish_CI_AS NOT NULL,
    detalle         NVARCHAR(400) COLLATE Modern_Spanish_CI_AS NULL,
    product_id      INT NULL,
    aplicado_en     DATETIME2(0)  NOT NULL CONSTRAINT DF_empresas_comandos_aplicado_en DEFAULT SYSDATETIME(),
    CONSTRAINT UX_empresas_comandos_comando UNIQUE (comando_id),
    CONSTRAINT CK_empresas_comandos_resultado CHECK (resultado IN (N'APLICADO', N'RECHAZADO')),
    CONSTRAINT CK_empresas_comandos_tipo CHECK (tipo IN (N'PRODUCTO_ALTA', N'PRODUCTO_PRECIO'))
);
GO

/* ---------- sp_empresas_comando_aplicar (SQL_STORED_PROCEDURE) ---------- */
/* sp_empresas_comando_aplicar
 * Definicion canonica. Mantener este archivo y generar una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* ==================== sp_empresas_comando_aplicar (0080) ==================
   Aplica en ESTA empresa un cambio que pidio otra empresa del grupo desde
   su computadora (docs/multiempresa.md, Fase 3). La nube solo lo trajo:
   aqui se decide con las reglas de esta empresa.

   UNA SOLA VEZ. La nube entrega "al menos una vez"; si el comando ya se
   aplico (o se rechazo), se devuelve lo mismo sin tocar nada.

   PRODUCTO_PRECIO  { product_uuid, precio }
                    Un producto de la matriz (MultiSucursal) conserva su
                    candado: sin permiso de precios por sucursal, se rechaza.
   PRODUCTO_ALTA    { nombre, precio, codigo?, categoria? }
                    Sin inventario (inventory_mode NONE): se vende desde ya
                    y quien opera esta empresa decide despues si lleva
                    existencias. Respeta "esta sucursal no da de alta
                    productos" de MultiSucursal.

   Recordset: resultado (APLICADO | RECHAZADO), detalle, product_id.
   ======================================================================= */
CREATE OR ALTER PROCEDURE dbo.sp_empresas_comando_aplicar
    @comando_id     UNIQUEIDENTIFIER,
    @tipo           NVARCHAR(30),
    @origen_empresa NVARCHAR(200),
    @origen_usuario NVARCHAR(50) = NULL,
    @payload        NVARCHAR(MAX)
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    IF EXISTS (SELECT 1 FROM dbo.empresas_comandos WHERE comando_id = @comando_id)
    BEGIN
        SELECT resultado, detalle, product_id FROM dbo.empresas_comandos WHERE comando_id = @comando_id;
        RETURN;
    END

    DECLARE @resultado NVARCHAR(10) = N'RECHAZADO', @detalle NVARCHAR(400) = NULL, @product_id INT = NULL;
    DECLARE @precio DECIMAL(10, 2) = NULL;   -- se lee dentro del TRY: el pedido puede no ser JSON
    DECLARE @reglas NVARCHAR(255) = (SELECT valor FROM dbo.database_metadata WHERE clave = N'multi_reglas');
    DECLARE @es_sucursal BIT = CASE WHEN EXISTS (SELECT 1 FROM dbo.database_metadata
                                                  WHERE clave = N'multi_version' AND valor <> N'') THEN 1 ELSE 0 END;

    BEGIN TRY
        IF ISJSON(@payload) = 1 AND LEFT(LTRIM(@payload), 1) = N'{'
            SET @precio = TRY_CONVERT(DECIMAL(10, 2), JSON_VALUE(@payload, '$.precio'));

        IF @precio IS NULL OR @precio < 0
            SET @detalle = N'El pedido no trae un precio válido.';

        ELSE IF @tipo = N'PRODUCTO_PRECIO'
        BEGIN
            DECLARE @uuid UNIQUEIDENTIFIER = TRY_CONVERT(UNIQUEIDENTIFIER, JSON_VALUE(@payload, '$.product_uuid'));
            DECLARE @corporativo BIT;
            SELECT @product_id = id, @corporativo = corporate FROM dbo.products WHERE uuid = @uuid AND ISNULL(active, 1) = 1;

            IF @product_id IS NULL
                SET @detalle = N'El producto ya no existe en esta empresa.';
            ELSE IF @corporativo = 1 AND ISNULL(TRY_CONVERT(BIT, JSON_VALUE(@reglas, '$.precios_sucursal')), 0) = 0
            BEGIN
                SET @detalle = N'Ese producto lo administra la matriz: su precio se cambia allá.';
                SET @product_id = NULL;
            END
            ELSE
            BEGIN
                UPDATE dbo.products SET price = @precio WHERE id = @product_id;
                SELECT @resultado = N'APLICADO', @detalle = CONCAT(N'Precio actualizado a $', FORMAT(@precio, 'N2', 'es-MX'), N'.');
            END
        END

        ELSE IF @tipo = N'PRODUCTO_ALTA'
        BEGIN
            DECLARE @nombre NVARCHAR(100) = LEFT(LTRIM(RTRIM(JSON_VALUE(@payload, '$.nombre'))), 100);
            DECLARE @codigo NVARCHAR(100) = NULLIF(LEFT(LTRIM(RTRIM(JSON_VALUE(@payload, '$.codigo'))), 100), N'');
            DECLARE @categoria NVARCHAR(100) = ISNULL(NULLIF(LEFT(LTRIM(RTRIM(JSON_VALUE(@payload, '$.categoria'))), 100), N''), N'General');

            IF @es_sucursal = 1 AND ISNULL(TRY_CONVERT(BIT, JSON_VALUE(@reglas, '$.productos_locales')), 1) = 0
                SET @detalle = N'En esta sucursal los productos los da de alta la matriz.';
            ELSE IF LEN(ISNULL(@nombre, N'')) < 2
                SET @detalle = N'El producto necesita un nombre.';
            ELSE IF EXISTS (SELECT 1 FROM dbo.products WHERE nombre = @nombre AND ISNULL(active, 1) = 1)
                SET @detalle = N'Ya hay un producto con ese nombre.';
            ELSE IF @codigo IS NOT NULL AND EXISTS (SELECT 1 FROM dbo.products WHERE part_number = @codigo)
                SET @detalle = N'Ya hay un producto con ese código.';
            ELSE
            BEGIN
                BEGIN TRAN;
                    IF NOT EXISTS (SELECT 1 FROM dbo.CAT_categories WHERE namee = @categoria)
                        INSERT INTO dbo.CAT_categories (namee) VALUES (@categoria);
                    IF NOT EXISTS (SELECT 1 FROM dbo.CAT_brands WHERE namee = N'Genérica')
                        INSERT INTO dbo.CAT_brands (namee) VALUES (N'Genérica');

                    DECLARE @cat INT = (SELECT id FROM dbo.CAT_categories WHERE namee = @categoria);
                    DECLARE @marca INT = (SELECT id FROM dbo.CAT_brands WHERE namee = N'Genérica');
                    IF @codigo IS NULL SET @codigo = CONCAT(N'G-', UPPER(LEFT(REPLACE(CONVERT(NVARCHAR(36), @comando_id), N'-', N''), 8)));

                    DECLARE @alta TABLE (id DECIMAL(18, 0));
                    INSERT INTO @alta (id)
                    EXEC dbo.sp_add_product @brand = @marca, @part_number = @codigo, @name = @nombre, @price = @precio,
                         @stock = 0, @category = @cat, @inventory_mode = N'NONE';
                    SET @product_id = (SELECT TOP (1) CONVERT(INT, id) FROM @alta);
                COMMIT;
                IF @product_id IS NULL
                    SET @detalle = N'No se pudo dar de alta el producto.';
                ELSE
                    SELECT @resultado = N'APLICADO', @detalle = CONCAT(N'Producto dado de alta (', @codigo, N').');
            END
        END

        ELSE
            SET @detalle = N'Esta empresa no acepta ese tipo de cambio.';
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK;
        SELECT @resultado = N'RECHAZADO', @product_id = NULL, @detalle = LEFT(ERROR_MESSAGE(), 400);
    END CATCH;

    INSERT INTO dbo.empresas_comandos (comando_id, tipo, origen_empresa, origen_usuario, payload, resultado, detalle, product_id)
    VALUES (@comando_id,
            CASE WHEN @tipo IN (N'PRODUCTO_ALTA', N'PRODUCTO_PRECIO') THEN @tipo ELSE N'PRODUCTO_ALTA' END,
            LEFT(ISNULL(@origen_empresa, N'Otra empresa'), 200), LEFT(@origen_usuario, 50), @payload,
            @resultado, @detalle, @product_id);

    SELECT @resultado AS resultado, @detalle AS detalle, @product_id AS product_id;
END;
GO

/* ---------- sp_empresas_grupo (SQL_STORED_PROCEDURE) ---------- */
/* sp_empresas_grupo
 * Definicion canonica. Mantener este archivo y generar una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* ========================= sp_empresas_grupo (0080) =======================
   Esta empresa: su base, su nombre y el grupo al que pertenece (NULL si a
   ninguno). Segundo recordset: las bases del grupo en este servidor.
   docs/multiempresa.md.
   ======================================================================= */
CREATE OR ALTER PROCEDURE dbo.sp_empresas_grupo
AS
BEGIN
    SET NOCOUNT ON;

    SELECT DB_NAME() AS base,
           (SELECT TOP (1) business_name    FROM dbo.business_config ORDER BY id) AS nombre,
           (SELECT TOP (1) business_profile FROM dbo.business_config ORDER BY id) AS giro,
           TRY_CONVERT(UNIQUEIDENTIFIER,
               (SELECT valor FROM dbo.database_metadata WHERE clave = N'empresas_grupo')) AS grupo,
           TRY_CONVERT(UNIQUEIDENTIFIER,
               (SELECT valor FROM dbo.database_metadata WHERE clave = N'instance_uuid')) AS instance_uuid;

    /* Las bases del grupo que esta base conoce (ella incluida si tiene grupo). */
    SELECT base FROM dbo.empresas_grupo_bases ORDER BY base;
END;
GO

/* ---------- sp_empresas_grupo_fijar (SQL_STORED_PROCEDURE) ---------- */
/* sp_empresas_grupo_fijar
 * Definicion canonica. Mantener este archivo y generar una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* ====================== sp_empresas_grupo_fijar (0080) ====================
   Mete esta base en un grupo de empresas, o la saca (@grupo NULL).

   @bases   arreglo JSON con las bases del grupo en este servidor. Se guarda
            tal cual (siempre con esta base incluida): cada miembro tiene la
            lista completa, y quien la cambia la escribe en todos.

   Sacarla no borra nada: la empresa sigue operando sola, igual que antes
   de unirse. Cada base solo se escribe a si misma.
   ======================================================================= */
CREATE OR ALTER PROCEDURE dbo.sp_empresas_grupo_fijar
    @grupo UNIQUEIDENTIFIER = NULL,
    @bases NVARCHAR(MAX)    = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    IF @bases IS NOT NULL AND ISJSON(@bases) <> 1
        THROW 51000, N'La lista de empresas no es valida.', 1;

    BEGIN TRAN;
        DELETE FROM dbo.empresas_grupo_bases;

        IF @grupo IS NULL
            DELETE FROM dbo.database_metadata WHERE clave = N'empresas_grupo';
        ELSE
        BEGIN
            DECLARE @valor NVARCHAR(255) = LOWER(CONVERT(NVARCHAR(36), @grupo));
            UPDATE dbo.database_metadata
               SET valor = @valor, actualizado_en = SYSDATETIME()
             WHERE clave = N'empresas_grupo';
            IF @@ROWCOUNT = 0
                INSERT INTO dbo.database_metadata (clave, valor) VALUES (N'empresas_grupo', @valor);

            INSERT INTO dbo.empresas_grupo_bases (base)
            SELECT CONVERT(SYSNAME, j.value)
              FROM OPENJSON(ISNULL(@bases, N'[]')) j
             WHERE LEN(LTRIM(RTRIM(j.value))) > 0
            UNION
            SELECT DB_NAME();
        END
    COMMIT;
END;
GO

/* ---------- sp_empresas_locales (SQL_STORED_PROCEDURE) ---------- */
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

/* ---------- sp_empresas_resumen (SQL_STORED_PROCEDURE) ---------- */
/* sp_empresas_resumen
 * Definicion canonica. Mantener este archivo y generar una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* ======================== sp_empresas_resumen (0080) ======================
   Lo que "Mis empresas" ensena de ESTA empresa en un periodo. Cada base
   responde la suya; el proceso principal las pone lado a lado.

   ventas, tickets   lo cobrado (sales.total) y cuantas ventas.
   utilidad          la misma cuenta que Reportes (sp_get_profit_overview):
                     venta sin IVA menos costo, menos lo que descuentan las
                     plataformas. El numero coincide con el que el dueno ve
                     dentro de la empresa.
   turnos_abiertos   turnos sin cerrar ahora mismo.
   efectivo_en_caja  lo que deberia haber en los cajones de esos turnos:
                     fondo inicial + movimientos (la regla de sp_close_shift).
   ultima_venta      la mas reciente, de cualquier fecha.
   ======================================================================= */
CREATE OR ALTER PROCEDURE dbo.sp_empresas_resumen
    @desde DATE = NULL,
    @hasta DATE = NULL
AS
BEGIN
    SET NOCOUNT ON;

    IF @desde IS NULL SET @desde = CAST(GETDATE() AS DATE);
    IF @hasta IS NULL SET @hasta = @desde;
    IF @hasta < @desde SET @hasta = @desde;

    DECLARE @utilidad TABLE (datee DATE, profit DECIMAL(18, 4));
    INSERT INTO @utilidad (datee, profit)
    EXEC dbo.sp_get_profit_overview @from_date = @desde, @to_date = @hasta;

    DECLARE @abiertos TABLE (id INT PRIMARY KEY, register_id INT, opened_at DATETIME2(0), opening_cash DECIMAL(10, 2));
    INSERT INTO @abiertos (id, register_id, opened_at, opening_cash)
    SELECT id, register_id, opened_at, opening_cash FROM dbo.cash_closures WHERE closed_at IS NULL;

    SELECT
        CAST(ISNULL((SELECT SUM(s.total) FROM dbo.sales s
                      WHERE s.datee >= @desde AND s.datee < DATEADD(DAY, 1, @hasta)), 0) AS DECIMAL(18, 2)) AS ventas,
        (SELECT COUNT(*) FROM dbo.sales s
          WHERE s.datee >= @desde AND s.datee < DATEADD(DAY, 1, @hasta)) AS tickets,
        CAST(ISNULL((SELECT SUM(profit) FROM @utilidad), 0) AS DECIMAL(18, 2)) AS utilidad,
        (SELECT COUNT(*) FROM @abiertos) AS turnos_abiertos,
        CAST(ISNULL((SELECT SUM(opening_cash) FROM @abiertos), 0)
           + ISNULL((SELECT SUM(m.amount)
                       FROM dbo.cash_movements m
                      WHERE m.typee <> 'OPENING'
                        AND EXISTS (SELECT 1 FROM @abiertos a
                                     WHERE m.closure_id = a.id
                                        OR (m.closure_id IS NULL AND m.register_id = a.register_id
                                            AND m.datee >= a.opened_at))), 0) AS DECIMAL(18, 2)) AS efectivo_en_caja,
        (SELECT MAX(s.datee) FROM dbo.sales s) AS ultima_venta;
END;
GO
