/* ============================================================
   SEMILLA DEMO - SERVICIOS · TALLER AUTOMOTRIZ

   Lo MINIMO para recorrer el ciclo entero con un coche delante: entra,
   se cotiza, el cliente autoriza, se trabaja, se cobra y se entrega.

   NO SE DEJA NINGUNA ORDEN HECHA, A PROPOSITO
   -------------------------------------------
   Una demo que arranca con tres ordenes terminadas ensena el resultado y
   esconde el camino, que es lo unico que alguien quiere ver antes de
   comprar. Aqui estan las piezas -el cliente, su coche, el catalogo, las
   refacciones y quien trabaja- y el recorrido se hace en vivo.

   Se ejecuta DESPUES de comun.sql. Todo idempotente.
   ============================================================ */

SET NOCOUNT ON;
GO

/* --------------------------------------------- 1) EL GIRO Y EL MODULO
   Una sola llamada: guarda el giro y enciende Servicios en la misma
   transaccion. Es exactamente lo que hace el onboarding de un cliente real
   al elegir "Taller automotriz" en Aplicaciones, y por eso se llama al mismo
   procedimiento en vez de escribir las tablas a mano: una demo que se siembra
   por un camino propio deja de probar el camino de verdad. */
DECLARE @admin INT = (SELECT TOP 1 id FROM dbo.users ORDER BY id);
EXEC dbo.sp_set_services_preset @preset = N'TALLER_AUTOMOTRIZ', @user_id = @admin;
GO

/* Y anotado en los metadatos, que es de donde lo lee el gestor para saber
   que giro rehacer al restablecer y que decir en la tarjeta. */
MERGE dbo.database_metadata AS d
USING (VALUES ('demo_preset', 'TALLER_AUTOMOTRIZ')) AS s(clave, valor)
   ON d.clave = s.clave
 WHEN MATCHED THEN UPDATE SET valor = s.valor
 WHEN NOT MATCHED THEN INSERT (clave, valor) VALUES (s.clave, s.valor);
GO

UPDATE dbo.business_config SET business_name = N'Taller Demo Wybix';
GO

/* ------------------------------------------------ 2) QUE SE COBRA
   Con sp_service_save, el mismo procedimiento del catalogo. Un servicio nace
   siendo un producto: eso lo resuelve el procedimiento, no esta semilla. */
EXEC dbo.sp_service_save @nombre = N'Afinación mayor',      @price = 1850.00,
     @part_number = N'SRV-AFI', @duration_minutes = 120, @default_commission_pct = 10;
EXEC dbo.sp_service_save @nombre = N'Cambio de aceite',     @price = 450.00,
     @part_number = N'SRV-ACE', @duration_minutes = 40,  @default_commission_pct = 10;
EXEC dbo.sp_service_save @nombre = N'Diagnóstico con escáner', @price = 350.00,
     @part_number = N'SRV-DIA', @duration_minutes = 30,  @default_commission_pct = 8;
GO

/* ---------------------------------------------- 3) QUE SE VENDE APARTE
   Las refacciones son productos normales, con existencias, y se cobran en el
   mismo ticket que la mano de obra. Es la mitad del negocio de un taller. */
DECLARE @cat INT = (SELECT TOP 1 id FROM dbo.CAT_categories WHERE namee = N'Refacciones');
IF @cat IS NULL
BEGIN
    INSERT INTO dbo.CAT_categories (namee) VALUES (N'Refacciones');
    SET @cat = SCOPE_IDENTITY();
END

