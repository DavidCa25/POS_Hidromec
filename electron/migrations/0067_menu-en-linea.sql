/* ============================================================
   0067 — menu en linea

   Generada con scripts/db/generar-migracion.mjs desde los archivos
   canonicos de sql/. No editar a mano: regenerar.

   Idempotente: todos los objetos usan CREATE OR ALTER, y los tipos
   comprueban su existencia antes de crearse. Se puede reejecutar.

   Incluye el bloque de esquema sql/schema/changes/0067_menu-en-linea.sql (tablas,
   columnas, seed). Cada paso de ese bloque comprueba su existencia.
   ============================================================ */

/* ========== ESQUEMA: sql/schema/changes/0067_menu-en-linea.sql ========== */
/* ============================================================
   0067 — Menú en línea: pedidos para recoger (esquema)

   El cliente pide desde su celular (página del menú en la nube). El pedido
   NO es una venta ni una cuenta: es una SOLICITUD que espera a la caja.

   menu_en_linea_config   una fila (id = 1): si el negocio publica su menú,
                          si recibe pedidos, su dirección corta (slug), el
                          tiempo estimado y un mensaje. La lee la caja que
                          sincroniza con la nube; las demás la ven igual.

   pedidos_en_linea       la solicitud tal como llegó de la nube (uuid de la
                          nube, nombre, teléfono, líneas en JSON, total que vio
                          el cliente) y lo que decidió la caja:
                            PENDIENTE  llegó; nadie la ha visto
                            ACEPTADO   la caja la aceptó: tiene cuenta_id
                                       (número del día) y sus comandas
                            RECHAZADO  con motivo
                          Aceptar NO cobra ni descuenta inventario: abre una
                          cuenta sin mesa y manda a cocina, como una comanda
                          de mostrador. El cobro es al recoger, en Touch.

   estado_publicado       lo último que supo la nube (para no reenviarlo).

   Aditiva: nada existente cambia de significado.
   ============================================================ */
IF OBJECT_ID(N'dbo.menu_en_linea_config', 'U') IS NULL
BEGIN
CREATE TABLE dbo.menu_en_linea_config (
    id INT NOT NULL CONSTRAINT DF_menu_en_linea_config_id DEFAULT (1),
    activo BIT NOT NULL CONSTRAINT DF_menu_en_linea_config_activo DEFAULT (0),
    recibe_pedidos BIT NOT NULL CONSTRAINT DF_menu_en_linea_config_recibe DEFAULT (1),
    slug NVARCHAR(40) COLLATE Modern_Spanish_CI_AS NULL,
    minutos_estimados INT NOT NULL CONSTRAINT DF_menu_en_linea_config_min DEFAULT (15),
    mensaje NVARCHAR(200) COLLATE Modern_Spanish_CI_AS NULL,
    actualizado_en DATETIME2(0) NOT NULL CONSTRAINT DF_menu_en_linea_config_act DEFAULT (sysdatetime()),
    actualizado_por INT NULL,
    CONSTRAINT PK_menu_en_linea_config PRIMARY KEY CLUSTERED (id),
    CONSTRAINT CK_menu_en_linea_config_uno CHECK (id = 1),
    CONSTRAINT CK_menu_en_linea_config_min CHECK (minutos_estimados BETWEEN 1 AND 240)
);
END;
GO
IF NOT EXISTS (SELECT 1 FROM dbo.menu_en_linea_config WHERE id = 1)
    INSERT INTO dbo.menu_en_linea_config (id) VALUES (1);
