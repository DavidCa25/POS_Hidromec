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
