/* ============================================================================
   0049 — CONTROL DE CAJA Y EGRESOS
   ----------------------------------------------------------------------------
   Tres cosas, en este orden:

   1. CATALOGO DE TIPOS DE MOVIMIENTO DE CAJA. `cash_movements.typee` era texto
      libre: un error de dedo creaba un tipo nuevo sin que nadie lo notara, y
      cada pantalla clasificaba los tipos por su cuenta (el Corte solo conocia
      tres). Ahora cada tipo existe una vez, con su grupo en el corte y su
      etiqueta, y la columna tiene llave foranea.
      COMPATIBLE CON LO QUE YA HAY: antes de poner la llave se adopta cualquier
      valor que ya este en la tabla (grupo OTROS). No se cambia ni se borra
      ninguna fila de cash_movements.

   2. CONCEPTOS DE EGRESO (expense_categories). Administrables por el negocio:
      crear, renombrar, activar/desactivar y ordenar. Los iniciales son solo un
      punto de partida. Uno es especial: «Pago al personal» (kind = PERSONAL),
      que es lo que convierte un egreso en un pago a una persona del sistema.

   3. EGRESOS (expenses). Un egreso es dinero que sale del negocio y no es una
      compra: renta, luz, un Uber, el pago de la semana a alguien. Si se paga
      en EFECTIVO sale del cajon: tiene su movimiento de caja (typee EXPENSE)
      en el turno abierto de ESA caja, y la tabla no admite un egreso en
      efectivo sin el. Si se paga de otra forma, no toca la caja.

   Lo que NO es un egreso y sigue en su dominio: el retiro de caja (WITHDRAW,
   dinero que cambia de lugar), las compras (purchase) y los pagos a
   proveedor (supplier_payments).
   ========================================================================== */

/* ------------------------------------------------------------------ 1 tipos */
IF OBJECT_ID(N'dbo.cash_movement_types', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.cash_movement_types (
        /* Mismo tipo y collation que cash_movements.typee: la llave foranea
           los exige iguales. */
        code        VARCHAR(30) COLLATE Modern_Spanish_CI_AS NOT NULL,
        label       NVARCHAR(60) COLLATE Modern_Spanish_CI_AS NOT NULL,
        /* Renglon del corte en el que se suma. FONDO no se suma: es el punto
           de partida, y se muestra aparte. */
        grupo       VARCHAR(20) COLLATE Modern_Spanish_CI_AS NOT NULL,
        sort_order  INT NOT NULL CONSTRAINT DF_cash_movement_types_sort DEFAULT (100),
        CONSTRAINT PK_cash_movement_types PRIMARY KEY CLUSTERED (code),
        CONSTRAINT CK_cash_movement_types_grupo CHECK (grupo IN (
            'FONDO', 'VENTAS', 'ABONOS', 'ENTRADAS', 'DEVOLUCIONES', 'AJUSTES',
            'RETIROS', 'PROVEEDORES', 'EGRESOS', 'OTROS'))
    );
END;
GO

MERGE dbo.cash_movement_types AS t
USING (VALUES
    ('OPENING',          N'Fondo inicial',                 'FONDO',        10),
    ('SALE',             N'Venta en efectivo',             'VENTAS',       20),
    ('SALE_ADJ',         N'Ajuste de venta',               'AJUSTES',      30),
    ('PAYMENT',          N'Abono de cliente en efectivo',  'ABONOS',       40),
    ('DEPOSIT',          N'Entrada de efectivo',           'ENTRADAS',     50),
    ('REFUND',           N'Devolucion en efectivo',        'DEVOLUCIONES', 60),
    ('WITHDRAW',         N'Retiro de caja',                'RETIROS',      70),
    ('SUPPLIER_PAYMENT', N'Pago a proveedor en efectivo',  'PROVEEDORES',  80),
    ('EXPENSE',          N'Egreso en efectivo',            'EGRESOS',      90)
) AS s (code, label, grupo, sort_order)
ON t.code = s.code
WHEN NOT MATCHED THEN
    INSERT (code, label, grupo, sort_order) VALUES (s.code, s.label, s.grupo, s.sort_order);
GO

/* Adoptar lo que ya existe. Una instalacion puede traer valores que nadie
   documento; se quedan tal cual, en OTROS, y el corte los sigue sumando. */
INSERT INTO dbo.cash_movement_types (code, label, grupo, sort_order)
SELECT DISTINCT m.typee, CAST(m.typee AS NVARCHAR(60)), 'OTROS', 900
  FROM dbo.cash_movements m
 WHERE m.typee IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM dbo.cash_movement_types t WHERE t.code = m.typee);
