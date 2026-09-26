/* ==========================================================================
   0042 — ENVIAR A PREPARACION NUNCA REPITE UNA LINEA
   --------------------------------------------------------------------------
   Cada linea que la caja toma nace con un ORIGEN: un identificador que le
   pone la pantalla y que no cambia aunque el envio se reintente. La base lo
   guarda, y al enviar ignora cualquier linea cuyo origen ya este guardado.

   Asi, si la respuesta de un envio se pierde -la venta se congelo, se corto
   la red a la caja secundaria- y la caja reintenta, la cocina NO recibe el
   mismo latte dos veces: la base ya lo tenia y lo salta. Si todo lo enviado
   ya estaba, no se crea ni una orden vacia.

   El indice unico sobre `origen` es la garantia de fondo: ni dos envios
   simultaneos pueden insertar la misma linea.
   ========================================================================== */

IF COL_LENGTH(N'dbo.hosp_orden_lineas', N'origen') IS NULL
    ALTER TABLE dbo.hosp_orden_lineas ADD origen UNIQUEIDENTIFIER NULL;
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'UX_hosp_orden_lineas_origen'
                 AND object_id = OBJECT_ID(N'dbo.hosp_orden_lineas'))
    CREATE UNIQUE INDEX UX_hosp_orden_lineas_origen
        ON dbo.hosp_orden_lineas(origen) WHERE origen IS NOT NULL;
GO

/* El tipo de 0040 no tenia columna de origen. Un tipo de tabla no se puede
   alterar, asi que se crea el nuevo y el procedimiento pasa a usarlo. */
IF TYPE_ID(N'dbo.HospOrdenLineaV2Type') IS NULL
    CREATE TYPE dbo.HospOrdenLineaV2Type AS TABLE (
        linea INT NOT NULL,
        product_id INT NOT NULL,
        cantidad DECIMAL(12, 3) NOT NULL,
        nota NVARCHAR(200) NULL,
        origen UNIQUEIDENTIFIER NULL
    );
GO

/* Igual que en 0040, mas `origen` en las lineas: con el, la pantalla sabe
   que una linea pendiente ya llego a la base aunque no recibiera respuesta. */
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

