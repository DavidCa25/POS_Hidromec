/* ==========================================================================
   0046 — NUMERO DE PEDIDO DEL DIA
   --------------------------------------------------------------------------
   La pantalla de pedidos (Estado de pedidos, en una TV del local) ensenaba el
   id interno de la cuenta. Nadie se lo daba al cliente: no salia en su ticket
   ni en la caja, y ademas no reiniciaba nunca («Pedido 4817»). El cliente no
   tenia forma de saber cual era el suyo.

   Ahora una cuenta SIN mesa (mostrador, para llevar, barra) recibe al abrirse
   un numero corto que empieza en 1 cada dia: `numero_dia`. Ese numero es el
   mismo en todas partes:

     · el ticket del cliente lo imprime en grande;
     · la caja lo dice al enviar y al cobrar («Pedido 23 · diselo al cliente»);
     · la cocina lo canta (`destino` = «Pedido 23 · Para llevar»);
     · la TV lo muestra.

   Una cuenta de mesa no lo lleva: a la mesa le lleva la comida el mesero, y
   su nombre ya la identifica.

   SEGUIMIENTO. Con el numero, la pantalla del cliente en la caja ensena un QR
   que abre, en el telefono del cliente y por la red del local, el estado de
   pedidos con el suyo marcado. El QR lleva `seguimiento`: 128 bits
   aleatorios (CRYPT_GEN_RANDOM), uno por pedido, que solo valen el dia del
   pedido y solo dejan LEER numero y estado (lo mismo que ya ensena la TV).
   Se guarda tal cual, no en hash: la caja que cobra tiene que poder volver a
   dibujar el QR, y lo que protege es poco y dura un dia. Nunca sale de la
   base hacia una pantalla de Wybix: el proceso principal lo convierte en QR.

   El numero lo asigna la base, no la pantalla: dos cajas que abren a la vez
   no pueden repetirlo (UPDLOCK + indice unico por dia).
   ========================================================================== */

IF COL_LENGTH(N'dbo.hosp_cuentas', N'numero_dia') IS NULL
    ALTER TABLE dbo.hosp_cuentas ADD numero_dia INT NULL;
GO

/* El dia de la cuenta, para numerar por dia e indexarlo. Hora local: las
   fechas de Hospitality se guardan con SYSDATETIME(). */
IF COL_LENGTH(N'dbo.hosp_cuentas', N'abierta_dia') IS NULL
    ALTER TABLE dbo.hosp_cuentas ADD abierta_dia AS CAST(abierta_en AS DATE) PERSISTED;
GO

/* Las cuentas sin mesa que ya existian reciben su numero, en orden de
   apertura. Sobre el maximo que ya tenga ese dia: repetir la migracion no
   duplica nada. */
;WITH sin_numero AS (
    SELECT c.id, c.abierta_dia,
           ROW_NUMBER() OVER (PARTITION BY c.abierta_dia ORDER BY c.id) AS n
      FROM dbo.hosp_cuentas c
     WHERE c.mesa_id IS NULL AND c.numero_dia IS NULL
)
UPDATE c
   SET numero_dia = s.n + ISNULL((SELECT MAX(x.numero_dia) FROM dbo.hosp_cuentas x
                                   WHERE x.abierta_dia = s.abierta_dia AND x.numero_dia IS NOT NULL), 0)
  FROM dbo.hosp_cuentas c
  JOIN sin_numero s ON s.id = c.id;
GO

IF COL_LENGTH(N'dbo.hosp_cuentas', N'seguimiento') IS NULL
    ALTER TABLE dbo.hosp_cuentas ADD seguimiento CHAR(32) NULL;
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'UX_hosp_cuentas_seguimiento' AND object_id = OBJECT_ID(N'dbo.hosp_cuentas'))
    CREATE UNIQUE INDEX UX_hosp_cuentas_seguimiento ON dbo.hosp_cuentas(seguimiento)
        WHERE seguimiento IS NOT NULL;
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'UX_hosp_cuentas_numero_dia' AND object_id = OBJECT_ID(N'dbo.hosp_cuentas'))
    CREATE UNIQUE INDEX UX_hosp_cuentas_numero_dia ON dbo.hosp_cuentas(abierta_dia, numero_dia)
        WHERE numero_dia IS NOT NULL;
GO

/* ABRIR: igual que en 0040, mas el numero del dia (y su codigo de
   seguimiento) para una cuenta sin mesa. */
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
    DECLARE @id INT, @numero INT = NULL, @ahora DATETIME2 = SYSDATETIME();

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
        /* El bloqueo sobre el rango del dia serializa a dos cajas que abren a
           la vez: la segunda espera y toma el siguiente. */
        IF @mesa_id IS NULL
            SELECT @numero = ISNULL(MAX(numero_dia), 0) + 1
              FROM dbo.hosp_cuentas WITH (UPDLOCK, HOLDLOCK)
             WHERE abierta_dia = CAST(@ahora AS DATE);

        INSERT INTO dbo.hosp_cuentas (mesa_id, etiqueta, personas, abierta_por, register_id, abierta_en, numero_dia, seguimiento)
        VALUES (@mesa_id, NULLIF(LTRIM(RTRIM(@etiqueta)), ''), @personas, @user_id, @register_id, @ahora, @numero,
                CASE WHEN @numero IS NOT NULL THEN CONVERT(CHAR(32), CRYPT_GEN_RANDOM(16), 2) END);
        SET @id = SCOPE_IDENTITY();
    END
    COMMIT TRAN;

    EXEC dbo.sp_hosp_cuenta_get @cuenta_id = @id;
END
GO

/* Igual que en 0042, mas `numero_dia`. Una cuenta sin mesa se titula por su
   numero: «Pedido 23 · Para llevar». */
CREATE OR ALTER PROCEDURE dbo.sp_hosp_cuenta_get
    @cuenta_id INT
AS
BEGIN
    SET NOCOUNT ON;
    SELECT c.id, c.mesa_id, m.nombre AS mesa, a.nombre AS area,
           COALESCE(m.nombre,
                    CASE WHEN c.numero_dia IS NOT NULL
                         THEN CONCAT(N'Pedido ', c.numero_dia, CASE WHEN c.etiqueta IS NOT NULL THEN N' · ' + c.etiqueta END) END,
                    c.etiqueta) AS titulo,
           c.etiqueta, c.numero_dia, c.estado, c.personas, c.abierta_en, c.abierta_por, c.cerrada_en, c.sale_id,
           DATEDIFF(MINUTE, c.abierta_en, SYSDATETIME()) AS minutos
      FROM dbo.hosp_cuentas c
      LEFT JOIN dbo.salon_mesas m ON m.id = c.mesa_id
      LEFT JOIN dbo.salon_areas a ON a.id = m.area_id
     WHERE c.id = @cuenta_id;

    SELECT l.id, l.orden_id, l.product_id, l.nombre, l.cantidad, l.precio_unitario, l.nota,
           l.station_id, s.nombre AS estacion, l.comanda_id, k.estado AS comanda_estado, l.estado,
           l.origen, o.enviada_en,
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

/* Igual que en 0040; la cocina canta el mismo numero que ve el cliente. */
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
           COALESCE(m.nombre,
                    CASE WHEN c.numero_dia IS NOT NULL
                         THEN CONCAT(N'Pedido ', c.numero_dia, CASE WHEN c.etiqueta IS NOT NULL THEN N' · ' + c.etiqueta END) END,
                    c.etiqueta, CONCAT(N'Cuenta ', c.id)) AS destino,
           c.numero_dia,
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