GO
IF OBJECT_ID(N'dbo.pedidos_en_linea', 'U') IS NULL
BEGIN
CREATE TABLE dbo.pedidos_en_linea (
    id INT IDENTITY(1, 1) NOT NULL,
    uuid UNIQUEIDENTIFIER NOT NULL,
    origen NVARCHAR(12) COLLATE Modern_Spanish_CI_AS NULL,
    cliente_nombre NVARCHAR(60) COLLATE Modern_Spanish_CI_AS NOT NULL,
    cliente_telefono NVARCHAR(20) COLLATE Modern_Spanish_CI_AS NOT NULL,
    nota NVARCHAR(200) COLLATE Modern_Spanish_CI_AS NULL,
    lineas NVARCHAR(MAX) COLLATE Modern_Spanish_CI_AS NOT NULL,
    total_cliente DECIMAL(12, 2) NOT NULL,
    creado_en_nube DATETIME2(0) NULL,
    recibido_en DATETIME2(0) NOT NULL CONSTRAINT DF_pedidos_en_linea_recibido DEFAULT (sysdatetime()),
    estado NVARCHAR(12) COLLATE Modern_Spanish_CI_AS NOT NULL CONSTRAINT DF_pedidos_en_linea_estado DEFAULT ('PENDIENTE'),
    decidido_en DATETIME2(0) NULL,
    decidido_por INT NULL,
    motivo NVARCHAR(200) COLLATE Modern_Spanish_CI_AS NULL,
    cuenta_id INT NULL,
    estado_publicado NVARCHAR(12) COLLATE Modern_Spanish_CI_AS NULL,
    publicado_en DATETIME2(0) NULL,
    CONSTRAINT PK_pedidos_en_linea PRIMARY KEY CLUSTERED (id),
    CONSTRAINT CK_pedidos_en_linea_estado CHECK (estado IN ('PENDIENTE', 'ACEPTADO', 'RECHAZADO')),
    CONSTRAINT CK_pedidos_en_linea_json CHECK (ISJSON(lineas) = 1),
    CONSTRAINT CK_pedidos_en_linea_cuenta CHECK (estado <> 'ACEPTADO' OR cuenta_id IS NOT NULL),
    CONSTRAINT FK_pedidos_en_linea_cuenta FOREIGN KEY (cuenta_id) REFERENCES dbo.hosp_cuentas (id)
);
END;
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'UX_pedidos_en_linea_uuid' AND object_id = OBJECT_ID(N'dbo.pedidos_en_linea'))
    CREATE UNIQUE NONCLUSTERED INDEX UX_pedidos_en_linea_uuid ON dbo.pedidos_en_linea (uuid);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'UX_pedidos_en_linea_cuenta' AND object_id = OBJECT_ID(N'dbo.pedidos_en_linea'))
    CREATE UNIQUE NONCLUSTERED INDEX UX_pedidos_en_linea_cuenta ON dbo.pedidos_en_linea (cuenta_id) WHERE (cuenta_id IS NOT NULL);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_pedidos_en_linea_estado' AND object_id = OBJECT_ID(N'dbo.pedidos_en_linea'))
    CREATE NONCLUSTERED INDEX IX_pedidos_en_linea_estado ON dbo.pedidos_en_linea (estado, recibido_en);
GO

/* ---------- sp_menu_en_linea_config (SQL_STORED_PROCEDURE) ---------- */
/* sp_menu_en_linea_config
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* 0067 · La configuracion del menu en linea (una fila). Sin parametros la
   lee; con @guardar = 1 la cambia. El slug es la direccion corta del menu
   (wybix.mx/m/<slug>): minusculas, numeros y guiones; la nube decide si esta
   libre al publicar. */
CREATE OR ALTER PROCEDURE dbo.sp_menu_en_linea_config
    @guardar BIT = 0,
    @activo BIT = NULL,
    @recibe_pedidos BIT = NULL,
    @slug NVARCHAR(40) = NULL,
    @minutos_estimados INT = NULL,
    @mensaje NVARCHAR(200) = NULL,
    @user_id INT = NULL
