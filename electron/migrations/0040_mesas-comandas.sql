/* ============================================================
   0040 — Mesas, cuentas, ordenes y comandas

   CINCO PALABRAS QUE NO SON LO MISMO
   ----------------------------------
     MESA     un lugar fisico. No se cobra: se ocupa y se libera.
     CUENTA   el consumo abierto que un dia se cobrara. Puede estar en una
              mesa o no (la barra, un «para llevar» que espera).
     ORDEN    lo que el cliente pidio en UN envio. Una cuenta recibe varias.
     COMANDA  las instrucciones de preparacion para UNA estacion. Una orden
              con un latte y un croissant genera dos: barra y cocina.
     VENTA    el cobro. Es la de siempre (`sales`), con su checkout de siempre.

   Enviar a cocina NO cobra: crea orden y comandas, no toca `sales` ni el
   inventario. Cobrar NO envia a cocina: lleva las lineas al carrito y pasa
   por `sp_register_sale`, que es el unico que descuenta inventario. La cuenta
   se enlaza a su venta despues, igual que una orden de servicio.

   LO QUE SE CONGELA Y LO QUE NO
   -----------------------------
   Nombre y precio base de cada linea se copian al ENVIAR: es lo que el
   cliente pidio, y cambiar el precio del menu a media comida no debe
   cambiar lo que ya se sirvio. Los precios y efectos de las opciones se leen
   de `modifier_options` en el servidor: la pantalla no decide precios.

   El estado de la mesa NO se guarda. Se deriva de si tiene una cuenta abierta:
   una columna «ocupada» mentiria en cuanto otra caja cobrara.

   Todo idempotente. Se puede reejecutar.
   ============================================================ */

