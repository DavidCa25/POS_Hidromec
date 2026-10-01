/* expenses
 * Definicion canonica del esquema. Reconstruida desde sys.* con
 * scripts/db/extraer-esquema.mjs. SQL Server no guarda el texto del
 * CREATE TABLE original, asi que esto es equivalente, no literal.
 */
IF OBJECT_ID(N'dbo.expenses', 'U') IS NULL
BEGIN
CREATE TABLE dbo.expenses (
    id INT IDENTITY(1, 1) NOT NULL,
    expense_date DATE NOT NULL,
    created_at DATETIME2(0) NOT NULL CONSTRAINT DF_expenses_created DEFAULT (sysdatetime()),
    category_id INT NOT NULL,
    amount DECIMAL(12, 2) NOT NULL,
    payment_method VARCHAR(20) COLLATE Modern_Spanish_CI_AS NOT NULL,
    note NVARCHAR(255) COLLATE Modern_Spanish_CI_AS NULL,
    user_id INT NOT NULL,
    register_id INT NULL,
    closure_id INT NULL,
    cash_movement_id INT NULL,
    beneficiary NVARCHAR(120) COLLATE Modern_Spanish_CI_AS NULL,
    staff_user_id INT NULL,
    period_kind VARCHAR(10) COLLATE Modern_Spanish_CI_AS NULL,
    period_from DATE NULL,
    period_to DATE NULL,
    voided_at DATETIME2(0) NULL,
    voided_by INT NULL,
    void_reason NVARCHAR(200) COLLATE Modern_Spanish_CI_AS NULL,
    void_cash_movement_id INT NULL,
    CONSTRAINT PK_expenses PRIMARY KEY CLUSTERED (id)
);
END;

IF OBJECT_ID(N'dbo.CK_expenses_amount', 'C') IS NULL
ALTER TABLE dbo.expenses WITH CHECK ADD CONSTRAINT CK_expenses_amount CHECK ([amount]>(0));

IF OBJECT_ID(N'dbo.CK_expenses_cash', 'C') IS NULL
ALTER TABLE dbo.expenses WITH CHECK ADD CONSTRAINT CK_expenses_cash CHECK ([payment_method]='EFECTIVO' AND [cash_movement_id] IS NOT NULL AND [register_id] IS NOT NULL AND [closure_id] IS NOT NULL OR [payment_method]<>'EFECTIVO' AND [cash_movement_id] IS NULL AND [closure_id] IS NULL);

IF OBJECT_ID(N'dbo.CK_expenses_method', 'C') IS NULL
ALTER TABLE dbo.expenses WITH CHECK ADD CONSTRAINT CK_expenses_method CHECK ([payment_method]='OTRO' OR [payment_method]='TARJETA' OR [payment_method]='TRANSFERENCIA' OR [payment_method]='EFECTIVO');

IF OBJECT_ID(N'dbo.CK_expenses_period', 'C') IS NULL
ALTER TABLE dbo.expenses WITH CHECK ADD CONSTRAINT CK_expenses_period CHECK ([period_from] IS NULL OR [period_to] IS NULL OR [period_from]<=[period_to]);

IF OBJECT_ID(N'dbo.CK_expenses_period_kind', 'C') IS NULL
ALTER TABLE dbo.expenses WITH CHECK ADD CONSTRAINT CK_expenses_period_kind CHECK ([period_kind] IS NULL OR ([period_kind]='OTRO' OR [period_kind]='SEMANA' OR [period_kind]='DIA'));

IF OBJECT_ID(N'dbo.CK_expenses_void', 'C') IS NULL
ALTER TABLE dbo.expenses WITH CHECK ADD CONSTRAINT CK_expenses_void CHECK ([voided_at] IS NULL OR [voided_by] IS NOT NULL);

IF OBJECT_ID(N'dbo.FK_expenses_cash_movement', 'F') IS NULL
ALTER TABLE dbo.expenses WITH CHECK ADD CONSTRAINT FK_expenses_cash_movement FOREIGN KEY (cash_movement_id) REFERENCES dbo.cash_movements (id);

IF OBJECT_ID(N'dbo.FK_expenses_category', 'F') IS NULL
ALTER TABLE dbo.expenses WITH CHECK ADD CONSTRAINT FK_expenses_category FOREIGN KEY (category_id) REFERENCES dbo.expense_categories (id);

IF OBJECT_ID(N'dbo.FK_expenses_closure', 'F') IS NULL
ALTER TABLE dbo.expenses WITH CHECK ADD CONSTRAINT FK_expenses_closure FOREIGN KEY (closure_id) REFERENCES dbo.cash_closures (id);

IF OBJECT_ID(N'dbo.FK_expenses_register', 'F') IS NULL
ALTER TABLE dbo.expenses WITH CHECK ADD CONSTRAINT FK_expenses_register FOREIGN KEY (register_id) REFERENCES dbo.registers (id);

IF OBJECT_ID(N'dbo.FK_expenses_staff', 'F') IS NULL
ALTER TABLE dbo.expenses WITH CHECK ADD CONSTRAINT FK_expenses_staff FOREIGN KEY (staff_user_id) REFERENCES dbo.users (id);

IF OBJECT_ID(N'dbo.FK_expenses_user', 'F') IS NULL
ALTER TABLE dbo.expenses WITH CHECK ADD CONSTRAINT FK_expenses_user FOREIGN KEY (user_id) REFERENCES dbo.users (id);

IF OBJECT_ID(N'dbo.FK_expenses_void_movement', 'F') IS NULL
ALTER TABLE dbo.expenses WITH CHECK ADD CONSTRAINT FK_expenses_void_movement FOREIGN KEY (void_cash_movement_id) REFERENCES dbo.cash_movements (id);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_expenses_closure' AND object_id = OBJECT_ID(N'dbo.expenses'))
CREATE NONCLUSTERED INDEX IX_expenses_closure ON dbo.expenses (closure_id) WHERE ([closure_id] IS NOT NULL);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_expenses_date' AND object_id = OBJECT_ID(N'dbo.expenses'))
CREATE NONCLUSTERED INDEX IX_expenses_date ON dbo.expenses (expense_date) INCLUDE (amount, category_id, payment_method, voided_at);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_expenses_staff' AND object_id = OBJECT_ID(N'dbo.expenses'))
CREATE NONCLUSTERED INDEX IX_expenses_staff ON dbo.expenses (staff_user_id, expense_date) WHERE ([staff_user_id] IS NOT NULL);