AS
BEGIN
    SET NOCOUNT ON;
    IF NOT EXISTS (SELECT 1 FROM dbo.menu_en_linea_config WHERE id = 1)
        INSERT INTO dbo.menu_en_linea_config (id) VALUES (1);

    IF @guardar = 1
    BEGIN
        SET @slug = LOWER(NULLIF(LTRIM(RTRIM(@slug)), ''));
        IF @slug IS NOT NULL AND (LEN(@slug) < 3 OR @slug COLLATE Latin1_General_BIN LIKE '%[^a-z0-9-]%'
                                  OR LEFT(@slug, 1) = '-' OR RIGHT(@slug, 1) = '-')
        BEGIN RAISERROR('La dirección del menú lleva de 3 a 40 letras minúsculas, números o guiones.', 16, 1); RETURN; END
        IF ISNULL(@activo, 0) = 1 AND @slug IS NULL
        BEGIN RAISERROR('Elige la dirección del menú antes de publicarlo.', 16, 1); RETURN; END
        IF @minutos_estimados IS NOT NULL AND (@minutos_estimados < 1 OR @minutos_estimados > 240)
        BEGIN RAISERROR('El tiempo estimado va de 1 a 240 minutos.', 16, 1); RETURN; END

        UPDATE dbo.menu_en_linea_config
           SET activo = ISNULL(@activo, activo),
               recibe_pedidos = ISNULL(@recibe_pedidos, recibe_pedidos),
               slug = @slug,
               minutos_estimados = ISNULL(@minutos_estimados, minutos_estimados),
               mensaje = NULLIF(LTRIM(RTRIM(@mensaje)), ''),
               actualizado_en = SYSDATETIME(),
               actualizado_por = @user_id
         WHERE id = 1;
    END

    SELECT c.activo, c.recibe_pedidos, c.slug, c.minutos_estimados, c.mensaje, c.actualizado_en,
           (SELECT COUNT(*) FROM dbo.pedidos_en_linea WHERE estado = 'PENDIENTE') AS pendientes
      FROM dbo.menu_en_linea_config c WHERE c.id = 1;
END
GO

/* ---------- sp_pedido_en_linea_aceptar (SQL_STORED_PROCEDURE) ---------- */
/* sp_pedido_en_linea_aceptar
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* 0067 · ACEPTAR un pedido en linea: abre su cuenta sin mesa (con numero del
   dia y codigo de seguimiento) y lo deja ACEPTADO. Devuelve las lineas para
   que la caja las envie a preparacion con el MISMO canal que Touch y Venta
   (salon.js#enviarOrden -> sp_hosp_orden_enviar), cuyo `origen` por linea es
   el uuid de la linea: reintentar no duplica nada en cocina.

   No cobra ni descuenta inventario: eso pasa al cobrar la cuenta en Touch.

   Antes de abrir nada se comprueba que cada producto y cada opcion siguen a
   la venta: si no, el pedido sigue PENDIENTE y la caja decide (rechazarlo).

   La cuenta se abre aqui y no con sp_hosp_cuenta_abrir porque aquel devuelve
   su propio resultado (sp_hosp_cuenta_get) y aceptar debe ser UNA
   transaccion: el numero del dia sale con la misma regla (MAX + 1 del dia,
   bajo bloqueo). */
