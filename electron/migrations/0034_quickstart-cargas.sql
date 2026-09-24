/* ============================================================
   0034 — QuickStart: las cargas

   UNA CARGA ES UN OBJETO, NO UNA PANTALLA
   ---------------------------------------
   El importador anterior leia un archivo, validaba en el navegador y
   mandaba las filas buenas de un golpe. Todo lo que el usuario decidia
   -que hacer con un duplicado, que precio falta- vivia en memoria: cerrar
   la ventana lo borraba, y no habia forma de contestar «¿que entro ayer
   y quien lo metio?».

   Aqui una carga se guarda en la base desde el primer renglon leido. Eso
   es lo que permite las tres cosas que el importador viejo no podia:

     1. Capturar cuarenta productos de una libreta, cerrar Wybix y seguir
        manana donde se quedo.
     2. Resolver los problemas SIN tocar el catalogo, y confirmar despues.
     3. Deshacer, porque hay constancia de que hizo cada fila.

   NADA DE ESTO TOCA EL CATALOGO
   -----------------------------
   Estas tablas son un almacen intermedio. El catalogo real -products,
   inventory_movements- solo se escribe al confirmar, y por los caminos
   que ya existian. No hay un segundo libro mayor de inventario.
   ============================================================ */

/* ------------------------------------------------------------ batches */
IF OBJECT_ID(N'dbo.import_batches', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.import_batches (
        id INT IDENTITY(1,1) NOT NULL,

        /* De donde vino. Las cinco entradas terminan en la misma tuberia,
           pero conviene saber cual fue para el historial y para las
           estadisticas de uso. */
        origen NVARCHAR(12) NOT NULL,

        /* Como se llama para una persona: el nombre del archivo, o
           «Captura manual». Nunca una ruta del disco. */
        etiqueta NVARCHAR(200) NOT NULL,

        /* El giro Y el perfil en el MOMENTO de crear la carga. Si el
           negocio cambia de giro con una carga a medias, esa carga se
           sigue interpretando como se empezo: reinterpretarla en silencio
           cambiaria lo que el usuario ya reviso. */
        preset NVARCHAR(40) NULL,
        business_profile NVARCHAR(20) NULL,

        /* ANALIZANDO | REVISION | LISTA | IMPORTADA | DESCARTADA
           Cuatro son los que ve el usuario; DESCARTADA es la que el mismo
           tiro a la basura y se conserva para el historial. */
        estado NVARCHAR(12) NOT NULL CONSTRAINT DF_import_batches_estado DEFAULT ('ANALIZANDO'),

        user_id INT NULL,
        created_at DATETIME2(0) NOT NULL CONSTRAINT DF_import_batches_created DEFAULT (SYSDATETIME()),
        updated_at DATETIME2(0) NULL,
        completed_at DATETIME2(0) NULL,

        /* Totales, para no recontar filas cada vez que se pinta el riel. */
        total_filas INT NOT NULL CONSTRAINT DF_import_batches_total DEFAULT ((0)),
        creadas INT NOT NULL CONSTRAINT DF_import_batches_creadas DEFAULT ((0)),
        actualizadas INT NOT NULL CONSTRAINT DF_import_batches_actualizadas DEFAULT ((0)),
        sin_cambios INT NOT NULL CONSTRAINT DF_import_batches_sincambios DEFAULT ((0)),
        omitidas INT NOT NULL CONSTRAINT DF_import_batches_omitidas DEFAULT ((0)),

        /* Que columna del archivo es que campo de Wybix. Se guarda para
           poder repetir la carga y para crear un perfil despues. */
        mapping_json NVARCHAR(MAX) NULL,
        profile_id INT NULL,

        /* Lo que el archivo dijo de si mismo: hoja, numero de columnas,
           metadata de una plantilla nuestra. Diagnostico, no logica. */
        metadata_json NVARCHAR(MAX) NULL,

        CONSTRAINT PK_import_batches PRIMARY KEY CLUSTERED (id)
    );
END;
GO

IF OBJECT_ID(N'dbo.CK_import_batches_origen', 'C') IS NULL
ALTER TABLE dbo.import_batches WITH CHECK ADD CONSTRAINT CK_import_batches_origen
  CHECK (origen IN ('ARCHIVO','PEGADO','MANUAL','LECTOR','PLANTILLA'));
GO

IF OBJECT_ID(N'dbo.CK_import_batches_estado', 'C') IS NULL
ALTER TABLE dbo.import_batches WITH CHECK ADD CONSTRAINT CK_import_batches_estado
  CHECK (estado IN ('ANALIZANDO','REVISION','LISTA','IMPORTADA','DESCARTADA'));
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_import_batches_estado' AND object_id = OBJECT_ID(N'dbo.import_batches'))
CREATE NONCLUSTERED INDEX IX_import_batches_estado ON dbo.import_batches (estado, created_at DESC);
GO

/* --------------------------------------------------------------- filas */
IF OBJECT_ID(N'dbo.import_rows', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.import_rows (
        id INT IDENTITY(1,1) NOT NULL,
        batch_id INT NOT NULL,

        /* El numero de renglon EN EL ORIGEN, para poder decir «renglon 184»
           y que la persona lo encuentre en su Excel. */
        fila INT NOT NULL,

        /* Lo que decia el archivo, tal cual. Sirve para volver a normalizar
           si el mapeo cambia, y para enseñar el dato original cuando algo
           no cuadra. */
        crudo_json NVARCHAR(MAX) NULL,

        /* --- YA NORMALIZADO, en columnas de verdad ---
           Podria ser un JSON mas, pero entonces validar longitudes, buscar
           duplicados o contar cuantas filas no tienen precio obligaria a
           parsear cada fila en el cliente. En columnas, lo hace SQL. */
        tipo NVARCHAR(12) NOT NULL CONSTRAINT DF_import_rows_tipo DEFAULT ('PRODUCTO'),
        part_number NVARCHAR(100) NULL,
        nombre NVARCHAR(200) NULL,          -- 200 a proposito: ver CK abajo
        price DECIMAL(10,2) NULL,
        cost DECIMAL(14,4) NULL,
        stock DECIMAL(12,2) NULL,
        bar_code NVARCHAR(60) NULL,         -- 60 a proposito: ver CK abajo
        category_name NVARCHAR(150) NULL,
        brand_name NVARCHAR(150) NULL,
        base_uom NVARCHAR(10) NULL,
        clave_prod_serv NVARCHAR(8) NULL,
        clave_unidad NVARCHAR(5) NULL,
        tasa_iva DECIMAL(5,4) NULL,

        /* Solo para tipo = SERVICIO. */
        duration_minutes INT NULL,
        schedulable BIT NULL,
        default_commission_pct DECIMAL(5,2) NULL,

        /* CREATE | UPDATE | UNCHANGED | CONFLICT | OMITIR | PENDIENTE */
        accion NVARCHAR(12) NOT NULL CONSTRAINT DF_import_rows_accion DEFAULT ('PENDIENTE'),

        /* Con que producto del catalogo casa, si casa. */
        match_product_id INT NULL,
        match_motivo NVARCHAR(20) NULL,     -- SKU | BARCODE | NOMBRE

        /* Los problemas, como lista JSON: cada uno con codigo, campo y
           gravedad. Son datos para pintar, no para consultar. */
        problemas_json NVARCHAR(MAX) NULL,

        /* Lo que la persona decidio: ACTUALIZAR, CREAR_OTRO, IGNORAR... */
        resolucion NVARCHAR(20) NULL,

        /* --- lo que paso AL EJECUTAR --- */
        aplicada BIT NOT NULL CONSTRAINT DF_import_rows_aplicada DEFAULT ((0)),
        applied_product_id INT NULL,
        applied_at DATETIME2(0) NULL,

        /* El valor ANTERIOR de lo que se cambio. Sin esto, deshacer una
           actualizacion de precio es imposible: no habria a que volver. */
        previo_json NVARCHAR(MAX) NULL,

        CONSTRAINT PK_import_rows PRIMARY KEY CLUSTERED (id)
    );
END;
GO

IF OBJECT_ID(N'dbo.FK_import_rows_batch', 'F') IS NULL
ALTER TABLE dbo.import_rows WITH CHECK ADD CONSTRAINT FK_import_rows_batch
  FOREIGN KEY (batch_id) REFERENCES dbo.import_batches (id) ON DELETE CASCADE;
GO

IF OBJECT_ID(N'dbo.CK_import_rows_tipo', 'C') IS NULL
ALTER TABLE dbo.import_rows WITH CHECK ADD CONSTRAINT CK_import_rows_tipo
  CHECK (tipo IN ('PRODUCTO','SERVICIO','INGREDIENTE'));
GO

IF OBJECT_ID(N'dbo.CK_import_rows_accion', 'C') IS NULL
ALTER TABLE dbo.import_rows WITH CHECK ADD CONSTRAINT CK_import_rows_accion
  CHECK (accion IN ('CREATE','UPDATE','UNCHANGED','CONFLICT','OMITIR','PENDIENTE'));
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_import_rows_batch' AND object_id = OBJECT_ID(N'dbo.import_rows'))
CREATE NONCLUSTERED INDEX IX_import_rows_batch ON dbo.import_rows (batch_id, accion) INCLUDE (aplicada);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_import_rows_pn' AND object_id = OBJECT_ID(N'dbo.import_rows'))
CREATE NONCLUSTERED INDEX IX_import_rows_pn ON dbo.import_rows (batch_id, part_number);
GO

/* ------------------------------------------------------------ perfiles
   «Reconoci Lista Gonher». La huella son los encabezados normalizados y
   ordenados: si el proveedor manda el mismo Excel el mes que viene, las
   columnas coinciden aunque cambien de orden. */
IF OBJECT_ID(N'dbo.import_mappings', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.import_mappings (
        id INT IDENTITY(1,1) NOT NULL,
        nombre NVARCHAR(120) NOT NULL,
        huella NVARCHAR(200) NOT NULL,
        mapping_json NVARCHAR(MAX) NOT NULL,
        veces_usado INT NOT NULL CONSTRAINT DF_import_mappings_veces DEFAULT ((0)),
        created_at DATETIME2(0) NOT NULL CONSTRAINT DF_import_mappings_created DEFAULT (SYSDATETIME()),
        last_used_at DATETIME2(0) NULL,
        user_id INT NULL,
        CONSTRAINT PK_import_mappings PRIMARY KEY CLUSTERED (id),
        CONSTRAINT UQ_import_mappings_huella UNIQUE (huella)
    );
END;
GO

/* ============================================================
   LOS PROCEDIMIENTOS
   ============================================================ */

/* Abre una carga. Devuelve su id: a partir de aqui todo cuelga de el. */
CREATE OR ALTER PROCEDURE dbo.sp_import_batch_create
    @origen NVARCHAR(12),
    @etiqueta NVARCHAR(200),
    @preset NVARCHAR(40) = NULL,
    @business_profile NVARCHAR(20) = NULL,
    @user_id INT = NULL,
    @metadata_json NVARCHAR(MAX) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    INSERT INTO dbo.import_batches (origen, etiqueta, preset, business_profile, user_id, metadata_json, estado)
    VALUES (@origen, LEFT(LTRIM(RTRIM(@etiqueta)), 200), @preset, @business_profile, @user_id, @metadata_json, 'ANALIZANDO');

    DECLARE @id INT = SCOPE_IDENTITY();
    SELECT * FROM dbo.import_batches WHERE id = @id;
END
GO

/* El riel: las cargas vivas primero, el historial despues. */
CREATE OR ALTER PROCEDURE dbo.sp_import_batch_list
    @incluir_historial BIT = 1,
    @tope INT = 40
AS
BEGIN
    SET NOCOUNT ON;
    SELECT TOP (@tope)
        b.*,
        /* Lo que el riel necesita sin abrir la carga. */
        (SELECT COUNT(*) FROM dbo.import_rows r
          WHERE r.batch_id = b.id AND r.accion IN ('CONFLICT','PENDIENTE')) AS pendientes,
        (SELECT COUNT(*) FROM dbo.import_rows r
          WHERE r.batch_id = b.id AND r.accion IN ('CREATE','UPDATE') AND r.aplicada = 0) AS listas,
        u.usuario AS usuario
    FROM dbo.import_batches b
    LEFT JOIN dbo.users u ON u.id = b.user_id
    WHERE (@incluir_historial = 1 OR b.estado <> 'IMPORTADA')
      AND b.estado <> 'DESCARTADA'
    ORDER BY CASE WHEN b.estado = 'IMPORTADA' THEN 1 ELSE 0 END, b.created_at DESC;
END
GO

/* Las filas de una carga, con filtro por lo que se esta mirando. */
CREATE OR ALTER PROCEDURE dbo.sp_import_rows_get
    @batch_id INT,
    @filtro NVARCHAR(20) = NULL,   -- TODAS | LISTAS | PENDIENTES | CONFLICTOS
    @desde INT = 0,
    @tope INT = 200
AS
BEGIN
    SET NOCOUNT ON;
    SELECT r.*
    FROM dbo.import_rows r
    WHERE r.batch_id = @batch_id
      AND (@filtro IS NULL OR @filtro = 'TODAS'
           OR (@filtro = 'LISTAS'     AND r.accion IN ('CREATE','UPDATE'))
           OR (@filtro = 'PENDIENTES' AND r.accion IN ('CONFLICT','PENDIENTE'))
           OR (@filtro = 'CONFLICTOS' AND r.accion = 'CONFLICT'))
    ORDER BY r.fila
    OFFSET @desde ROWS FETCH NEXT @tope ROWS ONLY;
END
GO

/* El resumen que pinta la cabecera y los grupos de problemas. */
CREATE OR ALTER PROCEDURE dbo.sp_import_batch_summary
    @batch_id INT
AS
BEGIN
    SET NOCOUNT ON;

    SELECT * FROM dbo.import_batches WHERE id = @batch_id;

    SELECT
        SUM(CASE WHEN accion = 'CREATE'    THEN 1 ELSE 0 END) AS crear,
        SUM(CASE WHEN accion = 'UPDATE'    THEN 1 ELSE 0 END) AS actualizar,
        SUM(CASE WHEN accion = 'UNCHANGED' THEN 1 ELSE 0 END) AS igual,
        SUM(CASE WHEN accion = 'CONFLICT'  THEN 1 ELSE 0 END) AS conflicto,
        SUM(CASE WHEN accion = 'OMITIR'    THEN 1 ELSE 0 END) AS omitir,
        SUM(CASE WHEN aplicada = 1         THEN 1 ELSE 0 END) AS aplicadas,
        COUNT(*) AS total
    FROM dbo.import_rows WHERE batch_id = @batch_id;

    /* Los problemas agrupados POR CLASE: es la unidad de trabajo de la
       pantalla, asi que se cuenta aqui y no en el cliente. */
    SELECT codigo, COUNT(*) AS cuantos
    FROM dbo.import_rows r
    CROSS APPLY OPENJSON(ISNULL(r.problemas_json, '[]'))
         WITH (codigo NVARCHAR(40) '$.codigo') j
    WHERE r.batch_id = @batch_id AND r.aplicada = 0
    GROUP BY codigo
    ORDER BY cuantos DESC;
END
GO

/* Resolver un GRUPO entero. Es lo que hace que «asignar categoria a los
   10» sea un gesto y no diez.

   NO TOCA EL CATALOGO: escribe en el almacen intermedio y vuelve a
   clasificar la fila. El catalogo se escribe al confirmar. */
CREATE OR ALTER PROCEDURE dbo.sp_import_resolve_group
    @batch_id INT,
    @codigo NVARCHAR(40),          -- que clase de problema se resuelve
    @resolucion NVARCHAR(20),      -- ASIGNAR | ACTUALIZAR | CREAR_OTRO | IGNORAR | PONER_VALOR
    @valor NVARCHAR(200) = NULL    -- la categoria, el precio, lo que toque
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    DECLARE @afectadas TABLE (id INT);

    INSERT INTO @afectadas (id)
    SELECT r.id
    FROM dbo.import_rows r
    WHERE r.batch_id = @batch_id AND r.aplicada = 0
      AND EXISTS (SELECT 1 FROM OPENJSON(ISNULL(r.problemas_json,'[]'))
                   WITH (codigo NVARCHAR(40) '$.codigo') j WHERE j.codigo = @codigo);

    IF @resolucion = 'ASIGNAR' AND @codigo = 'SIN_CATEGORIA'
        UPDATE dbo.import_rows SET category_name = @valor
         WHERE id IN (SELECT id FROM @afectadas);

    IF @resolucion = 'PONER_VALOR' AND @codigo = 'SIN_PRECIO'
        UPDATE dbo.import_rows SET price = TRY_CONVERT(DECIMAL(10,2), @valor)
         WHERE id IN (SELECT id FROM @afectadas);

    IF @resolucion = 'ACTUALIZAR'
        UPDATE dbo.import_rows SET accion = 'UPDATE', resolucion = 'ACTUALIZAR'
         WHERE id IN (SELECT id FROM @afectadas) AND match_product_id IS NOT NULL;

    IF @resolucion = 'CREAR_OTRO'
        UPDATE dbo.import_rows SET accion = 'CREATE', resolucion = 'CREAR_OTRO', match_product_id = NULL
         WHERE id IN (SELECT id FROM @afectadas);

    IF @resolucion = 'IGNORAR'
        UPDATE dbo.import_rows SET accion = 'OMITIR', resolucion = 'IGNORAR'
         WHERE id IN (SELECT id FROM @afectadas);

    /* El problema resuelto desaparece de la lista de esa fila. Si era el
       ultimo y la fila tiene lo minimo, vuelve a ser importable. */
    UPDATE r
       SET problemas_json = (
             SELECT j.[value] FROM OPENJSON(ISNULL(r.problemas_json,'[]')) j
              WHERE JSON_VALUE(j.[value], '$.codigo') <> @codigo
              FOR JSON PATH)
      FROM dbo.import_rows r
     WHERE r.id IN (SELECT id FROM @afectadas);

    UPDATE dbo.import_rows
       SET problemas_json = '[]'
     WHERE id IN (SELECT id FROM @afectadas) AND problemas_json IS NULL;

    UPDATE dbo.import_rows
       SET accion = CASE WHEN match_product_id IS NULL THEN 'CREATE' ELSE 'UPDATE' END
     WHERE id IN (SELECT id FROM @afectadas)
       AND accion = 'PENDIENTE'
       AND ISNULL(problemas_json,'[]') IN ('[]','')
       AND nombre IS NOT NULL AND price IS NOT NULL;

    EXEC dbo.sp_import_batch_touch @batch_id = @batch_id;

    SELECT COUNT(*) AS resueltas FROM @afectadas;
END
GO

/* Recalcula el estado de la carga a partir de sus filas. Una sola
   definicion: si el estado se escribiera desde el cliente, dos pantallas
   acabarian discrepando. */
CREATE OR ALTER PROCEDURE dbo.sp_import_batch_touch
    @batch_id INT
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @total INT, @pend INT, @aplic INT;
    SELECT @total = COUNT(*),
           @pend  = SUM(CASE WHEN accion IN ('PENDIENTE','CONFLICT') THEN 1 ELSE 0 END),
           @aplic = SUM(CASE WHEN aplicada = 1 THEN 1 ELSE 0 END)
      FROM dbo.import_rows WHERE batch_id = @batch_id;

    UPDATE dbo.import_batches
       SET total_filas = ISNULL(@total, 0),
           updated_at = SYSDATETIME(),
           estado = CASE
               WHEN estado = 'DESCARTADA' THEN 'DESCARTADA'
               /* Importada solo cuando NO queda nada por hacer: si se
                  importaron 412 y quedan 16, la carga sigue viva. */
               WHEN @aplic > 0 AND ISNULL(@pend,0) = 0
                    AND NOT EXISTS (SELECT 1 FROM dbo.import_rows
                                     WHERE batch_id = @batch_id AND aplicada = 0
                                       AND accion IN ('CREATE','UPDATE'))
                    THEN 'IMPORTADA'
               WHEN ISNULL(@pend, 0) > 0 THEN 'REVISION'
               ELSE 'LISTA' END
     WHERE id = @batch_id;
END
GO

/* Descartar una carga. No borra: marca. El historial es historial. */
CREATE OR ALTER PROCEDURE dbo.sp_import_batch_discard
    @batch_id INT
AS
BEGIN
    SET NOCOUNT ON;
    UPDATE dbo.import_batches
       SET estado = 'DESCARTADA', updated_at = SYSDATETIME()
     WHERE id = @batch_id AND estado <> 'IMPORTADA';
    SELECT @@ROWCOUNT AS descartadas;
END
GO

/* ------------------------------------------------------- los perfiles */
CREATE OR ALTER PROCEDURE dbo.sp_import_mapping_find
    @huella NVARCHAR(200)
AS
BEGIN
    SET NOCOUNT ON;
    SELECT TOP 1 * FROM dbo.import_mappings WHERE huella = @huella;
END
GO

CREATE OR ALTER PROCEDURE dbo.sp_import_mapping_save
    @nombre NVARCHAR(120),
    @huella NVARCHAR(200),
    @mapping_json NVARCHAR(MAX),
    @user_id INT = NULL
AS
BEGIN
    SET NOCOUNT ON;
    MERGE dbo.import_mappings AS d
    USING (SELECT @huella AS huella) AS s ON d.huella = s.huella
    WHEN MATCHED THEN UPDATE SET
        nombre = @nombre, mapping_json = @mapping_json,
        veces_usado = veces_usado + 1, last_used_at = SYSDATETIME()
    WHEN NOT MATCHED THEN INSERT (nombre, huella, mapping_json, user_id, veces_usado, last_used_at)
        VALUES (@nombre, @huella, @mapping_json, @user_id, 1, SYSDATETIME());

    SELECT * FROM dbo.import_mappings WHERE huella = @huella;
END
GO