CREATE OR ALTER PROCEDURE dbo.sp_hosp_orden_enviar
    @cuenta_id INT,
    @user_id INT = NULL,
    @lineas dbo.HospOrdenLineaV2Type READONLY,
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
    IF EXISTS (SELECT origen FROM @lineas WHERE origen IS NOT NULL GROUP BY origen HAVING COUNT(*) > 1)
    BEGIN RAISERROR('Dos líneas del envío tienen el mismo origen.', 16, 1); RETURN; END

    DECLARE @orden_id INT;
    DECLARE @mapa TABLE (linea INT PRIMARY KEY, linea_id INT NOT NULL, station_id INT NULL);
    DECLARE @nuevas TABLE (comanda_id INT, station_id INT);
    DECLARE @pendientes TABLE (linea INT PRIMARY KEY, product_id INT, cantidad DECIMAL(12, 3), nota NVARCHAR(200), origen UNIQUEIDENTIFIER NULL);

    BEGIN TRAN;

    /* Lo que ya esta en la base NO se vuelve a enviar. El bloqueo sobre el
       indice de origen serializa dos envios de la misma linea. */
    INSERT INTO @pendientes (linea, product_id, cantidad, nota, origen)
    SELECT l.linea, l.product_id, l.cantidad, l.nota, l.origen
      FROM @lineas l
     WHERE l.origen IS NULL
        OR NOT EXISTS (SELECT 1 FROM dbo.hosp_orden_lineas x WITH (UPDLOCK, HOLDLOCK) WHERE x.origen = l.origen);

    IF NOT EXISTS (SELECT 1 FROM @pendientes)
    BEGIN
        COMMIT TRAN;
        /* Todo llego antes: exito sin orden nueva. La pantalla relee la cuenta. */
        SELECT CAST(NULL AS INT) AS orden_id, @cuenta_id AS cuenta_id, 0 AS lineas, 0 AS comandas,
               (SELECT COUNT(*) FROM @lineas) AS repetidas;
        SELECT TOP 0 CAST(NULL AS INT) AS id, CAST(NULL AS INT) AS station_id, CAST(NULL AS NVARCHAR(60)) AS estacion,
               CAST(NULL AS NVARCHAR(12)) AS salida, CAST(NULL AS NVARCHAR(200)) AS impresora, CAST(NULL AS INT) AS ancho_mm;
        RETURN;
    END

    IF EXISTS (SELECT 1 FROM @pendientes l LEFT JOIN dbo.products p ON p.id = l.product_id AND p.active = 1 AND p.sellable = 1
                WHERE p.id IS NULL)
    BEGIN ROLLBACK TRAN; RAISERROR('Uno de los productos ya no está a la venta.', 16, 1); RETURN; END
    IF EXISTS (SELECT 1 FROM @opciones o JOIN @pendientes pl ON pl.linea = o.linea
                LEFT JOIN dbo.modifier_options mo ON mo.id = o.modifier_option_id AND mo.active = 1
                WHERE mo.id IS NULL)
    BEGIN ROLLBACK TRAN; RAISERROR('Una de las opciones ya no existe.', 16, 1); RETURN; END

    INSERT INTO dbo.hosp_ordenes (cuenta_id, enviada_por) VALUES (@cuenta_id, @user_id);
    SET @orden_id = SCOPE_IDENTITY();

    MERGE dbo.hosp_orden_lineas AS d
    USING (
        SELECT l.linea, l.product_id, p.nombre, l.cantidad, p.price, NULLIF(LTRIM(RTRIM(l.nota)), '') AS nota,
               st.id AS station_id, l.origen
          FROM @pendientes l
          JOIN dbo.products p ON p.id = l.product_id
          LEFT JOIN dbo.product_prep_station pp ON pp.product_id = p.id
          LEFT JOIN dbo.prep_stations st ON st.id = pp.station_id AND st.activa = 1
    ) AS s ON 1 = 0
    WHEN NOT MATCHED THEN
        INSERT (orden_id, cuenta_id, product_id, nombre, cantidad, precio_unitario, nota, station_id, origen)
        VALUES (@orden_id, @cuenta_id, s.product_id, s.nombre, s.cantidad, s.price, s.nota, s.station_id, s.origen)
    OUTPUT s.linea, inserted.id, inserted.station_id INTO @mapa (linea, linea_id, station_id);

    INSERT INTO dbo.hosp_orden_linea_opciones
        (linea_id, modifier_option_id, group_id, group_name, option_name, price_delta, quantity)
    SELECT m.linea_id, mo.id, g.id, g.name, mo.name, mo.price_delta,
           CASE WHEN o.quantity < 1 THEN 1 ELSE o.quantity END
      FROM @opciones o
      JOIN @mapa m ON m.linea = o.linea
      JOIN dbo.modifier_options mo ON mo.id = o.modifier_option_id
      JOIN dbo.modifier_groups g ON g.id = mo.group_id;

    INSERT INTO dbo.comandas (orden_id, cuenta_id, station_id)
    OUTPUT inserted.id, inserted.station_id INTO @nuevas (comanda_id, station_id)
    SELECT DISTINCT @orden_id, @cuenta_id, m.station_id
      FROM @mapa m WHERE m.station_id IS NOT NULL;

    UPDATE l SET comanda_id = n.comanda_id
      FROM dbo.hosp_orden_lineas l
      JOIN @mapa m ON m.linea_id = l.id
      JOIN @nuevas n ON n.station_id = m.station_id;

    UPDATE dbo.hosp_cuentas SET estado = 'ABIERTA' WHERE id = @cuenta_id AND estado = 'POR_COBRAR';

    COMMIT TRAN;

    SELECT @orden_id AS orden_id, @cuenta_id AS cuenta_id,
           (SELECT COUNT(*) FROM @mapa) AS lineas,
           (SELECT COUNT(*) FROM @nuevas) AS comandas,
           (SELECT COUNT(*) FROM @lineas) - (SELECT COUNT(*) FROM @mapa) AS repetidas;

    SELECT n.comanda_id AS id, s.id AS station_id, s.nombre AS estacion, s.salida, s.impresora, s.ancho_mm
      FROM @nuevas n JOIN dbo.prep_stations s ON s.id = n.station_id
     ORDER BY n.comanda_id;
END
GO

/* El tipo viejo ya no lo usa nadie. */
IF TYPE_ID(N'dbo.HospOrdenLineaType') IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM sys.parameters WHERE user_type_id = TYPE_ID(N'dbo.HospOrdenLineaType'))
    DROP TYPE dbo.HospOrdenLineaType;
GO
