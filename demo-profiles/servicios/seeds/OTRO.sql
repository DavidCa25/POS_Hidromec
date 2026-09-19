/* ============================================================
   SEMILLA DEMO - SERVICIOS · GENERICO

   Para el negocio que cobra por trabajo y no es ninguno de los cuatro de
   arriba. Aqui NO se inventa un vertical: no hay coches, ni equipos, ni
   vocabulario de ningun gremio. Hay lo minimo para recorrer el ciclo -un
   catalogo, alguien que trabaja y clientes- con nombres neutrales.

   POR QUE NO SE PARECE A NINGUNO
   ------------------------------
   Porque parecerse a uno seria elegir por el negocio. Quien crea esta demo
   ya dijo que lo suyo no encaja en los otros cuatro; rellenarla de servicios
   de taller "por poner algo" lo obliga a borrar antes de empezar.

   Se ejecuta DESPUES de comun.sql. Todo idempotente.
   ============================================================ */

SET NOCOUNT ON;
GO

/* --------------------------------------------- 1) EL GIRO Y EL MODULO */
DECLARE @admin INT = (SELECT TOP 1 id FROM dbo.users ORDER BY id);
EXEC dbo.sp_set_services_preset @preset = N'OTRO', @user_id = @admin;
GO

MERGE dbo.database_metadata AS d
USING (VALUES ('demo_preset', 'OTRO')) AS s(clave, valor)
   ON d.clave = s.clave
 WHEN MATCHED THEN UPDATE SET valor = s.valor
 WHEN NOT MATCHED THEN INSERT (clave, valor) VALUES (s.clave, s.valor);
GO

/* ------------------------------------------------ 2) QUE SE COBRA
   Tres conceptos que existen en casi cualquier negocio de servicios y no
   pertenecen a ninguno: revisar, trabajar por hora y trabajar a precio
   cerrado. Se renombran en dos minutos desde el catalogo. */
EXEC dbo.sp_service_save @nombre = N'Revisión inicial',     @price = 300.00,
     @part_number = N'SRV-REV', @duration_minutes = 30, @default_commission_pct = 10;
EXEC dbo.sp_service_save @nombre = N'Hora de trabajo',      @price = 450.00,
     @part_number = N'SRV-HOR', @duration_minutes = 60, @default_commission_pct = 15;
EXEC dbo.sp_service_save @nombre = N'Servicio a precio cerrado', @price = 1500.00,
     @part_number = N'SRV-CER', @duration_minutes = 120, @default_commission_pct = 15;
GO

/* ---------------------------------------------- 3) ALGO QUE SE VENDE
   Un solo producto, para que se vea que el mostrador y el trabajo se cobran
   en el mismo ticket. Su nombre tambien es neutral. */
DECLARE @cat INT = (SELECT TOP 1 id FROM dbo.CAT_categories WHERE namee = N'Material');
IF @cat IS NULL
BEGIN
    INSERT INTO dbo.CAT_categories (namee) VALUES (N'Material');
    SET @cat = SCOPE_IDENTITY();
END

MERGE dbo.products AS d
USING (VALUES
        (N'MAT-001', N'Material de trabajo', CAST(150.00 AS DECIMAL(10,2)), CAST(50 AS DECIMAL(12,3)))
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
DECLARE @p INT = (SELECT TOP 1 id FROM dbo.professionals WHERE full_name = N'Alex Rivera');
IF @p IS NULL
BEGIN
    EXEC dbo.sp_professional_save @full_name = N'Alex Rivera', @title = N'Responsable',
         @phone = N'3337770001', @default_commission_pct = 15, @color = N'#2563EB';
    SET @p = (SELECT TOP 1 id FROM dbo.professionals WHERE full_name = N'Alex Rivera');
END

EXEC dbo.sp_set_professional_schedule @professional_id = @p, @franjas_json = N'[
  {"weekday":2,"startsAt":"09:00","endsAt":"18:00"},
  {"weekday":3,"startsAt":"09:00","endsAt":"18:00"},
  {"weekday":4,"startsAt":"09:00","endsAt":"18:00"},
  {"weekday":5,"startsAt":"09:00","endsAt":"18:00"},
  {"weekday":6,"startsAt":"09:00","endsAt":"18:00"}]';
GO

/* ---------------------------------------------------- 5) LOS CLIENTES
   Sin activos: quien tenga algo sobre lo que trabajar puede registrarlo
   cuando quiera, y quien no, no tiene que borrar nada. */
MERGE dbo.customers AS d
USING (VALUES (N'Cliente Demo', N'3338880001'),
              (N'Cliente de mostrador', N'0000000000')) AS s(customerName, phone)
   ON d.customerName = s.customerName
 WHEN NOT MATCHED THEN
      INSERT (customerName, phone, active) VALUES (s.customerName, s.phone, 1);
GO
