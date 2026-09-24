/* ============================================================
   SEMILLA DEMO - SERVICIOS · BELLEZA Y BARBERIA

   Aqui el dia ES la agenda. Dos personas con horario, servicios cortos que
   se repiten y comisiones por quien lo hizo. Nada de vehiculos, placas ni
   numeros de serie: en una barberia no entra nada que registrar aparte de
   la persona que viene.

   Se ejecuta DESPUES de comun.sql. Todo idempotente.
   ============================================================ */

SET NOCOUNT ON;
GO

/* --------------------------------------------- 1) EL GIRO Y EL MODULO */
DECLARE @admin INT = (SELECT TOP 1 id FROM dbo.users ORDER BY id);
EXEC dbo.sp_set_services_preset @preset = N'BELLEZA', @user_id = @admin;
GO

MERGE dbo.database_metadata AS d
USING (VALUES ('demo_preset', 'BELLEZA')) AS s(clave, valor)
   ON d.clave = s.clave
 WHEN MATCHED THEN UPDATE SET valor = s.valor
 WHEN NOT MATCHED THEN INSERT (clave, valor) VALUES (s.clave, s.valor);
GO

UPDATE dbo.business_config SET business_name = N'Estética Demo Wybix';
GO

/* ------------------------------------------------ 2) QUE SE COBRA
   Duraciones cortas y reales: son las que hacen que la agenda se vea llena y
   que dos citas seguidas quepan en la manana. Con comision, que en este giro
   es la mitad de la conversacion con quien trabaja. */
EXEC dbo.sp_service_save @nombre = N'Corte de cabello', @price = 180.00,
     @part_number = N'SRV-COR', @duration_minutes = 40, @default_commission_pct = 40;
EXEC dbo.sp_service_save @nombre = N'Arreglo de barba', @price = 120.00,
     @part_number = N'SRV-BAR', @duration_minutes = 30, @default_commission_pct = 40;
EXEC dbo.sp_service_save @nombre = N'Manicure',         @price = 220.00,
     @part_number = N'SRV-MAN', @duration_minutes = 50, @default_commission_pct = 45;
EXEC dbo.sp_service_save @nombre = N'Tinte',            @price = 750.00,
     @part_number = N'SRV-TIN', @duration_minutes = 120, @default_commission_pct = 35;
GO

/* ---------------------------------------------- 3) LO QUE SE VENDE APARTE
   Producto de mostrador: la cera que se lleva el cliente al salir. Es poco,
   pero es lo que ensena que Servicios y el mostrador cobran en el mismo
   ticket. */
DECLARE @cat INT = (SELECT TOP 1 id FROM dbo.CAT_categories WHERE namee = N'Productos');
IF @cat IS NULL
BEGIN
    INSERT INTO dbo.CAT_categories (namee) VALUES (N'Productos');
    SET @cat = SCOPE_IDENTITY();
END

MERGE dbo.products AS d
USING (VALUES
        (N'CERA-100', N'Cera para peinar 100 ml', CAST(190.00 AS DECIMAL(10,2)), CAST(24 AS DECIMAL(12,3))),
        (N'SHAM-300', N'Shampoo anticaída 300 ml', CAST(320.00 AS DECIMAL(10,2)), CAST(12 AS DECIMAL(12,3)))
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
   DOS personas, no una. Con una sola, la agenda es una lista; con dos se ve
   lo que la agenda resuelve de verdad: que cada quien tiene su columna y que
   nadie promete dos cosas a la misma hora. */
DECLARE @luis INT = (SELECT TOP 1 id FROM dbo.professionals WHERE full_name = N'Luis Martínez');
IF @luis IS NULL
BEGIN
    EXEC dbo.sp_professional_save @full_name = N'Luis Martínez', @title = N'Barbero',
         @phone = N'3331110001', @default_commission_pct = 40, @color = N'#2563EB';
    SET @luis = (SELECT TOP 1 id FROM dbo.professionals WHERE full_name = N'Luis Martínez');
END

DECLARE @ana INT = (SELECT TOP 1 id FROM dbo.professionals WHERE full_name = N'Ana Torres');
IF @ana IS NULL
BEGIN
    EXEC dbo.sp_professional_save @full_name = N'Ana Torres', @title = N'Estilista',
         @phone = N'3331110002', @default_commission_pct = 45, @color = N'#DB2777';
    SET @ana = (SELECT TOP 1 id FROM dbo.professionals WHERE full_name = N'Ana Torres');
END

/* Martes a sabado, que es cuando abre una estetica. weekday: 1 = domingo. */
DECLARE @horario NVARCHAR(MAX) = N'[
  {"weekday":3,"startsAt":"10:00","endsAt":"19:00"},
  {"weekday":4,"startsAt":"10:00","endsAt":"19:00"},
  {"weekday":5,"startsAt":"10:00","endsAt":"19:00"},
  {"weekday":6,"startsAt":"10:00","endsAt":"20:00"},
  {"weekday":7,"startsAt":"09:00","endsAt":"17:00"}]';

EXEC dbo.sp_set_professional_schedule @professional_id = @luis, @franjas_json = @horario;
EXEC dbo.sp_set_professional_schedule @professional_id = @ana,  @franjas_json = @horario;
GO

/* ---------------------------------------------------- 5) LOS CLIENTES
   Tres, con telefono: es lo que hace falta para agendar y para avisar. Sin
   activos: en este giro no hay nada que registrar aparte de la persona. */
MERGE dbo.customers AS d
USING (VALUES (N'Mariana López', N'3335550001'),
              (N'Jorge Peña',    N'3335550002'),
              (N'Cliente de mostrador', N'0000000000')) AS s(customerName, phone)
   ON d.customerName = s.customerName
 WHEN NOT MATCHED THEN
      INSERT (customerName, phone, active) VALUES (s.customerName, s.phone, 1);
GO