/* --------------------------------------------------------------- SALON */
IF OBJECT_ID(N'dbo.salon_areas', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.salon_areas (
        id INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_salon_areas PRIMARY KEY,
        nombre NVARCHAR(60) NOT NULL,
        orden INT NOT NULL CONSTRAINT DF_salon_areas_orden DEFAULT ((0)),
        activa BIT NOT NULL CONSTRAINT DF_salon_areas_activa DEFAULT ((1)),
        creada_en DATETIME2 NOT NULL CONSTRAINT DF_salon_areas_creada DEFAULT (SYSDATETIME())
    );
    CREATE UNIQUE INDEX UX_salon_areas_nombre ON dbo.salon_areas(nombre) WHERE activa = 1;
END
GO

IF OBJECT_ID(N'dbo.salon_mesas', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.salon_mesas (
        id INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_salon_mesas PRIMARY KEY,
        area_id INT NOT NULL CONSTRAINT FK_salon_mesas_area REFERENCES dbo.salon_areas(id),
        nombre NVARCHAR(40) NOT NULL,
        capacidad INT NULL,
        orden INT NOT NULL CONSTRAINT DF_salon_mesas_orden DEFAULT ((0)),
        activa BIT NOT NULL CONSTRAINT DF_salon_mesas_activa DEFAULT ((1))
    );
    CREATE UNIQUE INDEX UX_salon_mesas_nombre ON dbo.salon_mesas(area_id, nombre) WHERE activa = 1;
END
GO

/* ----------------------------------------------------------- ESTACIONES
   Donde se prepara. No es solo «Cocina»: una cafeteria tiene barra, cocina
   y postres, y un bar tiene bebidas frias. Cada una decide como recibe sus
   comandas: en pantalla (KDS), en papel, o en las dos.

   La impresora es el nombre de Windows. Imprime la caja que ENVIA la
   comanda, asi que tiene que estar instalada ahi; si no lo esta, la comanda
   se crea igual y la pantalla lo avisa. */
IF OBJECT_ID(N'dbo.prep_stations', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.prep_stations (
        id INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_prep_stations PRIMARY KEY,
        nombre NVARCHAR(40) NOT NULL,
        salida NVARCHAR(10) NOT NULL CONSTRAINT DF_prep_stations_salida DEFAULT ('PANTALLA')
            CONSTRAINT CK_prep_stations_salida CHECK (salida IN ('PANTALLA', 'IMPRESORA', 'AMBOS')),
        impresora NVARCHAR(200) NULL,
        ancho_mm INT NULL,
        orden INT NOT NULL CONSTRAINT DF_prep_stations_orden DEFAULT ((0)),
        activa BIT NOT NULL CONSTRAINT DF_prep_stations_activa DEFAULT ((1))
    );
    CREATE UNIQUE INDEX UX_prep_stations_nombre ON dbo.prep_stations(nombre) WHERE activa = 1;
END
GO

/* Un producto se prepara en UNA estacion, o en ninguna: el agua embotellada
   no genera comanda. Tabla aparte y no columna en `products`: no toca las
   decenas de procedimientos que leen productos, y «sin fila» ya significa
   «no se prepara». */
IF OBJECT_ID(N'dbo.product_prep_station', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.product_prep_station (
        product_id INT NOT NULL CONSTRAINT PK_product_prep_station PRIMARY KEY
            CONSTRAINT FK_product_prep_station_product REFERENCES dbo.products(id),
        station_id INT NOT NULL CONSTRAINT FK_product_prep_station_station REFERENCES dbo.prep_stations(id),
        updated_at DATETIME2 NOT NULL CONSTRAINT DF_product_prep_station_upd DEFAULT (SYSDATETIME())
    );
END
GO

/* -------------------------------------------------------------- CUENTAS
   `mesa_id` admite NULL: una cuenta de barra no ocupa mesa. El indice unico
   filtrado es lo que impide que dos cajas abran a la vez dos cuentas en la
   misma mesa: SQL lo rechaza, no una comprobacion que dos cajas pudieran
   pasar al mismo tiempo. */
IF OBJECT_ID(N'dbo.hosp_cuentas', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.hosp_cuentas (
        id INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_hosp_cuentas PRIMARY KEY,
        mesa_id INT NULL CONSTRAINT FK_hosp_cuentas_mesa REFERENCES dbo.salon_mesas(id),
        etiqueta NVARCHAR(60) NULL,
        estado NVARCHAR(12) NOT NULL CONSTRAINT DF_hosp_cuentas_estado DEFAULT ('ABIERTA')
            CONSTRAINT CK_hosp_cuentas_estado CHECK (estado IN ('ABIERTA', 'POR_COBRAR', 'COBRADA', 'CANCELADA')),
        personas INT NULL,
        abierta_por INT NULL,
        abierta_en DATETIME2 NOT NULL CONSTRAINT DF_hosp_cuentas_abierta DEFAULT (SYSDATETIME()),
        cerrada_por INT NULL,
        cerrada_en DATETIME2 NULL,
        sale_id INT NULL CONSTRAINT FK_hosp_cuentas_sale REFERENCES dbo.sales(id),
        register_id INT NULL
    );
    CREATE UNIQUE INDEX UX_hosp_cuentas_mesa_abierta ON dbo.hosp_cuentas(mesa_id)
        WHERE mesa_id IS NOT NULL AND estado IN ('ABIERTA', 'POR_COBRAR');
    CREATE UNIQUE INDEX UX_hosp_cuentas_sale ON dbo.hosp_cuentas(sale_id) WHERE sale_id IS NOT NULL;
END
GO

/* -------------------------------------------------------------- ORDENES */
IF OBJECT_ID(N'dbo.hosp_ordenes', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.hosp_ordenes (
        id INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_hosp_ordenes PRIMARY KEY,
        cuenta_id INT NOT NULL CONSTRAINT FK_hosp_ordenes_cuenta REFERENCES dbo.hosp_cuentas(id),
        enviada_por INT NULL,
        enviada_en DATETIME2 NOT NULL CONSTRAINT DF_hosp_ordenes_enviada DEFAULT (SYSDATETIME())
    );
    CREATE INDEX IX_hosp_ordenes_cuenta ON dbo.hosp_ordenes(cuenta_id);
END
GO

/* ------------------------------------------------------------- COMANDAS
   El numero de comanda es su id: global y creciente, que es lo que la barra
   canta («la 105 esta lista»). Los tiempos de cada paso se guardan: son lo
   que despues responde «cuanto tarda la cocina a las dos de la tarde». */
IF OBJECT_ID(N'dbo.comandas', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.comandas (
        id INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_comandas PRIMARY KEY,
        orden_id INT NOT NULL CONSTRAINT FK_comandas_orden REFERENCES dbo.hosp_ordenes(id),
        cuenta_id INT NOT NULL CONSTRAINT FK_comandas_cuenta REFERENCES dbo.hosp_cuentas(id),
        station_id INT NOT NULL CONSTRAINT FK_comandas_station REFERENCES dbo.prep_stations(id),
        estado NVARCHAR(12) NOT NULL CONSTRAINT DF_comandas_estado DEFAULT ('NUEVA')
            CONSTRAINT CK_comandas_estado CHECK (estado IN ('NUEVA', 'PREPARANDO', 'LISTA', 'ENTREGADA', 'CANCELADA')),
        creada_en DATETIME2 NOT NULL CONSTRAINT DF_comandas_creada DEFAULT (SYSDATETIME()),
        empezada_en DATETIME2 NULL,
        lista_en DATETIME2 NULL,
        entregada_en DATETIME2 NULL,
        cancelada_en DATETIME2 NULL,
        cancelada_por INT NULL,
        motivo NVARCHAR(200) NULL
    );
    CREATE INDEX IX_comandas_estacion_estado ON dbo.comandas(station_id, estado);
    CREATE INDEX IX_comandas_cuenta ON dbo.comandas(cuenta_id);
END
GO

IF OBJECT_ID(N'dbo.hosp_orden_lineas', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.hosp_orden_lineas (
        id INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_hosp_orden_lineas PRIMARY KEY,
        orden_id INT NOT NULL CONSTRAINT FK_hosp_orden_lineas_orden REFERENCES dbo.hosp_ordenes(id),
        cuenta_id INT NOT NULL CONSTRAINT FK_hosp_orden_lineas_cuenta REFERENCES dbo.hosp_cuentas(id),
        product_id INT NOT NULL CONSTRAINT FK_hosp_orden_lineas_product REFERENCES dbo.products(id),
        nombre NVARCHAR(150) NOT NULL,
        cantidad DECIMAL(12, 3) NOT NULL CONSTRAINT CK_hosp_orden_lineas_cant CHECK (cantidad > 0),
        precio_unitario DECIMAL(10, 2) NOT NULL,
        nota NVARCHAR(200) NULL,
        station_id INT NULL CONSTRAINT FK_hosp_orden_lineas_station REFERENCES dbo.prep_stations(id),
        comanda_id INT NULL CONSTRAINT FK_hosp_orden_lineas_comanda REFERENCES dbo.comandas(id),
        estado NVARCHAR(10) NOT NULL CONSTRAINT DF_hosp_orden_lineas_estado DEFAULT ('ACTIVA')
            CONSTRAINT CK_hosp_orden_lineas_estado CHECK (estado IN ('ACTIVA', 'CANCELADA'))
    );
    CREATE INDEX IX_hosp_orden_lineas_cuenta ON dbo.hosp_orden_lineas(cuenta_id);
    CREATE INDEX IX_hosp_orden_lineas_comanda ON dbo.hosp_orden_lineas(comanda_id);
END
GO

/* Las opciones de cada linea, con su nombre y precio COPIADOS: la comanda
   dice «leche de avena» aunque manana alguien renombre la opcion. */
IF OBJECT_ID(N'dbo.hosp_orden_linea_opciones', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.hosp_orden_linea_opciones (
        id INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_hosp_orden_linea_opciones PRIMARY KEY,
        linea_id INT NOT NULL CONSTRAINT FK_hosp_olo_linea REFERENCES dbo.hosp_orden_lineas(id),
        modifier_option_id INT NOT NULL,
        group_id INT NULL,
        group_name NVARCHAR(80) NULL,
        option_name NVARCHAR(80) NOT NULL,
        price_delta DECIMAL(10, 2) NOT NULL CONSTRAINT DF_hosp_olo_delta DEFAULT ((0)),
        quantity INT NOT NULL CONSTRAINT DF_hosp_olo_qty DEFAULT ((1))
    );
    CREATE INDEX IX_hosp_olo_linea ON dbo.hosp_orden_linea_opciones(linea_id);
END
GO

/* ----------------------------------------------------------------- TIPOS */
IF TYPE_ID(N'dbo.HospOrdenLineaType') IS NULL
    CREATE TYPE dbo.HospOrdenLineaType AS TABLE (
        linea INT NOT NULL,
        product_id INT NOT NULL,
        cantidad DECIMAL(12, 3) NOT NULL,
        nota NVARCHAR(200) NULL
    );
GO

IF TYPE_ID(N'dbo.HospOrdenOpcionType') IS NULL
    CREATE TYPE dbo.HospOrdenOpcionType AS TABLE (
        linea INT NOT NULL,
        modifier_option_id INT NOT NULL,
        quantity INT NOT NULL
    );
GO

/* ======================================================================
   PROCEDIMIENTOS
   ====================================================================== */

/* El total de una cuenta: lineas activas, precio base mas sus opciones. */
CREATE OR ALTER PROCEDURE dbo.sp_salon_get
AS
BEGIN
    SET NOCOUNT ON;

    SELECT id, nombre, orden
      FROM dbo.salon_areas
     WHERE activa = 1
     ORDER BY orden, nombre;

    /* El estado visible son tres palabras: LIBRE, ABIERTA, POR_COBRAR. Lo
       demas -comandas en preparacion, listas por entregar- es contexto que
       ayuda al mesero, no un estado mas de la mesa. */
    SELECT m.id, m.area_id, m.nombre, m.capacidad, m.orden,
           c.id AS cuenta_id,
           CASE WHEN c.id IS NULL THEN 'LIBRE' ELSE c.estado END AS estado,
           c.abierta_en,
           DATEDIFF(MINUTE, c.abierta_en, SYSDATETIME()) AS minutos,
           ISNULL(t.total, 0) AS total,
           ISNULL(t.lineas, 0) AS lineas,
           ISNULL(k.pendientes, 0) AS comandas_pendientes,
           ISNULL(k.listas, 0) AS comandas_listas
      FROM dbo.salon_mesas m
      LEFT JOIN dbo.hosp_cuentas c
             ON c.mesa_id = m.id AND c.estado IN ('ABIERTA', 'POR_COBRAR')
      OUTER APPLY (
            SELECT SUM(l.cantidad * (l.precio_unitario + ISNULL(o.delta, 0))) AS total,
                   COUNT(*) AS lineas
              FROM dbo.hosp_orden_lineas l
              OUTER APPLY (SELECT SUM(x.price_delta * x.quantity) AS delta
                             FROM dbo.hosp_orden_linea_opciones x WHERE x.linea_id = l.id) o
             WHERE l.cuenta_id = c.id AND l.estado = 'ACTIVA') t
      OUTER APPLY (
            SELECT SUM(CASE WHEN x.estado IN ('NUEVA', 'PREPARANDO') THEN 1 ELSE 0 END) AS pendientes,
                   SUM(CASE WHEN x.estado = 'LISTA' THEN 1 ELSE 0 END) AS listas
              FROM dbo.comandas x WHERE x.cuenta_id = c.id) k
     WHERE m.activa = 1
     ORDER BY m.orden, m.nombre;
END
GO

CREATE OR ALTER PROCEDURE dbo.sp_salon_area_save
    @id INT = NULL,
    @nombre NVARCHAR(60),
    @orden INT = 0,
    @activa BIT = 1
AS
BEGIN
    SET NOCOUNT ON;
    SET @nombre = LTRIM(RTRIM(ISNULL(@nombre, '')));
    IF @nombre = '' BEGIN RAISERROR('El área necesita un nombre.', 16, 1); RETURN; END

    IF @activa = 0 AND EXISTS (
        SELECT 1 FROM dbo.salon_mesas m JOIN dbo.hosp_cuentas c ON c.mesa_id = m.id
         WHERE m.area_id = @id AND c.estado IN ('ABIERTA', 'POR_COBRAR'))
    BEGIN
        RAISERROR('Esta área tiene mesas con cuenta abierta: cóbralas antes de quitarla.', 16, 1); RETURN;
    END

    IF EXISTS (SELECT 1 FROM dbo.salon_areas WHERE nombre = @nombre AND activa = 1 AND id <> ISNULL(@id, 0)) AND @activa = 1
    BEGIN
        RAISERROR('Ya hay un área con ese nombre.', 16, 1); RETURN;
    END

    IF @id IS NULL
    BEGIN
        INSERT INTO dbo.salon_areas (nombre, orden, activa) VALUES (@nombre, ISNULL(@orden, 0), ISNULL(@activa, 1));
        SET @id = SCOPE_IDENTITY();
    END
    ELSE
    BEGIN
        UPDATE dbo.salon_areas SET nombre = @nombre, orden = ISNULL(@orden, orden), activa = ISNULL(@activa, activa)
         WHERE id = @id;
        IF @activa = 0 UPDATE dbo.salon_mesas SET activa = 0 WHERE area_id = @id;
    END

    SELECT id, nombre, orden, activa FROM dbo.salon_areas WHERE id = @id;
END
GO

CREATE OR ALTER PROCEDURE dbo.sp_salon_mesa_save
    @id INT = NULL,
    @area_id INT,
    @nombre NVARCHAR(40),
    @capacidad INT = NULL,
    @orden INT = 0,
    @activa BIT = 1
AS
BEGIN
    SET NOCOUNT ON;
    SET @nombre = LTRIM(RTRIM(ISNULL(@nombre, '')));
    IF @nombre = '' BEGIN RAISERROR('La mesa necesita un nombre.', 16, 1); RETURN; END
    IF NOT EXISTS (SELECT 1 FROM dbo.salon_areas WHERE id = @area_id AND activa = 1)
    BEGIN RAISERROR('El área no existe.', 16, 1); RETURN; END

    IF @activa = 0 AND EXISTS (SELECT 1 FROM dbo.hosp_cuentas WHERE mesa_id = @id AND estado IN ('ABIERTA', 'POR_COBRAR'))
    BEGIN
        RAISERROR('Esta mesa tiene una cuenta abierta: cóbrala antes de quitarla.', 16, 1); RETURN;
    END

    IF @activa = 1 AND EXISTS (SELECT 1 FROM dbo.salon_mesas
                                WHERE area_id = @area_id AND nombre = @nombre AND activa = 1 AND id <> ISNULL(@id, 0))
    BEGIN
        RAISERROR('Ya hay una mesa con ese nombre en esta área.', 16, 1); RETURN;
    END

    IF @id IS NULL
    BEGIN
        INSERT INTO dbo.salon_mesas (area_id, nombre, capacidad, orden, activa)
        VALUES (@area_id, @nombre, @capacidad, ISNULL(@orden, 0), ISNULL(@activa, 1));
        SET @id = SCOPE_IDENTITY();
    END
    ELSE
        UPDATE dbo.salon_mesas
           SET area_id = @area_id, nombre = @nombre, capacidad = @capacidad,
               orden = ISNULL(@orden, orden), activa = ISNULL(@activa, activa)
         WHERE id = @id;

    SELECT id, area_id, nombre, capacidad, orden, activa FROM dbo.salon_mesas WHERE id = @id;
END
GO

CREATE OR ALTER PROCEDURE dbo.sp_prep_stations_get
AS
BEGIN
    SET NOCOUNT ON;
    SELECT s.id, s.nombre, s.salida, s.impresora, s.ancho_mm, s.orden,
           (SELECT COUNT(*) FROM dbo.product_prep_station p WHERE p.station_id = s.id) AS productos
      FROM dbo.prep_stations s
     WHERE s.activa = 1
     ORDER BY s.orden, s.nombre;
END
GO

CREATE OR ALTER PROCEDURE dbo.sp_prep_station_save
    @id INT = NULL,
    @nombre NVARCHAR(40),
    @salida NVARCHAR(10) = 'PANTALLA',
    @impresora NVARCHAR(200) = NULL,
    @ancho_mm INT = NULL,
    @orden INT = 0,
    @activa BIT = 1
AS
BEGIN
    SET NOCOUNT ON;
    SET @nombre = LTRIM(RTRIM(ISNULL(@nombre, '')));
    SET @salida = UPPER(LTRIM(RTRIM(ISNULL(@salida, 'PANTALLA'))));
    SET @impresora = NULLIF(LTRIM(RTRIM(@impresora)), '');
    IF @nombre = '' BEGIN RAISERROR('La estación necesita un nombre.', 16, 1); RETURN; END
    IF @salida NOT IN ('PANTALLA', 'IMPRESORA', 'AMBOS')
    BEGIN RAISERROR('La salida debe ser pantalla, impresora o ambas.', 16, 1); RETURN; END
    IF @salida IN ('IMPRESORA', 'AMBOS') AND @impresora IS NULL
    BEGIN RAISERROR('Elige la impresora de esta estación.', 16, 1); RETURN; END

    IF @activa = 0 AND EXISTS (SELECT 1 FROM dbo.comandas WHERE station_id = @id AND estado IN ('NUEVA', 'PREPARANDO', 'LISTA'))
    BEGIN RAISERROR('Esta estación tiene comandas sin entregar.', 16, 1); RETURN; END

    IF @activa = 1 AND EXISTS (SELECT 1 FROM dbo.prep_stations WHERE nombre = @nombre AND activa = 1 AND id <> ISNULL(@id, 0))
    BEGIN RAISERROR('Ya hay una estación con ese nombre.', 16, 1); RETURN; END

    IF @id IS NULL
    BEGIN
        INSERT INTO dbo.prep_stations (nombre, salida, impresora, ancho_mm, orden, activa)
        VALUES (@nombre, @salida, @impresora, @ancho_mm, ISNULL(@orden, 0), ISNULL(@activa, 1));
        SET @id = SCOPE_IDENTITY();
    END
    ELSE
    BEGIN
        UPDATE dbo.prep_stations
           SET nombre = @nombre, salida = @salida, impresora = @impresora, ancho_mm = @ancho_mm,
               orden = ISNULL(@orden, orden), activa = ISNULL(@activa, activa)
         WHERE id = @id;
        /* Una estacion retirada deja de recibir: sus productos pasan a «sin
           preparacion» en vez de apuntar a algo que ya no existe. */
        IF @activa = 0 DELETE FROM dbo.product_prep_station WHERE station_id = @id;
    END

    SELECT id, nombre, salida, impresora, ancho_mm, orden, activa FROM dbo.prep_stations WHERE id = @id;
END
GO

/* Lo que se vende, con su estacion. Solo lo vendible: un ingrediente no se
   pide, asi que tampoco se prepara por separado. */
CREATE OR ALTER PROCEDURE dbo.sp_product_prep_get
AS
BEGIN
    SET NOCOUNT ON;
    SELECT p.id AS product_id, p.nombre, p.part_number, ISNULL(c.namee, '') AS category_name,
           p.inventory_mode, pp.station_id
      FROM dbo.products p
      LEFT JOIN dbo.CAT_categories c ON c.id = p.category_id
      LEFT JOIN dbo.product_prep_station pp ON pp.product_id = p.id
     WHERE p.active = 1 AND p.sellable = 1
     ORDER BY ISNULL(c.namee, ''), p.nombre;
END
GO

CREATE OR ALTER PROCEDURE dbo.sp_product_prep_set
    @product_id INT,
    @station_id INT = NULL
AS
BEGIN
    SET NOCOUNT ON;
    IF NOT EXISTS (SELECT 1 FROM dbo.products WHERE id = @product_id AND active = 1)
    BEGIN RAISERROR('El producto no existe.', 16, 1); RETURN; END

    IF @station_id IS NULL
    BEGIN
        DELETE FROM dbo.product_prep_station WHERE product_id = @product_id;
    END
    ELSE
    BEGIN
        IF NOT EXISTS (SELECT 1 FROM dbo.prep_stations WHERE id = @station_id AND activa = 1)
        BEGIN RAISERROR('La estación no existe.', 16, 1); RETURN; END
        MERGE dbo.product_prep_station AS d
        USING (SELECT @product_id AS product_id) AS s ON d.product_id = s.product_id
        WHEN MATCHED THEN UPDATE SET station_id = @station_id, updated_at = SYSDATETIME()
        WHEN NOT MATCHED THEN INSERT (product_id, station_id) VALUES (@product_id, @station_id);
    END
    SELECT @product_id AS product_id, @station_id AS station_id;
END
GO

/* ABRIR es idempotente: si la mesa ya tiene cuenta, devuelve esa. Dos
   meseros que tocan la misma mesa a la vez acaban en la misma cuenta, no en
   dos, y el indice unico lo garantiza aunque lleguen al mismo milisegundo. */
CREATE OR ALTER PROCEDURE dbo.sp_hosp_cuenta_abrir
    @mesa_id INT = NULL,
    @etiqueta NVARCHAR(60) = NULL,
    @personas INT = NULL,
    @user_id INT = NULL,
    @register_id INT = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;
    DECLARE @id INT;

    IF @mesa_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM dbo.salon_mesas WHERE id = @mesa_id AND activa = 1)
    BEGIN RAISERROR('La mesa no existe.', 16, 1); RETURN; END

    IF @mesa_id IS NULL AND LTRIM(RTRIM(ISNULL(@etiqueta, ''))) = ''
    BEGIN RAISERROR('Una cuenta sin mesa necesita un nombre.', 16, 1); RETURN; END

    BEGIN TRAN;
    IF @mesa_id IS NOT NULL
        SELECT @id = id FROM dbo.hosp_cuentas WITH (UPDLOCK, HOLDLOCK)
         WHERE mesa_id = @mesa_id AND estado IN ('ABIERTA', 'POR_COBRAR');

    IF @id IS NULL
    BEGIN
        INSERT INTO dbo.hosp_cuentas (mesa_id, etiqueta, personas, abierta_por, register_id)
        VALUES (@mesa_id, NULLIF(LTRIM(RTRIM(@etiqueta)), ''), @personas, @user_id, @register_id);
        SET @id = SCOPE_IDENTITY();
    END
    COMMIT TRAN;

    EXEC dbo.sp_hosp_cuenta_get @cuenta_id = @id;
END
GO

/* Todo lo de una cuenta, en cuatro resultados:
     1 la cuenta con su mesa;  2 las lineas;  3 sus opciones;  4 sus comandas. */
CREATE OR ALTER PROCEDURE dbo.sp_hosp_cuenta_get
    @cuenta_id INT
AS
BEGIN
    SET NOCOUNT ON;
    SELECT c.id, c.mesa_id, m.nombre AS mesa, a.nombre AS area,
           COALESCE(m.nombre, c.etiqueta) AS titulo,
           c.etiqueta, c.estado, c.personas, c.abierta_en, c.abierta_por, c.cerrada_en, c.sale_id,
           DATEDIFF(MINUTE, c.abierta_en, SYSDATETIME()) AS minutos
      FROM dbo.hosp_cuentas c
      LEFT JOIN dbo.salon_mesas m ON m.id = c.mesa_id
      LEFT JOIN dbo.salon_areas a ON a.id = m.area_id
     WHERE c.id = @cuenta_id;

    SELECT l.id, l.orden_id, l.product_id, l.nombre, l.cantidad, l.precio_unitario, l.nota,
           l.station_id, s.nombre AS estacion, l.comanda_id, k.estado AS comanda_estado, l.estado,
           o.enviada_en,
           p.inventory_mode, p.clave_prod_serv, p.clave_unidad, p.objeto_impuesto, p.tasa_iva
      FROM dbo.hosp_orden_lineas l
      JOIN dbo.hosp_ordenes o ON o.id = l.orden_id
      JOIN dbo.products p ON p.id = l.product_id
      LEFT JOIN dbo.prep_stations s ON s.id = l.station_id
      LEFT JOIN dbo.comandas k ON k.id = l.comanda_id
     WHERE l.cuenta_id = @cuenta_id
     ORDER BY l.orden_id, l.id;

    SELECT x.linea_id, x.modifier_option_id, x.group_id, x.group_name, x.option_name, x.price_delta, x.quantity
      FROM dbo.hosp_orden_linea_opciones x
      JOIN dbo.hosp_orden_lineas l ON l.id = x.linea_id
     WHERE l.cuenta_id = @cuenta_id
     ORDER BY x.linea_id, x.id;

    SELECT k.id, k.orden_id, k.station_id, s.nombre AS estacion, k.estado, k.creada_en, k.lista_en, k.entregada_en
      FROM dbo.comandas k
      JOIN dbo.prep_stations s ON s.id = k.station_id
     WHERE k.cuenta_id = @cuenta_id
     ORDER BY k.id;
END
GO

/* ENVIAR: una orden, sus lineas y una comanda por estacion.
   No cobra ni descuenta inventario: eso es de la venta. El nombre y el
   precio salen de `products` y los de las opciones de `modifier_options`:
   la pantalla dice QUE se pidio, no CUANTO cuesta. Devuelve la orden y las
   comandas creadas, para imprimir las que van a papel. */
CREATE OR ALTER PROCEDURE dbo.sp_hosp_orden_enviar
    @cuenta_id INT,
    @user_id INT = NULL,
    @lineas dbo.HospOrdenLineaType READONLY,
    @opciones dbo.HospOrdenOpcionType READONLY
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    DECLARE @estado NVARCHAR(12);
    SELECT @estado = estado FROM dbo.hosp_cuentas WHERE id = @cuenta_id;
    IF @estado IS NULL BEGIN RAISERROR('La cuenta no existe.', 16, 1); RETURN; END
    IF @estado NOT IN ('ABIERTA', 'POR_COBRAR')
    BEGIN RAISERROR('Esta cuenta ya está cerrada: abre la mesa de nuevo.', 16, 1); RETURN; END
    IF NOT EXISTS (SELECT 1 FROM @lineas)
    BEGIN RAISERROR('No hay nada que enviar.', 16, 1); RETURN; END
    IF EXISTS (SELECT 1 FROM @lineas WHERE cantidad <= 0)
    BEGIN RAISERROR('Cada línea necesita una cantidad mayor a cero.', 16, 1); RETURN; END
    IF EXISTS (SELECT 1 FROM @lineas l LEFT JOIN dbo.products p ON p.id = l.product_id AND p.active = 1 AND p.sellable = 1
                WHERE p.id IS NULL)
    BEGIN RAISERROR('Uno de los productos ya no está a la venta.', 16, 1); RETURN; END
    IF EXISTS (SELECT 1 FROM @opciones o LEFT JOIN dbo.modifier_options mo ON mo.id = o.modifier_option_id AND mo.active = 1
                WHERE mo.id IS NULL)
    BEGIN RAISERROR('Una de las opciones ya no existe.', 16, 1); RETURN; END

    DECLARE @orden_id INT;
    DECLARE @mapa TABLE (linea INT PRIMARY KEY, linea_id INT NOT NULL, station_id INT NULL);
    DECLARE @nuevas TABLE (comanda_id INT, station_id INT);

    BEGIN TRAN;

    INSERT INTO dbo.hosp_ordenes (cuenta_id, enviada_por) VALUES (@cuenta_id, @user_id);
    SET @orden_id = SCOPE_IDENTITY();

    /* MERGE y no INSERT: es la forma de saber que id recibio cada linea de
       la pantalla, y con eso colgarle sus opciones. */
    MERGE dbo.hosp_orden_lineas AS d
    USING (
        SELECT l.linea, l.product_id, p.nombre, l.cantidad, p.price, NULLIF(LTRIM(RTRIM(l.nota)), '') AS nota,
               st.id AS station_id
          FROM @lineas l
          JOIN dbo.products p ON p.id = l.product_id
          LEFT JOIN dbo.product_prep_station pp ON pp.product_id = p.id
          LEFT JOIN dbo.prep_stations st ON st.id = pp.station_id AND st.activa = 1
    ) AS s ON 1 = 0
    WHEN NOT MATCHED THEN
        INSERT (orden_id, cuenta_id, product_id, nombre, cantidad, precio_unitario, nota, station_id)
        VALUES (@orden_id, @cuenta_id, s.product_id, s.nombre, s.cantidad, s.price, s.nota, s.station_id)
    OUTPUT s.linea, inserted.id, inserted.station_id INTO @mapa (linea, linea_id, station_id);

    INSERT INTO dbo.hosp_orden_linea_opciones
        (linea_id, modifier_option_id, group_id, group_name, option_name, price_delta, quantity)
    SELECT m.linea_id, mo.id, g.id, g.name, mo.name, mo.price_delta,
           CASE WHEN o.quantity < 1 THEN 1 ELSE o.quantity END
      FROM @opciones o
      JOIN @mapa m ON m.linea = o.linea
      JOIN dbo.modifier_options mo ON mo.id = o.modifier_option_id
      JOIN dbo.modifier_groups g ON g.id = mo.group_id;

    /* Una comanda por estacion con algo que preparar. Lo que no tiene
       estacion -agua embotellada- no genera comanda: se sirve y ya. */
    INSERT INTO dbo.comandas (orden_id, cuenta_id, station_id)
    OUTPUT inserted.id, inserted.station_id INTO @nuevas (comanda_id, station_id)
    SELECT DISTINCT @orden_id, @cuenta_id, m.station_id
      FROM @mapa m WHERE m.station_id IS NOT NULL;

    UPDATE l SET comanda_id = n.comanda_id
      FROM dbo.hosp_orden_lineas l
      JOIN @mapa m ON m.linea_id = l.id
      JOIN @nuevas n ON n.station_id = m.station_id;

    /* Pedir mas a una cuenta que ya habia pedido la cuenta la reabre: el
       cliente se quedo, asi que ya no esta «por cobrar». */
    UPDATE dbo.hosp_cuentas SET estado = 'ABIERTA' WHERE id = @cuenta_id AND estado = 'POR_COBRAR';

    COMMIT TRAN;

    SELECT @orden_id AS orden_id, @cuenta_id AS cuenta_id,
           (SELECT COUNT(*) FROM @mapa) AS lineas,
           (SELECT COUNT(*) FROM @nuevas) AS comandas;

    SELECT n.comanda_id AS id, s.id AS station_id, s.nombre AS estacion, s.salida, s.impresora, s.ancho_mm
      FROM @nuevas n JOIN dbo.prep_stations s ON s.id = n.station_id
     ORDER BY n.comanda_id;
END
GO

/* ABIERTA <-> POR_COBRAR. «Por cobrar» es el cliente que pidio la cuenta. */
CREATE OR ALTER PROCEDURE dbo.sp_hosp_cuenta_estado
    @cuenta_id INT,
    @estado NVARCHAR(12),
    @user_id INT = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET @estado = UPPER(LTRIM(RTRIM(ISNULL(@estado, ''))));
    IF @estado NOT IN ('ABIERTA', 'POR_COBRAR')
    BEGIN RAISERROR('Estado no válido.', 16, 1); RETURN; END
    IF NOT EXISTS (SELECT 1 FROM dbo.hosp_cuentas WHERE id = @cuenta_id AND estado IN ('ABIERTA', 'POR_COBRAR'))
    BEGIN RAISERROR('Esta cuenta ya está cerrada.', 16, 1); RETURN; END
    UPDATE dbo.hosp_cuentas SET estado = @estado WHERE id = @cuenta_id;
    SELECT id, estado FROM dbo.hosp_cuentas WHERE id = @cuenta_id;
END
GO

/* COBRADA: la cuenta queda enlazada a su venta y la mesa se libera.
   Idempotente con la MISMA venta: reintentar tras un corte no falla. */
CREATE OR ALTER PROCEDURE dbo.sp_hosp_cuenta_cobrar
    @cuenta_id INT,
    @sale_id INT,
    @user_id INT = NULL
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @estado NVARCHAR(12), @actual INT;
    SELECT @estado = estado, @actual = sale_id FROM dbo.hosp_cuentas WHERE id = @cuenta_id;
    IF @estado IS NULL BEGIN RAISERROR('La cuenta no existe.', 16, 1); RETURN; END
    IF NOT EXISTS (SELECT 1 FROM dbo.sales WHERE id = @sale_id)
    BEGIN RAISERROR('La venta no existe.', 16, 1); RETURN; END

    IF @estado = 'COBRADA'
    BEGIN
        IF @actual = @sale_id
        BEGIN SELECT id, estado, sale_id FROM dbo.hosp_cuentas WHERE id = @cuenta_id; RETURN; END
        RAISERROR('Esta cuenta ya se cobró con otra venta.', 16, 1); RETURN;
    END
    IF @estado = 'CANCELADA' BEGIN RAISERROR('Esta cuenta se canceló.', 16, 1); RETURN; END

    UPDATE dbo.hosp_cuentas
       SET estado = 'COBRADA', sale_id = @sale_id, cerrada_por = @user_id, cerrada_en = SYSDATETIME()
     WHERE id = @cuenta_id;

    SELECT id, estado, sale_id FROM dbo.hosp_cuentas WHERE id = @cuenta_id;
END
GO

/* LIBERAR una mesa sin cobrar: solo si no hay consumo. Una cuenta con
   lineas se cobra, o se cancelan sus comandas primero (eso lo decide un
   encargado): liberarla sin mas seria regalar lo que ya se sirvio. */
CREATE OR ALTER PROCEDURE dbo.sp_hosp_cuenta_liberar
    @cuenta_id INT,
    @user_id INT = NULL
AS
BEGIN
    SET NOCOUNT ON;
    IF NOT EXISTS (SELECT 1 FROM dbo.hosp_cuentas WHERE id = @cuenta_id AND estado IN ('ABIERTA', 'POR_COBRAR'))
    BEGIN RAISERROR('Esta cuenta ya está cerrada.', 16, 1); RETURN; END
    IF EXISTS (SELECT 1 FROM dbo.hosp_orden_lineas WHERE cuenta_id = @cuenta_id AND estado = 'ACTIVA')
    BEGIN RAISERROR('La mesa tiene consumo: cóbrala, o que un encargado cancele lo pedido.', 16, 1); RETURN; END

    UPDATE dbo.hosp_cuentas
       SET estado = 'CANCELADA', cerrada_por = @user_id, cerrada_en = SYSDATETIME()
     WHERE id = @cuenta_id;
    SELECT id, estado FROM dbo.hosp_cuentas WHERE id = @cuenta_id;
END
GO

/* ------------------------------------------------------------------ KDS
   Las comandas vivas de una estacion (o de todas). Tres resultados: las
   comandas, sus lineas y las opciones de cada linea. Las entregadas no se
   ensenan: ya no son trabajo. */
CREATE OR ALTER PROCEDURE dbo.sp_kds_get
    @station_id INT = NULL,
    @comanda_id INT = NULL
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @k TABLE (id INT PRIMARY KEY);
    INSERT INTO @k (id)
    SELECT k.id FROM dbo.comandas k
     WHERE (@comanda_id IS NOT NULL AND k.id = @comanda_id)
        OR (@comanda_id IS NULL
            AND k.estado IN ('NUEVA', 'PREPARANDO', 'LISTA')
            AND (@station_id IS NULL OR k.station_id = @station_id));

    SELECT k.id, k.orden_id, k.cuenta_id, k.station_id, s.nombre AS estacion, k.estado,
           k.creada_en, k.empezada_en, k.lista_en, k.entregada_en,
           DATEDIFF(SECOND, k.creada_en, SYSDATETIME()) AS segundos,
           COALESCE(m.nombre, c.etiqueta, CONCAT('Cuenta ', c.id)) AS destino,
           a.nombre AS area
      FROM @k x
      JOIN dbo.comandas k ON k.id = x.id
      JOIN dbo.prep_stations s ON s.id = k.station_id
      JOIN dbo.hosp_cuentas c ON c.id = k.cuenta_id
      LEFT JOIN dbo.salon_mesas m ON m.id = c.mesa_id
      LEFT JOIN dbo.salon_areas a ON a.id = m.area_id
     ORDER BY k.creada_en, k.id;

    SELECT l.comanda_id, l.id, l.nombre, l.cantidad, l.nota, l.estado
      FROM dbo.hosp_orden_lineas l
      JOIN @k x ON x.id = l.comanda_id
     ORDER BY l.comanda_id, l.id;

    SELECT l.comanda_id, o.linea_id, o.group_name, o.option_name, o.quantity
      FROM dbo.hosp_orden_linea_opciones o
      JOIN dbo.hosp_orden_lineas l ON l.id = o.linea_id
      JOIN @k x ON x.id = l.comanda_id
     ORDER BY o.linea_id, o.id;
END
GO

/* El flujo es hacia delante: NUEVA -> PREPARANDO -> LISTA -> ENTREGADA.
   Saltarse PREPARANDO se permite (un vaso de agua de la barra), volver atras
   no: una comanda entregada que vuelve a «nueva» haria cocinar dos veces. */
CREATE OR ALTER PROCEDURE dbo.sp_comanda_estado
    @comanda_id INT,
    @estado NVARCHAR(12),
    @user_id INT = NULL
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @actual NVARCHAR(12);
    SET @estado = UPPER(LTRIM(RTRIM(ISNULL(@estado, ''))));
    SELECT @actual = estado FROM dbo.comandas WHERE id = @comanda_id;
    IF @actual IS NULL BEGIN RAISERROR('La comanda no existe.', 16, 1); RETURN; END

    DECLARE @paso INT = CASE @actual WHEN 'NUEVA' THEN 0 WHEN 'PREPARANDO' THEN 1 WHEN 'LISTA' THEN 2
                                     WHEN 'ENTREGADA' THEN 3 ELSE 9 END;
    DECLARE @destino INT = CASE @estado WHEN 'PREPARANDO' THEN 1 WHEN 'LISTA' THEN 2 WHEN 'ENTREGADA' THEN 3 ELSE -1 END;
    IF @destino < 0 BEGIN RAISERROR('Estado no válido.', 16, 1); RETURN; END
    IF @paso = 9 BEGIN RAISERROR('Esta comanda se canceló.', 16, 1); RETURN; END
    IF @destino <= @paso BEGIN RAISERROR('La comanda ya pasó por ese paso.', 16, 1); RETURN; END

    UPDATE dbo.comandas
       SET estado = @estado,
           empezada_en = CASE WHEN @destino >= 1 THEN ISNULL(empezada_en, SYSDATETIME()) ELSE empezada_en END,
           lista_en = CASE WHEN @destino >= 2 THEN ISNULL(lista_en, SYSDATETIME()) ELSE lista_en END,
           entregada_en = CASE WHEN @destino = 3 THEN SYSDATETIME() ELSE entregada_en END
     WHERE id = @comanda_id;

    SELECT id, estado, empezada_en, lista_en, entregada_en FROM dbo.comandas WHERE id = @comanda_id;
END
GO

/* CANCELAR saca lo pedido de la cuenta: sus lineas dejan de cobrarse. Es
   una decision de encargado (lo exige el canal), y queda escrito quien y por
   que. Una comanda entregada ya se sirvio: no se cancela, se cobra. */
CREATE OR ALTER PROCEDURE dbo.sp_comanda_cancelar
    @comanda_id INT,
    @motivo NVARCHAR(200) = NULL,
    @user_id INT = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;
    DECLARE @actual NVARCHAR(12), @cuenta INT;
    SELECT @actual = k.estado, @cuenta = k.cuenta_id FROM dbo.comandas k WHERE k.id = @comanda_id;
    IF @actual IS NULL BEGIN RAISERROR('La comanda no existe.', 16, 1); RETURN; END
    IF @actual = 'CANCELADA' BEGIN SELECT id, estado FROM dbo.comandas WHERE id = @comanda_id; RETURN; END
    IF @actual = 'ENTREGADA' BEGIN RAISERROR('Esta comanda ya se entregó: no se cancela, se cobra.', 16, 1); RETURN; END
    IF NOT EXISTS (SELECT 1 FROM dbo.hosp_cuentas WHERE id = @cuenta AND estado IN ('ABIERTA', 'POR_COBRAR'))
    BEGIN RAISERROR('La cuenta de esta comanda ya está cerrada.', 16, 1); RETURN; END

    BEGIN TRAN;
    UPDATE dbo.comandas
       SET estado = 'CANCELADA', cancelada_en = SYSDATETIME(), cancelada_por = @user_id,
           motivo = NULLIF(LTRIM(RTRIM(@motivo)), '')
     WHERE id = @comanda_id;
    UPDATE dbo.hosp_orden_lineas SET estado = 'CANCELADA' WHERE comanda_id = @comanda_id;
    COMMIT TRAN;

    SELECT id, estado FROM dbo.comandas WHERE id = @comanda_id;
END
GO
