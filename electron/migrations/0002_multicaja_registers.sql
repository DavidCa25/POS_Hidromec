/* ============================================================
   Multicaja - Capa 1: modelo de datos
   - Crea el catalogo de cajas (registers)
   - Agrega register_id a sales, cash_shifts, cash_closures, cash_movements
   - Crea una "Caja 1" por defecto y respalda los datos existentes hacia ella
   Idempotente: se puede correr varias veces sin romper nada.
   Sin GO: un solo batch, usando EXEC para los pasos que tocan columnas nuevas.
   ============================================================ */

SET NOCOUNT ON;
SET XACT_ABORT ON;

/* ------------------------------------------------------------
   1) Catalogo de cajas
   ------------------------------------------------------------ */
IF OBJECT_ID('dbo.registers', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.registers (
    id         INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_registers PRIMARY KEY,
    code       NVARCHAR(10) NOT NULL,   -- prefijo de folio: C1, C2, ...
    name       NVARCHAR(60) NOT NULL,   -- "Caja 1"
    is_active  BIT NOT NULL CONSTRAINT DF_registers_is_active DEFAULT (1),
    created_at DATETIME2(0) NOT NULL CONSTRAINT DF_registers_created_at DEFAULT (sysutcdatetime())
  );

  CREATE UNIQUE INDEX UX_registers_code ON dbo.registers(code);
END;

/* ------------------------------------------------------------
   2) Caja por defecto (si el catalogo esta vacio)
   ------------------------------------------------------------ */
IF NOT EXISTS (SELECT 1 FROM dbo.registers)
BEGIN
  INSERT INTO dbo.registers (code, name) VALUES (N'C1', N'Caja 1');
END;

/* id de la caja por defecto: la mas antigua */
DECLARE @defaultRegisterId INT = (SELECT TOP 1 id FROM dbo.registers ORDER BY id ASC);
DECLARE @idStr NVARCHAR(12) = CAST(@defaultRegisterId AS NVARCHAR(12));

/* ------------------------------------------------------------
   3) register_id en cada tabla (columna + default + backfill + FK + indice)
   Cada paso va en su propio EXEC para que SQL "vea" la columna recien creada.
   El DEFAULT mantiene compatible el codigo viejo: si un SP no manda
   register_id, la fila cae en la Caja por defecto automaticamente.
   ------------------------------------------------------------ */

/* ---- sales ---- */
IF COL_LENGTH('dbo.sales', 'register_id') IS NULL
  EXEC('ALTER TABLE dbo.sales ADD register_id INT NULL CONSTRAINT DF_sales_register_id DEFAULT (' + @idStr + ')');
EXEC('UPDATE dbo.sales SET register_id = ' + @idStr + ' WHERE register_id IS NULL');
IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_sales_register')
  EXEC('ALTER TABLE dbo.sales WITH CHECK ADD CONSTRAINT FK_sales_register FOREIGN KEY (register_id) REFERENCES dbo.registers(id)');
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_sales_register_id' AND object_id = OBJECT_ID('dbo.sales'))
  EXEC('CREATE INDEX IX_sales_register_id ON dbo.sales(register_id)');

/* ---- cash_shifts ---- */
IF COL_LENGTH('dbo.cash_shifts', 'register_id') IS NULL
  EXEC('ALTER TABLE dbo.cash_shifts ADD register_id INT NULL CONSTRAINT DF_cash_shifts_register_id DEFAULT (' + @idStr + ')');
EXEC('UPDATE dbo.cash_shifts SET register_id = ' + @idStr + ' WHERE register_id IS NULL');
IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_cash_shifts_register')
  EXEC('ALTER TABLE dbo.cash_shifts WITH CHECK ADD CONSTRAINT FK_cash_shifts_register FOREIGN KEY (register_id) REFERENCES dbo.registers(id)');
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_cash_shifts_register_id' AND object_id = OBJECT_ID('dbo.cash_shifts'))
  EXEC('CREATE INDEX IX_cash_shifts_register_id ON dbo.cash_shifts(register_id)');

/* ---- cash_closures ---- */
IF COL_LENGTH('dbo.cash_closures', 'register_id') IS NULL
  EXEC('ALTER TABLE dbo.cash_closures ADD register_id INT NULL CONSTRAINT DF_cash_closures_register_id DEFAULT (' + @idStr + ')');
EXEC('UPDATE dbo.cash_closures SET register_id = ' + @idStr + ' WHERE register_id IS NULL');
IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_cash_closures_register')
  EXEC('ALTER TABLE dbo.cash_closures WITH CHECK ADD CONSTRAINT FK_cash_closures_register FOREIGN KEY (register_id) REFERENCES dbo.registers(id)');
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_cash_closures_register_id' AND object_id = OBJECT_ID('dbo.cash_closures'))
  EXEC('CREATE INDEX IX_cash_closures_register_id ON dbo.cash_closures(register_id)');

/* ---- cash_movements ---- */
IF COL_LENGTH('dbo.cash_movements', 'register_id') IS NULL
  EXEC('ALTER TABLE dbo.cash_movements ADD register_id INT NULL CONSTRAINT DF_cash_movements_register_id DEFAULT (' + @idStr + ')');
EXEC('UPDATE dbo.cash_movements SET register_id = ' + @idStr + ' WHERE register_id IS NULL');
IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_cash_movements_register')
  EXEC('ALTER TABLE dbo.cash_movements WITH CHECK ADD CONSTRAINT FK_cash_movements_register FOREIGN KEY (register_id) REFERENCES dbo.registers(id)');
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_cash_movements_register_id' AND object_id = OBJECT_ID('dbo.cash_movements'))
  EXEC('CREATE INDEX IX_cash_movements_register_id ON dbo.cash_movements(register_id)');