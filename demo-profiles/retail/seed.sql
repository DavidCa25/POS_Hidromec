/* ============================================================
   SEMILLA DEMO - RETAIL

   Lo MINIMO para poder probar una venta de mostrador de punta a punta.
   No llena el panel con ventas inventadas a proposito: una demo sirve para
   PROBAR Wybix, no para aparentar una empresa con meses de operacion. El
   panel sale en cero porque asi se ve como se llena al vender.

   Se ejecuta sobre una base recien restaurada del template oficial y con
   todas las migraciones aplicadas. Todo es idempotente: volver a correrla no
   duplica nada.
   ============================================================ */

SET NOCOUNT ON;
GO

/* ---------------------------------------------------- 1) EL MARCADOR
   Sin esto la base NO se puede restablecer ni eliminar. Es la condicion que
   separa una demo de la base de un cliente, y por eso se escribe lo primero:
   si la semilla falla a la mitad, la base ya es reconocible como demo y el
   gestor puede rehacerla. */
MERGE dbo.database_metadata AS d
USING (VALUES ('is_demo', 'true'), ('demo_profile', 'retail'),
              ('demo_created_at', CONVERT(NVARCHAR(30), SYSDATETIME(), 126))) AS s(clave, valor)
   ON d.clave = s.clave
 WHEN MATCHED THEN UPDATE SET valor = s.valor
 WHEN NOT MATCHED THEN INSERT (clave, valor) VALUES (s.clave, s.valor);
GO

/* El identificador de ESTA demo. Se genera una sola vez y no se vuelve a
   tocar: volver a correr la semilla sobre la misma base conserva el que ya
   estaba, porque es lo que el gestor tiene anotado de su lado. Sin coincidencia
   entre los dos, la base no se puede restablecer ni eliminar desde el gestor.

   Lo genera SQL con NEWID() y no el gestor, para que una base sembrada a mano
   -las pruebas lo hacen- quede igual de completa que una creada desde la
   ventana. El gestor lo lee de vuelta despues de sembrar. */
IF NOT EXISTS (SELECT 1 FROM dbo.database_metadata WHERE clave = 'demo_instance_id')
    INSERT INTO dbo.database_metadata (clave, valor)
    VALUES ('demo_instance_id', CONVERT(NVARCHAR(36), NEWID()));
GO

/* ------------------------------------------- 2) NEGOCIO Y ADMINISTRADOR
   Con el MISMO procedimiento que usa el asistente de instalacion. Duplicar
   los INSERT aqui seria tener dos formas de dar de alta un negocio, y la de
   la demo dejaria de parecerse a la real en cuanto una cambiara. */
IF NOT EXISTS (SELECT 1 FROM dbo.users)
BEGIN
    EXEC dbo.sp_setup_inicial
        @usuario        = N'demo',
        @password       = N'demo1234',
        @business_name  = N'Demo Retail',
        @address        = N'Calle de Prueba 100',
        @phone          = N'0000000000',
        @business_profile = N'RETAIL';
END
GO

/* La caja. `registers` viene con una fila del baseline; se deja con nombre
   reconocible en vez de crear una segunda. */
IF EXISTS (SELECT 1 FROM dbo.registers WHERE id = 1)
    UPDATE dbo.registers SET code = N'C1', name = N'Caja 1', is_active = 1 WHERE id = 1;
ELSE
BEGIN
    SET IDENTITY_INSERT dbo.registers ON;
    INSERT INTO dbo.registers (id, code, name, is_active) VALUES (1, N'C1', N'Caja 1', 1);
    SET IDENTITY_INSERT dbo.registers OFF;
END
GO

/* --------------------------------------------------- 3) UNA CATEGORIA */
IF NOT EXISTS (SELECT 1 FROM dbo.CAT_categories WHERE namee = N'Abarrotes')
    INSERT INTO dbo.CAT_categories (namee) VALUES (N'Abarrotes');
GO

/* ------------------------------------------------------- 4) PRODUCTOS
   Dos, con existencias suficientes para vender sin quedarse en cero a la
   tercera demostracion. Uno barato y otro caro: asi se ve el cambio. */
DECLARE @cat INT = (SELECT TOP 1 id FROM dbo.CAT_categories WHERE namee = N'Abarrotes');

MERGE dbo.products AS d
USING (VALUES
        (N'DEMO-001', N'Refresco 600 ml', CAST(22.00 AS DECIMAL(10,2)), CAST(120 AS DECIMAL(12,3))),
        (N'DEMO-002', N'Café molido 500 g', CAST(185.00 AS DECIMAL(10,2)), CAST(40 AS DECIMAL(12,3)))
      ) AS s(part_number, nombre, price, stock)
   ON d.part_number = s.part_number
 WHEN MATCHED THEN
      UPDATE SET nombre = s.nombre, price = s.price, stock = s.stock, active = 1
 WHEN NOT MATCHED THEN
      INSERT (part_number, nombre, price, stock, active, registrated_date, category_id,
              inventory_mode, sellable, base_uom)
      VALUES (s.part_number, s.nombre, s.price, s.stock, 1, GETDATE(), @cat,
              N'DIRECT', 1, N'pza');
GO

/* ------------------------------------------- 5) UN CLIENTE Y UN PROVEEDOR
   Para poder ensenar una venta a credito y una compra sin tener que darlos
   de alta en mitad de la demostracion. */
IF NOT EXISTS (SELECT 1 FROM dbo.customers WHERE customerName = N'Cliente de mostrador')
    INSERT INTO dbo.customers (customerName, phone, active)
    VALUES (N'Cliente de mostrador', N'0000000000', 1);
GO

IF NOT EXISTS (SELECT 1 FROM dbo.CAT_suppliers WHERE nombre = N'Proveedor Demo')
    INSERT INTO dbo.CAT_suppliers (nombre, contacto, telefono)
    VALUES (N'Proveedor Demo', N'Contacto Demo', N'0000000000');
GO