CREATE OR ALTER PROCEDURE dbo.sp_pedido_en_linea_aceptar
    @id INT,
    @user_id INT = NULL,
    @register_id INT = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;
    DECLARE @estado NVARCHAR(12), @lineas NVARCHAR(MAX), @nombre NVARCHAR(60), @cuenta INT, @numero INT,
            @ahora DATETIME2 = SYSDATETIME(), @etiqueta NVARCHAR(60);

    BEGIN TRAN;
    SELECT @estado = estado, @lineas = lineas, @nombre = cliente_nombre, @cuenta = cuenta_id
      FROM dbo.pedidos_en_linea WITH (UPDLOCK, HOLDLOCK) WHERE id = @id;
    IF @estado IS NULL BEGIN ROLLBACK TRAN; RAISERROR('El pedido no existe.', 16, 1); RETURN; END
    IF @estado = 'RECHAZADO' BEGIN ROLLBACK TRAN; RAISERROR('Este pedido ya se rechazó.', 16, 1); RETURN; END

    IF @estado = 'PENDIENTE'
    BEGIN
        IF EXISTS (SELECT 1 FROM OPENJSON(@lineas) WITH (product_id INT '$.product_id') l
                     LEFT JOIN dbo.products p ON p.id = l.product_id AND p.active = 1 AND p.sellable = 1
                    WHERE p.id IS NULL)
        BEGIN ROLLBACK TRAN; RAISERROR('Uno de los productos del pedido ya no está a la venta. Recházalo con ese motivo.', 16, 1); RETURN; END
        IF EXISTS (SELECT 1 FROM OPENJSON(@lineas) WITH (opciones NVARCHAR(MAX) '$.opciones' AS JSON) l
                    CROSS APPLY OPENJSON(l.opciones) WITH (option_id INT '$.option_id') o
                     LEFT JOIN dbo.modifier_options mo ON mo.id = o.option_id AND mo.active = 1
                    WHERE mo.id IS NULL)
        BEGIN ROLLBACK TRAN; RAISERROR('Una de las opciones del pedido ya no existe. Recházalo con ese motivo.', 16, 1); RETURN; END

        SELECT @numero = ISNULL(MAX(numero_dia), 0) + 1
          FROM dbo.hosp_cuentas WITH (UPDLOCK, HOLDLOCK)
         WHERE abierta_dia = CAST(@ahora AS DATE);
        /* La etiqueta la ven la caja y el KDS: de donde viene y quien recoge. */
        SET @etiqueta = LEFT(N'En línea · ' + LTRIM(RTRIM(@nombre)), 60);
        INSERT INTO dbo.hosp_cuentas (mesa_id, etiqueta, personas, abierta_por, register_id, abierta_en, numero_dia, seguimiento, customer_id)
        VALUES (NULL, @etiqueta, NULL, @user_id, @register_id, @ahora, @numero, CONVERT(CHAR(32), CRYPT_GEN_RANDOM(16), 2), NULL);
        SET @cuenta = SCOPE_IDENTITY();

        UPDATE dbo.pedidos_en_linea
           SET estado = 'ACEPTADO', cuenta_id = @cuenta, decidido_en = @ahora, decidido_por = @user_id
         WHERE id = @id;
    END
    COMMIT TRAN;

    /* ACEPTADO otra vez (reintento tras un fallo al enviar): mismas lineas,
       misma cuenta; sp_hosp_orden_enviar salta las que ya tiene. */
    SELECT p.id, p.uuid, p.cuenta_id, c.numero_dia, c.estado AS cuenta_estado
      FROM dbo.pedidos_en_linea p JOIN dbo.hosp_cuentas c ON c.id = p.cuenta_id
     WHERE p.id = @id;
    SELECT l.uuid AS origen, l.product_id, l.cantidad, l.nota, l.opciones
      FROM OPENJSON(@lineas) WITH (uuid UNIQUEIDENTIFIER '$.uuid', product_id INT '$.product_id',
                                   cantidad DECIMAL(12, 3) '$.cantidad', nota NVARCHAR(200) '$.nota',
                                   opciones NVARCHAR(MAX) '$.opciones' AS JSON) l;
END
GO

/* ---------- sp_pedido_en_linea_publicado (SQL_STORED_PROCEDURE) ---------- */
/* sp_pedido_en_linea_publicado
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* 0067 · La nube ya sabe este estado: no se vuelve a mandar. */
CREATE OR ALTER PROCEDURE dbo.sp_pedido_en_linea_publicado
    @uuid UNIQUEIDENTIFIER,
    @estado NVARCHAR(12)
AS
BEGIN
    SET NOCOUNT ON;
    UPDATE dbo.pedidos_en_linea SET estado_publicado = @estado, publicado_en = SYSDATETIME() WHERE uuid = @uuid;
    SELECT @@ROWCOUNT AS n;
END
GO

/* ---------- sp_pedido_en_linea_rechazar (SQL_STORED_PROCEDURE) ---------- */
/* sp_pedido_en_linea_rechazar
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* 0067 · RECHAZAR un pedido en linea, con motivo (el cliente lo ve).
   Solo un pedido PENDIENTE; uno aceptado se cancela como cualquier cuenta. */
CREATE OR ALTER PROCEDURE dbo.sp_pedido_en_linea_rechazar
    @id INT,
    @motivo NVARCHAR(200),
    @user_id INT = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET @motivo = NULLIF(LTRIM(RTRIM(@motivo)), '');
    IF @motivo IS NULL BEGIN RAISERROR('Escribe el motivo: el cliente lo va a ver.', 16, 1); RETURN; END
    UPDATE dbo.pedidos_en_linea
       SET estado = 'RECHAZADO', motivo = @motivo, decidido_en = SYSDATETIME(), decidido_por = @user_id
     WHERE id = @id AND estado = 'PENDIENTE';
    IF @@ROWCOUNT = 0
    BEGIN
        IF NOT EXISTS (SELECT 1 FROM dbo.pedidos_en_linea WHERE id = @id)
        BEGIN RAISERROR('El pedido no existe.', 16, 1); RETURN; END
        RAISERROR('Este pedido ya se aceptó o se rechazó.', 16, 1); RETURN;
    END
    SELECT id, estado, motivo FROM dbo.pedidos_en_linea WHERE id = @id;