MERGE dbo.products AS d
USING (VALUES
        /* Existencias redondas y faciles de verificar de un vistazo: se
           anade una afinacion con 4 litros y 4 bujias, se cobra, y se mira si
           Inventario bajo a 16 y a 36. Un stock de 16 bujias no deja hacer esa
           cuenta de cabeza. */
        (N'ACEITE-5W30', N'Aceite 5W30 sintético (litro)', CAST(180.00 AS DECIMAL(10,2)), CAST(20 AS DECIMAL(12,3))),
        (N'FILTRO-ACE',  N'Filtro de aceite',              CAST(165.00 AS DECIMAL(10,2)), CAST(10 AS DECIMAL(12,3))),
        (N'FILTRO-AIRE', N'Filtro de aire',                CAST(210.00 AS DECIMAL(10,2)), CAST(10 AS DECIMAL(12,3))),
        (N'BUJIA-IR',    N'Bujía de iridio',               CAST(240.00 AS DECIMAL(10,2)), CAST(40 AS DECIMAL(12,3)))
      ) AS s(part_number, nombre, price, stock)
   ON d.part_number = s.part_number
 WHEN MATCHED THEN
      UPDATE SET nombre = s.nombre, price = s.price, stock = s.stock, active = 1
 WHEN NOT MATCHED THEN
      INSERT (part_number, nombre, price, stock, active, registrated_date, category_id,
              brand_id, inventory_mode, sellable, base_uom)
      /* CON MARCA. `sp_get_active_products` une con CAT_brands por INNER JOIN,
         asi que un producto sin marca no aparece en ninguna lista: ni en el
         punto de venta ni en «anadir refaccion». Nacian sin ella y por eso la
         demo se veia vacia donde deberia haber refacciones. */
      VALUES (s.part_number, s.nombre, s.price, s.stock, 1, GETDATE(), @cat,
              (SELECT TOP 1 id FROM dbo.CAT_brands WHERE namee = N'General'),
              N'DIRECT', 1, N'pza');
GO

/* ------------------------------------------------- 4) QUIEN LO HACE
   Un profesional no necesita usuario de Wybix: es quien hace el trabajo, no
   quien usa el sistema. Con su horario, para que la agenda tenga columnas. */
DECLARE @carlos INT = (SELECT TOP 1 id FROM dbo.professionals WHERE full_name = N'Carlos Ramírez');
IF @carlos IS NULL
BEGIN
    EXEC dbo.sp_professional_save @full_name = N'Carlos Ramírez', @title = N'Mecánico',
         @phone = N'3331112233', @default_commission_pct = 10, @color = N'#2563EB';
    SET @carlos = (SELECT TOP 1 id FROM dbo.professionals WHERE full_name = N'Carlos Ramírez');
END

/* Lunes a viernes, 9 a 18. weekday: 1 = domingo, 7 = sabado. */
EXEC dbo.sp_set_professional_schedule @professional_id = @carlos, @franjas_json = N'[
  {"weekday":2,"startsAt":"09:00","endsAt":"18:00"},
  {"weekday":3,"startsAt":"09:00","endsAt":"18:00"},
  {"weekday":4,"startsAt":"09:00","endsAt":"18:00"},
  {"weekday":5,"startsAt":"09:00","endsAt":"18:00"},
  {"weekday":6,"startsAt":"09:00","endsAt":"18:00"}]';
GO

/* ------------------------------------------- 5) EL CLIENTE Y SU COCHE
   En un taller llega el coche, no llega el nombre: por eso el activo trae
   placa y kilometraje, que es por lo que se busca en el mostrador. */
IF NOT EXISTS (SELECT 1 FROM dbo.customers WHERE customerName = N'David Demo')
    INSERT INTO dbo.customers (customerName, phone, active)
    VALUES (N'David Demo', N'3339998877', 1);
GO

DECLARE @cli INT = (SELECT TOP 1 id FROM dbo.customers WHERE customerName = N'David Demo');
IF NOT EXISTS (SELECT 1 FROM dbo.customer_assets WHERE identifier = N'ABC-123')
    EXEC dbo.sp_customer_asset_save
         @customer_id = @cli, @kind = N'VEHICULO', @label = N'Mazda 3 2022',
         @identifier = N'ABC-123', @brand = N'Mazda', @model = N'3 Sedán',
         @year_or_age = N'2022', @color = N'Gris', @notes = N'84,500 km en el último servicio';

IF NOT EXISTS (SELECT 1 FROM dbo.customers WHERE customerName = N'Cliente de mostrador')
    INSERT INTO dbo.customers (customerName, phone, active)
    VALUES (N'Cliente de mostrador', N'0000000000', 1);
GO
