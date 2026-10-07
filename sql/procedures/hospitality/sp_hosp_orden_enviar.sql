/* sp_hosp_orden_enviar
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
CREATE OR ALTER PROCEDURE dbo.sp_hosp_orden_enviar
    @cuenta_id INT,
    @user_id INT = NULL,
    @lineas dbo.HospOrdenLineaV2Type READONLY,
    @opciones dbo.HospOrdenOpcionType READONLY,
    @commercial NVARCHAR(MAX) = NULL
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

    /* El canal pertenece a la cuenta; los componentes sobreviven a cerrar la caja. */
    IF @commercial IS NOT NULL
    BEGIN
      IF ISJSON(@commercial)<>1 OR JSON_VALUE(@commercial,'$.channel') IS NULL
      BEGIN ROLLBACK; THROW 51000,'Contexto comercial inválido.',1; END;
      DECLARE @channel NVARCHAR(64)=JSON_VALUE(@commercial,'$.channel'), @stored NVARCHAR(MAX);
      SELECT @stored=commercial_context FROM dbo.hosp_cuentas WITH(UPDLOCK,HOLDLOCK) WHERE id=@cuenta_id;
      IF EXISTS(SELECT 1 FROM dbo.hosp_orden_lineas WHERE cuenta_id=@cuenta_id)
        AND @channel<>ISNULL(JSON_VALUE(@stored,'$.channel'),'LOCAL')
      BEGIN ROLLBACK; THROW 51000,'Conserva el canal de la cuenta enviada.',1; END;
      IF NOT EXISTS(SELECT 1 FROM dbo.commercial_policy p CROSS APPLY OPENJSON(p.payload,'$.channels') WITH(id NVARCHAR(64),active BIT) c WHERE c.id=@channel AND c.active=1)
      BEGIN ROLLBACK; THROW 51000,'Canal no disponible.',1; END;
      UPDATE dbo.hosp_cuentas SET commercial_context=(SELECT @channel AS channel FOR JSON PATH,WITHOUT_ARRAY_WRAPPER) WHERE id=@cuenta_id;
    END;

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

    IF @commercial IS NOT NULL
      UPDATE l SET commercial_component=x.combo FROM dbo.hosp_orden_lineas l
      JOIN @mapa m ON m.linea_id=l.id
      JOIN OPENJSON(@commercial,'$.lines') WITH(linea INT,combo NVARCHAR(MAX) AS JSON) x ON x.linea=m.linea;

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
