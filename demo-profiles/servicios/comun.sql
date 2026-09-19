/* ============================================================
   SEMILLA DEMO - SERVICIOS · LO QUE COMPARTEN TODOS LOS GIROS

   Se ejecuta ANTES que la del giro. Aqui va lo que no depende de si el
   negocio es un taller o una barberia: el marcador de demo, el alta del
   negocio y la caja. Lo que si depende -servicios, gente, clientes, lo que
   entra a trabajarse- va en seeds/<GIRO>.sql.

   POR QUE EL MODULO NO SE ENCIENDE AQUI
   -------------------------------------
   Porque encenderlo y elegir giro son la misma decision, y la toma
   sp_set_services_preset, que hace las dos en una transaccion. Encenderlo
   aqui "para adelantar" habria dejado un momento con el modulo activo y sin
   giro, que es justo el estado que no queremos que exista en ningun sitio.

   Se ejecuta sobre una base recien restaurada del template oficial y con
   todas las migraciones aplicadas. Todo es idempotente.
   ============================================================ */

SET NOCOUNT ON;
GO

/* ---------------------------------------------------- 1) EL MARCADOR
   Sin esto la base NO se puede restablecer ni eliminar. Va lo primero: si la
   semilla falla a la mitad, la base ya es reconocible como demo y el gestor
   puede rehacerla. */
MERGE dbo.database_metadata AS d
USING (VALUES ('is_demo', 'true'), ('demo_profile', 'servicios'),
              ('demo_created_at', CONVERT(NVARCHAR(30), SYSDATETIME(), 126))) AS s(clave, valor)
   ON d.clave = s.clave
 WHEN MATCHED THEN UPDATE SET valor = s.valor
 WHEN NOT MATCHED THEN INSERT (clave, valor) VALUES (s.clave, s.valor);
GO

/* El identificador de ESTA demo. Se genera una vez y no se vuelve a tocar:
   es lo que el gestor tiene anotado de su lado, y sin coincidencia entre los
   dos la base no se puede restablecer ni eliminar. */
IF NOT EXISTS (SELECT 1 FROM dbo.database_metadata WHERE clave = 'demo_instance_id')
    INSERT INTO dbo.database_metadata (clave, valor)
    VALUES ('demo_instance_id', CONVERT(NVARCHAR(36), NEWID()));
GO

/* ------------------------------------------- 2) NEGOCIO Y ADMINISTRADOR
   Con el MISMO procedimiento que usa el asistente de instalacion. El nombre
   es generico a proposito: el de cada giro lo ajusta su propia semilla, que
   es la que sabe si esto es un taller o una estetica. */
IF NOT EXISTS (SELECT 1 FROM dbo.users)
BEGIN
    EXEC dbo.sp_setup_inicial
        @usuario        = N'demo',
        @password       = N'demo1234',
        @business_name  = N'Demo Servicios',
        @address        = N'Calle de Prueba 100',
        @phone          = N'0000000000',
        @business_profile = N'RETAIL';
END
GO

/* La caja. `registers` viene con una fila del baseline. */
IF EXISTS (SELECT 1 FROM dbo.registers WHERE id = 1)
    UPDATE dbo.registers SET code = N'C1', name = N'Caja 1', is_active = 1 WHERE id = 1;
ELSE
BEGIN
    SET IDENTITY_INSERT dbo.registers ON;
    INSERT INTO dbo.registers (id, code, name, is_active) VALUES (1, N'C1', N'Caja 1', 1);
    SET IDENTITY_INSERT dbo.registers OFF;
END
GO

/* --------------------------------------------------- 3) UN PROVEEDOR
   Para poder ensenar una compra de refacciones sin darlo de alta en mitad de
   la demostracion. */
IF NOT EXISTS (SELECT 1 FROM dbo.CAT_suppliers WHERE nombre = N'Proveedor Demo')
    INSERT INTO dbo.CAT_suppliers (nombre, contacto, telefono)
    VALUES (N'Proveedor Demo', N'Contacto Demo', N'0000000000');
GO
