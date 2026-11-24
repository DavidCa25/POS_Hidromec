/* ============================================================
   SEMILLA DEMO - SERVICIOS · CONSULTORIO DE SALUD

   El día es la agenda: consultas cortas que se repiten, un médico y una
   dentista con su horario. Lo clínico (expediente, odontograma, recetas)
   vive en el giro Salud y NO se siembra aquí: una demo no lleva datos de
   salud de nadie, ni inventados.

   Los servicios de salud prestados por médico o dentista persona física
   van exentos de IVA (art. 15 fr. XIV LIVA): tasa 0 en el catálogo.

   Se ejecuta DESPUES de comun.sql. Todo idempotente.
   ============================================================ */

SET NOCOUNT ON;
GO

/* --------------------------------------------- 1) EL GIRO Y EL MODULO */
DECLARE @admin INT = (SELECT TOP 1 id FROM dbo.users ORDER BY id);
EXEC dbo.sp_set_services_preset @preset = N'SALUD', @user_id = @admin;
GO

MERGE dbo.database_metadata AS d
USING (VALUES ('demo_preset', 'SALUD')) AS s(clave, valor)
   ON d.clave = s.clave
 WHEN MATCHED THEN UPDATE SET valor = s.valor
 WHEN NOT MATCHED THEN INSERT (clave, valor) VALUES (s.clave, s.valor);
GO

UPDATE dbo.business_config SET business_name = N'Consultorio Demo Wybix';
GO

/* ------------------------------------------------ 2) QUE SE COBRA */
EXEC dbo.sp_service_save @nombre = N'Consulta general', @price = 450.00, @tasa_iva = 0, @iva_exento = 1,
     @part_number = N'SRV-CONS', @duration_minutes = 30, @default_commission_pct = 0;
EXEC dbo.sp_service_save @nombre = N'Consulta dental de valoración', @price = 350.00, @tasa_iva = 0, @iva_exento = 1,
     @part_number = N'SRV-DENT', @duration_minutes = 30, @default_commission_pct = 0;
EXEC dbo.sp_service_save @nombre = N'Limpieza dental', @price = 700.00, @tasa_iva = 0, @iva_exento = 1,
     @part_number = N'SRV-LIMP', @duration_minutes = 45, @default_commission_pct = 0;
EXEC dbo.sp_service_save @nombre = N'Resina', @price = 800.00, @tasa_iva = 0, @iva_exento = 1,
     @part_number = N'SRV-RESI', @duration_minutes = 60, @default_commission_pct = 0;
GO

/* ------------------------------------------------- 3) QUIEN ATIENDE */
IF NOT EXISTS (SELECT 1 FROM dbo.professionals WHERE full_name = N'Dra. Ana López')
    EXEC dbo.sp_professional_save @full_name = N'Dra. Ana López', @title = N'Cirujana dentista', @color = N'#0ea5e9';
IF NOT EXISTS (SELECT 1 FROM dbo.professionals WHERE full_name = N'Dr. Jorge Ramírez')
    EXEC dbo.sp_professional_save @full_name = N'Dr. Jorge Ramírez', @title = N'Médico general', @color = N'#22c55e';
GO