GO

IF OBJECT_ID(N'dbo.FK_cash_movements_type', 'F') IS NULL
    ALTER TABLE dbo.cash_movements WITH CHECK
        ADD CONSTRAINT FK_cash_movements_type FOREIGN KEY (typee) REFERENCES dbo.cash_movement_types (code);
GO

/* ------------------------------------------------------- 2 conceptos */
IF OBJECT_ID(N'dbo.expense_categories', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.expense_categories (
        id          INT IDENTITY(1, 1) NOT NULL,
        name        NVARCHAR(60) COLLATE Modern_Spanish_CI_AS NOT NULL,
        /* GENERAL: un gasto cualquiera. PERSONAL: pago a una persona del
           sistema; exige a quien se le paga. Solo el sistema crea PERSONAL. */
        kind        VARCHAR(10) COLLATE Modern_Spanish_CI_AS NOT NULL
                    CONSTRAINT DF_expense_categories_kind DEFAULT ('GENERAL'),
        is_system   BIT NOT NULL CONSTRAINT DF_expense_categories_system DEFAULT (0),
        active      BIT NOT NULL CONSTRAINT DF_expense_categories_active DEFAULT (1),
        sort_order  INT NOT NULL CONSTRAINT DF_expense_categories_sort DEFAULT (100),
        created_at  DATETIME2(0) NOT NULL CONSTRAINT DF_expense_categories_created DEFAULT (SYSDATETIME()),
        updated_at  DATETIME2(0) NULL,
        CONSTRAINT PK_expense_categories PRIMARY KEY CLUSTERED (id),
        CONSTRAINT CK_expense_categories_kind CHECK (kind IN ('GENERAL', 'PERSONAL')),
        CONSTRAINT CK_expense_categories_name CHECK (LEN(LTRIM(RTRIM(name))) > 0)
    );
    CREATE UNIQUE NONCLUSTERED INDEX UX_expense_categories_name ON dbo.expense_categories (name);
END;
GO

/* Conceptos iniciales: solo si la tabla esta vacia. Si el negocio ya los
   renombro o desactivo, reaplicar la migracion no se los devuelve. */
IF NOT EXISTS (SELECT 1 FROM dbo.expense_categories)
    INSERT INTO dbo.expense_categories (name, kind, is_system, sort_order) VALUES
        (N'Pago al personal', 'PERSONAL', 1, 10),
        (N'Renta',            'GENERAL',  0, 20),
        (N'Luz',              'GENERAL',  0, 30),
        (N'Agua',             'GENERAL',  0, 40),
        (N'Gas',              'GENERAL',  0, 50),
        (N'Internet',         'GENERAL',  0, 60),
        (N'Publicidad',       'GENERAL',  0, 70),
        (N'Limpieza',         'GENERAL',  0, 80),
        (N'Mantenimiento',    'GENERAL',  0, 90),
        (N'Otros',            'GENERAL',  0, 1000);
GO

/* --------------------------------------------------------- 3 egresos */
IF OBJECT_ID(N'dbo.expenses', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.expenses (
        id                INT IDENTITY(1, 1) NOT NULL,
        /* El dia al que corresponde el gasto (puede capturarse despues). */
        expense_date      DATE NOT NULL,
        created_at        DATETIME2(0) NOT NULL CONSTRAINT DF_expenses_created DEFAULT (SYSDATETIME()),
        category_id       INT NOT NULL,
        amount            DECIMAL(12, 2) NOT NULL,
        payment_method    VARCHAR(20) COLLATE Modern_Spanish_CI_AS NOT NULL,
        note              NVARCHAR(255) COLLATE Modern_Spanish_CI_AS NULL,
        /* Quien lo registro (la sesion, no lo que diga la pantalla). */
        user_id           INT NOT NULL,
        /* Solo con EFECTIVO: la caja, el turno y el movimiento del cajon. */
        register_id       INT NULL,
        closure_id        INT NULL,
        cash_movement_id  INT NULL,
        /* A quien se le pago, en texto (el arrendador, "Uber"...). */
        beneficiary       NVARCHAR(120) COLLATE Modern_Spanish_CI_AS NULL,
        /* PAGO AL PERSONAL: la persona (users es la entidad canonica del
           personal en Wybix) y el periodo que se le paga. No es nomina. */
        staff_user_id     INT NULL,
        period_kind       VARCHAR(10) COLLATE Modern_Spanish_CI_AS NULL,
        period_from       DATE NULL,
        period_to         DATE NULL,
        /* Cancelar no borra: deja constancia de quien, cuando y por que. */
        voided_at         DATETIME2(0) NULL,
        voided_by         INT NULL,
        void_reason       NVARCHAR(200) COLLATE Modern_Spanish_CI_AS NULL,
        void_cash_movement_id INT NULL,
        CONSTRAINT PK_expenses PRIMARY KEY CLUSTERED (id),
        CONSTRAINT FK_expenses_category FOREIGN KEY (category_id) REFERENCES dbo.expense_categories (id),
        CONSTRAINT FK_expenses_user FOREIGN KEY (user_id) REFERENCES dbo.users (id),
        CONSTRAINT FK_expenses_staff FOREIGN KEY (staff_user_id) REFERENCES dbo.users (id),
        CONSTRAINT FK_expenses_register FOREIGN KEY (register_id) REFERENCES dbo.registers (id),
        CONSTRAINT FK_expenses_closure FOREIGN KEY (closure_id) REFERENCES dbo.cash_closures (id),
        CONSTRAINT FK_expenses_cash_movement FOREIGN KEY (cash_movement_id) REFERENCES dbo.cash_movements (id),
        CONSTRAINT FK_expenses_void_movement FOREIGN KEY (void_cash_movement_id) REFERENCES dbo.cash_movements (id),
        CONSTRAINT CK_expenses_amount CHECK (amount > 0),
        CONSTRAINT CK_expenses_method CHECK (payment_method IN ('EFECTIVO', 'TRANSFERENCIA', 'TARJETA', 'OTRO')),
        /* LA REGLA CENTRAL, en la tabla y no solo en el procedure: un egreso
           en efectivo SIEMPRE tiene su salida del cajon, y uno que no es en
           efectivo NUNCA la tiene. */
        CONSTRAINT CK_expenses_cash CHECK (
            (payment_method = 'EFECTIVO'  AND cash_movement_id IS NOT NULL AND register_id IS NOT NULL AND closure_id IS NOT NULL)
         OR (payment_method <> 'EFECTIVO' AND cash_movement_id IS NULL AND closure_id IS NULL)),
        CONSTRAINT CK_expenses_period_kind CHECK (period_kind IS NULL OR period_kind IN ('DIA', 'SEMANA', 'OTRO')),
        CONSTRAINT CK_expenses_period CHECK (period_from IS NULL OR period_to IS NULL OR period_from <= period_to),
        CONSTRAINT CK_expenses_void CHECK (voided_at IS NULL OR voided_by IS NOT NULL)
    );
    CREATE NONCLUSTERED INDEX IX_expenses_date ON dbo.expenses (expense_date) INCLUDE (category_id, amount, payment_method, voided_at);
    CREATE NONCLUSTERED INDEX IX_expenses_staff ON dbo.expenses (staff_user_id, expense_date) WHERE staff_user_id IS NOT NULL;
    CREATE NONCLUSTERED INDEX IX_expenses_closure ON dbo.expenses (closure_id) WHERE closure_id IS NOT NULL;
END;
GO