END
GO

/* ---------- sp_pedido_en_linea_recibir (SQL_STORED_PROCEDURE) ---------- */
/* sp_pedido_en_linea_recibir
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* 0067 · Llega un pedido de la nube. Idempotente por uuid: bajarlo dos veces
   no lo duplica. Solo guarda la SOLICITUD; no abre cuenta, no cobra, no toca
   inventario. Devuelve id y si es nuevo (para avisar en la caja). */
CREATE OR ALTER PROCEDURE dbo.sp_pedido_en_linea_recibir
    @uuid UNIQUEIDENTIFIER,
    @origen NVARCHAR(12) = NULL,
    @cliente_nombre NVARCHAR(60),
    @cliente_telefono NVARCHAR(20),
    @nota NVARCHAR(200) = NULL,
    @lineas NVARCHAR(MAX),
    @total_cliente DECIMAL(12, 2),
    @creado_en_nube DATETIME2(0) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;
    IF @uuid IS NULL BEGIN RAISERROR('Falta el pedido.', 16, 1); RETURN; END
    IF ISJSON(@lineas) <> 1 OR NOT EXISTS (SELECT 1 FROM OPENJSON(@lineas))
    BEGIN RAISERROR('El pedido no trae productos.', 16, 1); RETURN; END
    IF LTRIM(RTRIM(ISNULL(@cliente_nombre, ''))) = '' OR LTRIM(RTRIM(ISNULL(@cliente_telefono, ''))) = ''
    BEGIN RAISERROR('El pedido no trae nombre o teléfono.', 16, 1); RETURN; END

    DECLARE @id INT, @nuevo BIT = 0;
    BEGIN TRAN;
    SELECT @id = id FROM dbo.pedidos_en_linea WITH (UPDLOCK, HOLDLOCK) WHERE uuid = @uuid;
    IF @id IS NULL
    BEGIN
        INSERT INTO dbo.pedidos_en_linea (uuid, origen, cliente_nombre, cliente_telefono, nota, lineas, total_cliente, creado_en_nube)
        VALUES (@uuid, UPPER(NULLIF(LTRIM(RTRIM(@origen)), '')), LTRIM(RTRIM(@cliente_nombre)), LTRIM(RTRIM(@cliente_telefono)),
                NULLIF(LTRIM(RTRIM(@nota)), ''), @lineas, @total_cliente, @creado_en_nube);
        SET @id = SCOPE_IDENTITY();
        SET @nuevo = 1;
    END
    COMMIT TRAN;
    SELECT @id AS id, @nuevo AS nuevo;
END
GO

/* ---------- sp_pedido_en_linea_revertir (SQL_STORED_PROCEDURE) ---------- */
/* sp_pedido_en_linea_revertir
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* 0067 · Deshacer una aceptacion que NO llego a cocina (fallo al enviar la
   orden): si la cuenta no tiene ninguna linea, se cancela y el pedido vuelve
   a PENDIENTE. Con lineas ya enviadas no se toca nada: se reintenta aceptar. */
CREATE OR ALTER PROCEDURE dbo.sp_pedido_en_linea_revertir
    @id INT,
    @user_id INT = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;
    DECLARE @cuenta INT;
    BEGIN TRAN;
    SELECT @cuenta = cuenta_id FROM dbo.pedidos_en_linea WITH (UPDLOCK, HOLDLOCK) WHERE id = @id AND estado = 'ACEPTADO';
    IF @cuenta IS NOT NULL AND NOT EXISTS (SELECT 1 FROM dbo.hosp_orden_lineas WHERE cuenta_id = @cuenta)
    BEGIN
        UPDATE dbo.pedidos_en_linea SET estado = 'PENDIENTE', cuenta_id = NULL, decidido_en = NULL, decidido_por = NULL WHERE id = @id;
        UPDATE dbo.hosp_cuentas SET estado = 'CANCELADA', cerrada_en = SYSDATETIME(), cerrada_por = @user_id WHERE id = @cuenta;
        COMMIT TRAN;
        SELECT CAST(1 AS BIT) AS revertido;
        RETURN;
    END
    COMMIT TRAN;
    SELECT CAST(0 AS BIT) AS revertido;
