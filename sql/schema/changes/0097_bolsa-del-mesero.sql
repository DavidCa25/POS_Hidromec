/* 0097 · La bolsa del mesero
 *
 * Cada mesero cobra sus mesas (o cualquier otra) desde su tablet. Lo que cobra
 * en efectivo, con la propina en efectivo, lo trae él: no está en el cajón
 * hasta que lo entrega. Al final del turno lo entrega en caja y Wybix dice si
 * le falta o le sobra.
 *
 *   mesero_cobros     cada mesa que cobró un mesero: su venta, cómo pagó, la
 *                     propina y el efectivo que quedó en su bolsa. El
 *                     movimiento MESERO_BOLSA (−) saca ese efectivo de lo que
 *                     espera el cajón.
 *   mesero_entregas   cada entrega del mesero en caja: lo que debía entregar,
 *                     lo que entregó y la diferencia. El movimiento
 *                     MESERO_ENTREGA (+) mete al cajón lo que entregó.
 *
 * La venta es una venta normal de la caja (sp_register_sale), a nombre del
 * mesero: inventario, IVA, reportes y propinas como siempre.
 */
/* Los dos movimientos nuevos del cajón, con su nombre para el corte. */
IF NOT EXISTS (SELECT 1 FROM dbo.cash_movement_types WHERE code = 'MESERO_BOLSA')
INSERT INTO dbo.cash_movement_types (code, label, grupo, sort_order) VALUES ('MESERO_BOLSA', N'Efectivo que traen los meseros', 'RETIROS', 76);

IF NOT EXISTS (SELECT 1 FROM dbo.cash_movement_types WHERE code = 'MESERO_ENTREGA')
INSERT INTO dbo.cash_movement_types (code, label, grupo, sort_order) VALUES ('MESERO_ENTREGA', N'Entrega de mesero', 'ENTRADAS', 56);

IF OBJECT_ID(N'dbo.mesero_cobros', 'U') IS NULL
BEGIN
CREATE TABLE dbo.mesero_cobros (
    sale_id INT NOT NULL,
    mesero_id INT NOT NULL,
    cuenta_id INT NULL,
    closure_id INT NOT NULL,
    register_id INT NOT NULL,
    metodo NVARCHAR(30) COLLATE Modern_Spanish_CI_AS NOT NULL,
    total DECIMAL(12, 2) NOT NULL,
    propina DECIMAL(12, 2) NOT NULL CONSTRAINT DF_mesero_cobros_propina DEFAULT ((0)),
    propina_metodo VARCHAR(12) COLLATE Modern_Spanish_CI_AS NULL,
    efectivo DECIMAL(12, 2) NOT NULL,
    cash_movement_id INT NULL,
    cobrado_en DATETIME2(3) NOT NULL CONSTRAINT DF_mesero_cobros_cobrado_en DEFAULT (sysdatetime()),
    CONSTRAINT PK_mesero_cobros PRIMARY KEY CLUSTERED (sale_id)
);
END;

IF OBJECT_ID(N'dbo.FK_mesero_cobros_sale', 'F') IS NULL
ALTER TABLE dbo.mesero_cobros WITH CHECK ADD CONSTRAINT FK_mesero_cobros_sale FOREIGN KEY (sale_id) REFERENCES dbo.sales (id);

IF OBJECT_ID(N'dbo.FK_mesero_cobros_closure', 'F') IS NULL
ALTER TABLE dbo.mesero_cobros WITH CHECK ADD CONSTRAINT FK_mesero_cobros_closure FOREIGN KEY (closure_id) REFERENCES dbo.cash_closures (id);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_mesero_cobros_mesero' AND object_id = OBJECT_ID(N'dbo.mesero_cobros'))
CREATE NONCLUSTERED INDEX IX_mesero_cobros_mesero ON dbo.mesero_cobros (mesero_id, closure_id);

IF OBJECT_ID(N'dbo.mesero_entregas', 'U') IS NULL
BEGIN
CREATE TABLE dbo.mesero_entregas (
    id INT IDENTITY(1, 1) NOT NULL,
    mesero_id INT NOT NULL,
    closure_id INT NOT NULL,
    register_id INT NOT NULL,
    esperado DECIMAL(12, 2) NOT NULL,
    entregado DECIMAL(12, 2) NOT NULL,
    diferencia DECIMAL(12, 2) NOT NULL,
    recibio_user_id INT NULL,
    nota NVARCHAR(255) COLLATE Modern_Spanish_CI_AS NULL,
    cash_movement_id INT NULL,
    entregado_en DATETIME2(3) NOT NULL CONSTRAINT DF_mesero_entregas_en DEFAULT (sysdatetime()),
    CONSTRAINT PK_mesero_entregas PRIMARY KEY CLUSTERED (id)
);
END;

IF OBJECT_ID(N'dbo.FK_mesero_entregas_closure', 'F') IS NULL
ALTER TABLE dbo.mesero_entregas WITH CHECK ADD CONSTRAINT FK_mesero_entregas_closure FOREIGN KEY (closure_id) REFERENCES dbo.cash_closures (id);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_mesero_entregas_mesero' AND object_id = OBJECT_ID(N'dbo.mesero_entregas'))
CREATE NONCLUSTERED INDEX IX_mesero_entregas_mesero ON dbo.mesero_entregas (mesero_id, closure_id);
GO
