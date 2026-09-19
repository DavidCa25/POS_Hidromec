/* ============================================================
   SEMILLA DEMO - SERVICIOS · REPARACION DE ELECTRONICOS

   El mismo ciclo que el taller y otro vocabulario: aqui lo que entra es un
   EQUIPO y lo que lo identifica es su numero de serie o su IMEI, no una
   placa. Sirve para ensenar que el modulo no esta hecho para coches: esta
   hecho para "lo que el cliente trae", y lo que cambia es como se llama.

   Se ejecuta DESPUES de comun.sql. Todo idempotente.
   ============================================================ */

SET NOCOUNT ON;
GO

/* --------------------------------------------- 1) EL GIRO Y EL MODULO */
DECLARE @admin INT = (SELECT TOP 1 id FROM dbo.users ORDER BY id);
EXEC dbo.sp_set_services_preset @preset = N'REPARACION_ELECTRONICA', @user_id = @admin;
GO

MERGE dbo.database_metadata AS d
USING (VALUES ('demo_preset', 'REPARACION_ELECTRONICA')) AS s(clave, valor)
   ON d.clave = s.clave
 WHEN MATCHED THEN UPDATE SET valor = s.valor
 WHEN NOT MATCHED THEN INSERT (clave, valor) VALUES (s.clave, s.valor);
GO

UPDATE dbo.business_config SET business_name = N'Servicio Técnico Demo Wybix';
GO

/* ------------------------------------------------ 2) QUE SE COBRA
   El diagnostico se cobra aparte y va primero: en este giro es normal cobrar
   por revisar aunque el cliente decida no reparar, y el modulo lo soporta
   porque una orden puede cotizarse, no autorizarse y cobrarse igual. */
EXEC dbo.sp_service_save @nombre = N'Diagnóstico',            @price = 250.00,
     @part_number = N'SRV-DIA', @duration_minutes = 30,  @default_commission_pct = 10;
EXEC dbo.sp_service_save @nombre = N'Cambio de pantalla',     @price = 1200.00,
     @part_number = N'SRV-PAN', @duration_minutes = 90,  @default_commission_pct = 15;
EXEC dbo.sp_service_save @nombre = N'Mantenimiento y limpieza', @price = 600.00,
     @part_number = N'SRV-MAN', @duration_minutes = 60,  @default_commission_pct = 12;
GO

/* ---------------------------------------------- 3) LAS REFACCIONES */
DECLARE @cat INT = (SELECT TOP 1 id FROM dbo.CAT_categories WHERE namee = N'Refacciones');
IF @cat IS NULL
BEGIN
    INSERT INTO dbo.CAT_categories (namee) VALUES (N'Refacciones');
    SET @cat = SCOPE_IDENTITY();
END

MERGE dbo.products AS d
USING (VALUES
        (N'PANT-IP13', N'Pantalla iPhone 13 (compatible)', CAST(1450.00 AS DECIMAL(10,2)), CAST(4 AS DECIMAL(12,3))),
        (N'BAT-IP13',  N'Batería iPhone 13',               CAST(690.00 AS DECIMAL(10,2)), CAST(6 AS DECIMAL(12,3))),
        (N'PASTA-TER', N'Pasta térmica (aplicación)',      CAST(120.00 AS DECIMAL(10,2)), CAST(30 AS DECIMAL(12,3)))
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

/* ------------------------------------------------- 4) QUIEN LO HACE */
DECLARE @tec INT = (SELECT TOP 1 id FROM dbo.professionals WHERE full_name = N'Iván Estrada');
IF @tec IS NULL
BEGIN
    EXEC dbo.sp_professional_save @full_name = N'Iván Estrada', @title = N'Técnico',
         @phone = N'3332220011', @default_commission_pct = 12, @color = N'#0891B2';
    SET @tec = (SELECT TOP 1 id FROM dbo.professionals WHERE full_name = N'Iván Estrada');
END

EXEC dbo.sp_set_professional_schedule @professional_id = @tec, @franjas_json = N'[
  {"weekday":2,"startsAt":"10:00","endsAt":"19:00"},
  {"weekday":3,"startsAt":"10:00","endsAt":"19:00"},
  {"weekday":4,"startsAt":"10:00","endsAt":"19:00"},
  {"weekday":5,"startsAt":"10:00","endsAt":"19:00"},
  {"weekday":6,"startsAt":"10:00","endsAt":"19:00"}]';
GO

/* ----------------------------------------- 5) LOS CLIENTES Y SUS EQUIPOS
   Dos equipos distintos a proposito -un telefono y una laptop-, para que se
   vea que lo que entra no tiene por que ser siempre la misma clase de cosa.
   El identificador es la serie o el IMEI, que es por lo que se busca aqui. */
MERGE dbo.customers AS d
USING (VALUES (N'David Demo', N'3339998877'),
              (N'Paulina Ruiz', N'3335550010'),
              (N'Cliente de mostrador', N'0000000000')) AS s(customerName, phone)
   ON d.customerName = s.customerName
 WHEN NOT MATCHED THEN
      INSERT (customerName, phone, active) VALUES (s.customerName, s.phone, 1);
GO

DECLARE @d INT = (SELECT TOP 1 id FROM dbo.customers WHERE customerName = N'David Demo');
DECLARE @p INT = (SELECT TOP 1 id FROM dbo.customers WHERE customerName = N'Paulina Ruiz');

IF NOT EXISTS (SELECT 1 FROM dbo.customer_assets WHERE identifier = N'F2LX9K3QJC')
    EXEC dbo.sp_customer_asset_save
         @customer_id = @d, @kind = N'EQUIPO', @label = N'iPhone 13 negro',
         @identifier = N'F2LX9K3QJC', @brand = N'Apple', @model = N'iPhone 13',
         @year_or_age = N'2022', @color = N'Negro',
         @notes = N'Pantalla estrellada en la esquina inferior';

IF NOT EXISTS (SELECT 1 FROM dbo.customer_assets WHERE identifier = N'PF2XK9L1')
    EXEC dbo.sp_customer_asset_save
         @customer_id = @p, @kind = N'EQUIPO', @label = N'Laptop Lenovo ThinkPad',
         @identifier = N'PF2XK9L1', @brand = N'Lenovo', @model = N'ThinkPad E14',
         @year_or_age = N'2021', @color = N'Negro',
         @notes = N'Se calienta y se apaga sola';
GO