END
GO

/* ---------- sp_pedidos_en_linea_listar (SQL_STORED_PROCEDURE) ---------- */
/* sp_pedidos_en_linea_listar
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* 0067 · Los pedidos en linea y el estado que ve el cliente.

   estado_cliente se DERIVA de la cuenta y sus comandas (la misma regla que el
   seguimiento por QR), nunca se guarda a mano:
     RECIBIDO     esperando a la caja
     RECHAZADO    la caja no lo tomo (motivo)
     ACEPTADO     aceptado y sin nada en preparacion
     PREPARANDO   alguna comanda NUEVA o PREPARANDO
     LISTO        sus comandas estan listas
     ENTREGADO    se cobro (lo recogio) o se entregaron las comandas
     CANCELADO    la cuenta se cancelo

   @por_publicar = 1: solo los que cambiaron desde lo ultimo que supo la nube
   (de los ultimos dos dias). @id: uno solo. Sin filtros: los de hoy y los
   pendientes de cualquier dia, para la bandeja de la caja. */
CREATE OR ALTER PROCEDURE dbo.sp_pedidos_en_linea_listar
    @por_publicar BIT = 0,
    @id INT = NULL
AS
BEGIN
    SET NOCOUNT ON;
    ;WITH base AS (
        SELECT p.*, c.numero_dia, c.estado AS cuenta_estado,
               k.pendientes, k.listas, k.entregadas
          FROM dbo.pedidos_en_linea p
          LEFT JOIN dbo.hosp_cuentas c ON c.id = p.cuenta_id
          OUTER APPLY (SELECT SUM(CASE WHEN x.estado IN ('NUEVA', 'PREPARANDO') THEN 1 ELSE 0 END) AS pendientes,
                              SUM(CASE WHEN x.estado = 'LISTA' THEN 1 ELSE 0 END) AS listas,
                              SUM(CASE WHEN x.estado = 'ENTREGADA' THEN 1 ELSE 0 END) AS entregadas
                         FROM dbo.comandas x WHERE x.cuenta_id = p.cuenta_id AND x.estado <> 'CANCELADA') k
         WHERE (@id IS NULL OR p.id = @id)
    ), derivado AS (
        SELECT b.*,
               CASE
                 WHEN b.estado = 'PENDIENTE' THEN 'RECIBIDO'
                 WHEN b.estado = 'RECHAZADO' THEN 'RECHAZADO'
                 WHEN b.cuenta_estado = 'CANCELADA' THEN 'CANCELADO'
                 WHEN ISNULL(b.pendientes, 0) > 0 THEN 'PREPARANDO'
                 WHEN b.cuenta_estado = 'COBRADA' THEN 'ENTREGADO'
                 WHEN ISNULL(b.listas, 0) > 0 THEN 'LISTO'
                 WHEN ISNULL(b.entregadas, 0) > 0 THEN 'ENTREGADO'
                 ELSE 'ACEPTADO'
               END AS estado_cliente
          FROM base b
    )
    SELECT id, uuid, origen, cliente_nombre, cliente_telefono, nota, lineas, total_cliente,
           creado_en_nube, recibido_en, estado, decidido_en, decidido_por, motivo,
           cuenta_id, numero_dia, cuenta_estado, estado_cliente, estado_publicado,
           /* La espera se mide AQUI: las horas de la base son locales y el driver
              las entrega como si fueran UTC. */
           DATEDIFF(MINUTE, recibido_en, SYSDATETIME()) AS minutos_espera
      FROM derivado
     WHERE (@id IS NOT NULL)
        OR (@por_publicar = 1 AND estado_cliente <> ISNULL(estado_publicado, '') AND recibido_en >= DATEADD(DAY, -2, SYSDATETIME()))
        OR (@por_publicar = 0 AND (estado = 'PENDIENTE' OR recibido_en >= CAST(SYSDATETIME() AS DATE)))
     ORDER BY CASE WHEN estado = 'PENDIENTE' THEN 0 ELSE 1 END, recibido_en DESC;
END
GO
