/* ============================================================
   SEMILLA DEMO - SERVICIOS · MANTENIMIENTO Y SERVICIOS TECNICOS

   Aire acondicionado, refrigeracion, bombas. Lo que distingue a este giro de
   los otros dos con equipo de por medio es que el trabajo se AGENDA: no
   llega el equipo al mostrador, va el tecnico al sitio, y la agenda es la
   que dice a donde y cuando. Por eso aqui hay horario y hay equipos que
   pertenecen a un cliente y viven en su domicilio.

   Se ejecuta DESPUES de comun.sql. Todo idempotente.
   ============================================================ */

SET NOCOUNT ON;
GO

/* --------------------------------------------- 1) EL GIRO Y EL MODULO */
DECLARE @admin INT = (SELECT TOP 1 id FROM dbo.users ORDER BY id);
EXEC dbo.sp_set_services_preset @preset = N'MANTENIMIENTO', @user_id = @admin;
GO

MERGE dbo.database_metadata AS d
USING (VALUES ('demo_preset', 'MANTENIMIENTO')) AS s(clave, valor)
   ON d.clave = s.clave
 WHEN MATCHED THEN UPDATE SET valor = s.valor
 WHEN NOT MATCHED THEN INSERT (clave, valor) VALUES (s.clave, s.valor);
GO

UPDATE dbo.business_config SET business_name = N'Mantenimiento Demo Wybix';
GO

/* ------------------------------------------------ 2) QUE SE COBRA
   Duraciones largas: una visita de mantenimiento ocupa la manana entera, y
   eso es justo lo que la agenda tiene que ensenar para que sirva de algo. */
EXEC dbo.sp_service_save @nombre = N'Mantenimiento preventivo', @price = 1200.00,
     @part_number = N'SRV-PRE', @duration_minutes = 120, @default_commission_pct = 12;
EXEC dbo.sp_service_save @nombre = N'Visita de diagnóstico',    @price = 550.00,
     @part_number = N'SRV-VIS', @duration_minutes = 60,  @default_commission_pct = 10;
EXEC dbo.sp_service_save @nombre = N'Instalación de equipo',    @price = 2800.00,
     @part_number = N'SRV-INS', @duration_minutes = 240, @default_commission_pct = 15;
GO

/* ------------------------------------------- 3) MATERIAL Y CONSUMIBLES */
DECLARE @cat INT = (SELECT TOP 1 id FROM dbo.CAT_categories WHERE namee = N'Material');
IF @cat IS NULL
BEGIN
    INSERT INTO dbo.CAT_categories (namee) VALUES (N'Material');
    SET @cat = SCOPE_IDENTITY();
END

MERGE dbo.products AS d
USING (VALUES
        (N'GAS-410A',  N'Carga de gas R-410A (kg)',   CAST(480.00 AS DECIMAL(10,2)), CAST(25 AS DECIMAL(12,3))),
        (N'FILTRO-AC', N'Filtro de aire lavable',     CAST(320.00 AS DECIMAL(10,2)), CAST(14 AS DECIMAL(12,3))),
        (N'CAPAC-35',  N'Capacitor 35 µF',            CAST(260.00 AS DECIMAL(10,2)), CAST(8 AS DECIMAL(12,3)))
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
   Dos tecnicos: en este giro las dos rutas del dia se reparten, y verlas una
   al lado de la otra es la razon de que la agenda tenga columnas. */
DECLARE @t1 INT = (SELECT TOP 1 id FROM dbo.professionals WHERE full_name = N'Raúl Medina');
IF @t1 IS NULL
BEGIN
    EXEC dbo.sp_professional_save @full_name = N'Raúl Medina', @title = N'Técnico',
         @phone = N'3334440001', @default_commission_pct = 12, @color = N'#2563EB';
    SET @t1 = (SELECT TOP 1 id FROM dbo.professionals WHERE full_name = N'Raúl Medina');
END

DECLARE @t2 INT = (SELECT TOP 1 id FROM dbo.professionals WHERE full_name = N'Sofía Cruz');
IF @t2 IS NULL
BEGIN
    EXEC dbo.sp_professional_save @full_name = N'Sofía Cruz', @title = N'Técnica',
         @phone = N'3334440002', @default_commission_pct = 12, @color = N'#059669';
    SET @t2 = (SELECT TOP 1 id FROM dbo.professionals WHERE full_name = N'Sofía Cruz');
END

DECLARE @horario NVARCHAR(MAX) = N'[
  {"weekday":2,"startsAt":"08:00","endsAt":"17:00"},
  {"weekday":3,"startsAt":"08:00","endsAt":"17:00"},
  {"weekday":4,"startsAt":"08:00","endsAt":"17:00"},
  {"weekday":5,"startsAt":"08:00","endsAt":"17:00"},
  {"weekday":6,"startsAt":"08:00","endsAt":"15:00"}]';

EXEC dbo.sp_set_professional_schedule @professional_id = @t1, @franjas_json = @horario;
EXEC dbo.sp_set_professional_schedule @professional_id = @t2, @franjas_json = @horario;
GO

/* ------------------------------------- 5) LOS CLIENTES Y SUS EQUIPOS
   Clientes de empresa, que es lo normal aqui, y equipos identificados por su
   numero de serie y su ubicacion: «Minisplit oficina 2» dice mas que la
   marca cuando el tecnico llega al sitio. */
MERGE dbo.customers AS d
USING (VALUES (N'Oficinas Vértice, S.A.', N'3336660001'),
              (N'Restaurante La Parrilla', N'3336660002'),
              (N'Cliente de mostrador', N'0000000000')) AS s(customerName, phone)
   ON d.customerName = s.customerName
 WHEN NOT MATCHED THEN
      INSERT (customerName, phone, active) VALUES (s.customerName, s.phone, 1);
GO

DECLARE @v INT = (SELECT TOP 1 id FROM dbo.customers WHERE customerName = N'Oficinas Vértice, S.A.');
DECLARE @r INT = (SELECT TOP 1 id FROM dbo.customers WHERE customerName = N'Restaurante La Parrilla');

IF NOT EXISTS (SELECT 1 FROM dbo.customer_assets WHERE identifier = N'MS-0042')
    EXEC dbo.sp_customer_asset_save
         @customer_id = @v, @kind = N'EQUIPO', @label = N'Minisplit 1.5 ton · oficina 2',
         @identifier = N'MS-0042', @brand = N'Mirage', @model = N'Magnum 1.5',
         @year_or_age = N'2020', @notes = N'Último preventivo hace 7 meses';

IF NOT EXISTS (SELECT 1 FROM dbo.customer_assets WHERE identifier = N'CAM-0117')
    EXEC dbo.sp_customer_asset_save
         @customer_id = @r, @kind = N'EQUIPO', @label = N'Cámara de refrigeración · cocina',
         @identifier = N'CAM-0117', @brand = N'Imbera', @model = N'VR-35',
         @year_or_age = N'2019', @notes = N'No enfría por debajo de 6 °C';
GO
