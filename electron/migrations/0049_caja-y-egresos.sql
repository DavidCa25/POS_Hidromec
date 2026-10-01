/* ============================================================
   0049 — caja y egresos

   Generada con scripts/db/generar-migracion.mjs desde los archivos
   canonicos de sql/. No editar a mano: regenerar.

   Idempotente: todos los objetos usan CREATE OR ALTER, y los tipos
   comprueban su existencia antes de crearse. Se puede reejecutar.

   Incluye el bloque de esquema sql/schema/changes/0049_caja-y-egresos.sql (tablas,
   columnas, seed). Cada paso de ese bloque comprueba su existencia.
   ============================================================ */

/* ========== ESQUEMA: sql/schema/changes/0049_caja-y-egresos.sql ========== */
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

/* ---------- sp_cash_summary (SQL_STORED_PROCEDURE) ---------- */
/* sp_cash_summary
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* Resumen de caja de los ultimos @days dias + pagos a proveedores + egresos.
   0049: "entradas" era todo lo que no fuera WITHDRAW -incluidos el fondo
   inicial, las devoluciones y los pagos a proveedor, que son negativos- y
   "salidas" solo los retiros, en negativo. Ahora las dos son lo que dicen:
   dinero que entro y dinero que salio del cajon, en positivo, sin contar el
   fondo inicial (no es dinero que entre: es el mismo que ya estaba).
   Retiros y egresos se dan aparte: un retiro no es un gasto. */
CREATE OR ALTER PROCEDURE dbo.sp_cash_summary
    @days INT = 30
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @desde DATE = DATEADD(DAY, -@days, CAST(GETDATE() AS DATE));

    SELECT
        ISNULL(SUM(CASE WHEN typee <> 'OPENING' AND amount < 0 THEN -amount ELSE 0 END), 0) AS salidas,
        ISNULL(SUM(CASE WHEN typee <> 'OPENING' AND amount > 0 THEN amount ELSE 0 END), 0) AS entradas,
        ISNULL(SUM(CASE WHEN typee = 'WITHDRAW' THEN -amount ELSE 0 END), 0) AS retiros,
        SUM(CASE WHEN typee <> 'OPENING' THEN 1 ELSE 0 END) AS movimientos,
        (SELECT ISNULL(SUM(amount), 0) FROM dbo.supplier_payments
          WHERE datee >= @desde) AS pagos_proveedores,
        /* Todos los egresos, salgan o no del cajon (una renta por
           transferencia tambien es un egreso). Los cancelados no cuentan. */
        (SELECT ISNULL(SUM(amount), 0) FROM dbo.expenses
          WHERE expense_date >= @desde AND voided_at IS NULL) AS egresos
    FROM dbo.cash_movements
    WHERE datee >= @desde;
END
GO

/* ---------- sp_expense_category_list (SQL_STORED_PROCEDURE) ---------- */
/* sp_expense_category_list
 * Definicion canonica. No editar en SSMS: modificar este archivo y crear una
 * migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* Conceptos de egreso, en el orden que el negocio eligio. Con
   @include_inactive = 0 (lo que usa quien registra un egreso) solo salen los
   activos; la pantalla de administracion pide todos. */
CREATE OR ALTER PROCEDURE dbo.sp_expense_category_list
    @include_inactive BIT = 0
AS
BEGIN
    SET NOCOUNT ON;
    SELECT
        c.id, c.name, c.kind, c.is_system, c.active, c.sort_order,
        (SELECT COUNT(*) FROM dbo.expenses e WHERE e.category_id = c.id AND e.voided_at IS NULL) AS usos
    FROM dbo.expense_categories c
    WHERE @include_inactive = 1 OR c.active = 1
    ORDER BY c.sort_order, c.name;
END
GO

/* ---------- sp_expense_category_move (SQL_STORED_PROCEDURE) ---------- */
/* sp_expense_category_move
 * Definicion canonica. No editar en SSMS: modificar este archivo y crear una
 * migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* Sube (@direction = -1) o baja (+1) un concepto un lugar en la lista,
   intercambiando su orden con el vecino. Primero se renumera la lista de 10 en
   10 para que dos conceptos con el mismo orden no se queden trabados. */
CREATE OR ALTER PROCEDURE dbo.sp_expense_category_move
    @id        INT,
    @direction INT
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    BEGIN TRAN;

    ;WITH orden AS (
        SELECT id, ROW_NUMBER() OVER (ORDER BY sort_order, name) * 10 AS nuevo
          FROM dbo.expense_categories WITH (UPDLOCK, HOLDLOCK)
    )
    UPDATE c SET sort_order = o.nuevo
      FROM dbo.expense_categories c JOIN orden o ON o.id = c.id;

    DECLARE @mio INT = (SELECT sort_order FROM dbo.expense_categories WHERE id = @id);
    IF @mio IS NULL
    BEGIN
        ROLLBACK TRAN;
        RAISERROR('El concepto no existe.', 16, 1);
        RETURN;
    END

    DECLARE @vecino INT = CASE WHEN @direction < 0
        THEN (SELECT TOP 1 id FROM dbo.expense_categories WHERE sort_order < @mio ORDER BY sort_order DESC)
        ELSE (SELECT TOP 1 id FROM dbo.expense_categories WHERE sort_order > @mio ORDER BY sort_order ASC)
    END;

    IF @vecino IS NOT NULL
    BEGIN
        DECLARE @suyo INT = (SELECT sort_order FROM dbo.expense_categories WHERE id = @vecino);
        UPDATE dbo.expense_categories SET sort_order = @suyo, updated_at = SYSDATETIME() WHERE id = @id;
        UPDATE dbo.expense_categories SET sort_order = @mio,  updated_at = SYSDATETIME() WHERE id = @vecino;
    END

    COMMIT TRAN;
END
GO

/* ---------- sp_expense_category_save (SQL_STORED_PROCEDURE) ---------- */
/* sp_expense_category_save
 * Definicion canonica. No editar en SSMS: modificar este archivo y crear una
 * migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* ------------------------------------------------------------------------
   Crear o editar un concepto de egreso (Renta, Uber, Didi, Gas...).

   @id NULL  -> crea. Un concepto creado por el negocio siempre es GENERAL:
                "Pago al personal" (PERSONAL) lo trae el sistema y es el unico.
   @id dado  -> renombra, activa/desactiva y cambia el orden.

   No se borra nada: un concepto usado en egresos pasados se DESACTIVA, y los
   egresos siguen diciendo en que se gasto. El concepto del sistema se puede
   renombrar y reordenar, pero no desactivar: sin el no habria donde
   registrar un pago al personal.
   ------------------------------------------------------------------------ */
CREATE OR ALTER PROCEDURE dbo.sp_expense_category_save
    @id          INT = NULL,
    @name        NVARCHAR(60),
    @active      BIT = 1,
    @sort_order  INT = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    SET @name = LTRIM(RTRIM(ISNULL(@name, N'')));
    IF @name = N''
    BEGIN
        RAISERROR('El concepto necesita un nombre.', 16, 1);
        RETURN;
    END

    IF EXISTS (SELECT 1 FROM dbo.expense_categories WHERE name = @name AND (@id IS NULL OR id <> @id))
    BEGIN
        RAISERROR('Ya existe un concepto con ese nombre.', 16, 1);
        RETURN;
    END

    IF @id IS NULL
    BEGIN
        /* Nuevo: al final de la lista, salvo que se pida otro lugar. */
        IF @sort_order IS NULL
            SELECT @sort_order = ISNULL(MAX(sort_order), 0) + 10
              FROM dbo.expense_categories WHERE sort_order < 1000;
        INSERT INTO dbo.expense_categories (name, kind, is_system, active, sort_order)
        VALUES (@name, 'GENERAL', 0, ISNULL(@active, 1), @sort_order);
        SET @id = SCOPE_IDENTITY();
    END
    ELSE
    BEGIN
        IF NOT EXISTS (SELECT 1 FROM dbo.expense_categories WHERE id = @id)
        BEGIN
            RAISERROR('El concepto no existe.', 16, 1);
            RETURN;
        END
        IF ISNULL(@active, 1) = 0 AND EXISTS (SELECT 1 FROM dbo.expense_categories WHERE id = @id AND is_system = 1)
        BEGIN
            RAISERROR('Este concepto es del sistema y no se puede desactivar. Puedes cambiarle el nombre.', 16, 1);
            RETURN;
        END
        UPDATE dbo.expense_categories
           SET name = @name,
               active = ISNULL(@active, active),
               sort_order = ISNULL(@sort_order, sort_order),
               updated_at = SYSDATETIME()
         WHERE id = @id;
    END

    SELECT id, name, kind, is_system, active, sort_order
      FROM dbo.expense_categories WHERE id = @id;
END
GO

/* ---------- sp_expense_staff_list (SQL_STORED_PROCEDURE) ---------- */
/* sp_expense_staff_list
 * Definicion canonica. No editar en SSMS: modificar este archivo y crear una
 * migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* ------------------------------------------------------------------------
   Personas a las que se les puede registrar un pago: las de `users`, que es
   la entidad del personal en Wybix. No hay tabla de empleados aparte.

   Solo lo necesario para elegir a alguien: sin contrasena ni permisos. Salen
   las activas y, ademas, las inactivas que ya tienen pagos (para poder
   consultar su historial).
   ------------------------------------------------------------------------ */
CREATE OR ALTER PROCEDURE dbo.sp_expense_staff_list
AS
BEGIN
    SET NOCOUNT ON;
    SELECT u.id, u.usuario, u.rol, CAST(ISNULL(u.active, 1) AS BIT) AS active,
           (SELECT COUNT(*) FROM dbo.expenses e WHERE e.staff_user_id = u.id AND e.voided_at IS NULL) AS pagos
      FROM dbo.users u
     WHERE ISNULL(u.active, 1) = 1
        OR EXISTS (SELECT 1 FROM dbo.expenses e WHERE e.staff_user_id = u.id)
     ORDER BY CASE WHEN ISNULL(u.active, 1) = 1 THEN 0 ELSE 1 END, u.usuario;
END
GO

/* ---------- sp_get_cash_movements (SQL_STORED_PROCEDURE) ---------- */
/* sp_get_cash_movements
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* ------------------------------------------------------------------------
   Movimientos del cajon, su resumen y su DESGLOSE.

   0049:
   · El turno se arma con EXACTAMENTE la misma regla que sp_close_shift: los
     movimientos amarrados al turno y los sueltos de SU CAJA dentro de su
     horario. Antes los sueltos se buscaban por usuario, asi que el efectivo
     esperado que mostraba el corte podia no ser el que guardaba el cierre.
   · Las ventas por forma de pago son las de ESA caja en ese horario, no las
     del usuario que abrio el turno.
   · Tercer resultado: el desglose por grupo y concepto (Ventas, Abonos,
     Retiros, Proveedores, Egresos por concepto, Devoluciones, Ajustes...).
     Lo calcula SQL, con el catalogo cash_movement_types, para que la pantalla
     no clasifique tipos por su cuenta: todo lo que suma al esperado aparece.
   · Modo dia: acepta la caja (@register_id) y no cuenta el fondo inicial dos
     veces.
   ------------------------------------------------------------------------ */
CREATE OR ALTER PROCEDURE [dbo].[sp_get_cash_movements]
    @start_date   DATE = NULL,
    @end_date     DATE = NULL,
    @user_id      INT  = NULL,
    @typee        NVARCHAR(20) = NULL,
    @only_open    BIT  = 0,
    @closure_id   INT  = NULL,
    @register_id  INT  = NULL
AS
BEGIN
  SET NOCOUNT ON;

  DECLARE @now DATETIME2(0) = SYSDATETIME();

  /* Los movimientos elegidos, una sola vez, para que detalle, resumen y
     desglose salgan exactamente del mismo conjunto. */
  /* COLLATE explicito: una tabla temporal toma la collation de tempdb, y al
     cruzarla con cash_movement_types (Modern_Spanish_CI_AS) SQL Server no
     sabria cual usar. */
  CREATE TABLE #m (
      id INT PRIMARY KEY, datee DATETIME2(7), userId INT,
      typee VARCHAR(30) COLLATE Modern_Spanish_CI_AS,
      amount DECIMAL(12,2), reference_id INT,
      reference NVARCHAR(100) COLLATE Modern_Spanish_CI_AS,
      note NVARCHAR(200) COLLATE Modern_Spanish_CI_AS, closure_id INT, register_id INT);

  DECLARE @opening_cash DECIMAL(12,2) = 0;
  DECLARE @ventas_desde DATETIME2(7), @ventas_hasta DATETIME2(7), @ventas_caja INT;
  DECLARE @ventas_dia_desde DATE = NULL, @ventas_dia_hasta DATE = NULL;

  /* ===========================
     MODO TURNO (por closure_id)
     =========================== */
  IF @closure_id IS NOT NULL
  BEGIN
      DECLARE @shift_user_id INT, @opened_at DATETIME2(0), @closed_at DATETIME2(0), @caja INT;

      SELECT
          @shift_user_id = userId,
          @opened_at     = opened_at,
          @closed_at     = ISNULL(closed_at, @now),
          @opening_cash  = ISNULL(opening_cash,0),
          @caja          = register_id
      FROM dbo.cash_closures
      WHERE id = @closure_id;

      IF @shift_user_id IS NULL
      BEGIN
          RAISERROR('closure_id no existe.', 16, 1);
          RETURN;
      END

      IF @user_id IS NOT NULL AND @user_id <> @shift_user_id
      BEGIN
          RAISERROR('El closure_id no pertenece al user_id indicado.', 16, 1);
          RETURN;
      END

      INSERT INTO #m
      SELECT m.id, m.datee, m.userId, m.typee, m.amount, m.reference_id, m.reference, m.note, m.closure_id, m.register_id
      FROM dbo.cash_movements AS m
      WHERE
          (
              m.closure_id = @closure_id
              OR (m.closure_id IS NULL AND m.register_id = @caja AND m.datee >= @opened_at AND m.datee <= @closed_at)
          )
          AND (@typee IS NULL OR m.typee = @typee);

      SELECT @ventas_desde = @opened_at, @ventas_hasta = @closed_at, @ventas_caja = @caja;
  END
  ELSE
  BEGIN
  /* ===========================
     MODO DIA (por rango fechas)
     =========================== */
      IF @start_date IS NULL SET @start_date = CONVERT(DATE, @now);
      IF @end_date   IS NULL SET @end_date   = @start_date;

      INSERT INTO #m
      SELECT m.id, m.datee, m.userId, m.typee, m.amount, m.reference_id, m.reference, m.note, m.closure_id, m.register_id
      FROM dbo.cash_movements AS m
      WHERE CAST(m.datee AS DATE) BETWEEN @start_date AND @end_date
        AND (@user_id     IS NULL OR m.userId = @user_id)
        AND (@register_id IS NULL OR m.register_id = @register_id)
        AND (@typee       IS NULL OR m.typee  = @typee)
        AND (
              (@only_open = 1 AND m.closure_id IS NULL)
           OR (@only_open = 0)
            );

      /* El fondo inicial es el de los turnos abiertos en el rango (de esa
         caja, si se pidio una). Sale de cash_closures, no de sumar OPENING:
         antes se sumaban las dos cosas y el fondo contaba doble. */
      SELECT @opening_cash = ISNULL(SUM(opening_cash), 0)
        FROM dbo.cash_closures
       WHERE CAST(opened_at AS DATE) BETWEEN @start_date AND @end_date
         AND (@register_id IS NULL OR register_id = @register_id)
         AND (@user_id IS NULL OR userId = @user_id);

      SELECT @ventas_dia_desde = @start_date, @ventas_dia_hasta = @end_date, @ventas_caja = @register_id;
  END

  /* 1) Detalle, con su grupo y su concepto */
  SELECT
      m.id, m.datee, m.userId, u.usuario AS user_name, m.typee, m.amount,
      m.reference_id, m.reference, m.note, m.closure_id, m.register_id,
      ISNULL(t.grupo, 'OTROS') AS grupo,
      ISNULL(t.label, CAST(m.typee AS NVARCHAR(60))) AS tipo_label,
      CASE
          WHEN m.typee = 'EXPENSE' THEN ISNULL(ec.name, N'Egreso')
          WHEN m.typee = 'SUPPLIER_PAYMENT' THEN ISNULL(s.nombre, N'Proveedor')
          ELSE ISNULL(t.label, CAST(m.typee AS NVARCHAR(60)))
      END AS concepto
  FROM #m AS m
  LEFT JOIN dbo.users AS u ON u.id = m.userId
  LEFT JOIN dbo.cash_movement_types AS t ON t.code = m.typee
  LEFT JOIN dbo.expenses AS e ON m.typee = 'EXPENSE' AND (e.cash_movement_id = m.id OR e.void_cash_movement_id = m.id)
  LEFT JOIN dbo.expense_categories AS ec ON ec.id = e.category_id
  LEFT JOIN dbo.supplier_payments AS sp ON m.typee = 'SUPPLIER_PAYMENT' AND sp.id = m.reference_id
  LEFT JOIN dbo.CAT_suppliers AS s ON s.id = sp.supplier_id
  ORDER BY m.datee ASC, m.id ASC;

  /* 2) Resumen (mismas columnas de siempre) */
  SELECT
      ISNULL(SUM(CASE WHEN m.typee <> 'OPENING' AND m.amount >= 0 THEN m.amount ELSE 0 END), 0)  AS total_entradas,
      ISNULL(SUM(CASE WHEN m.typee <> 'OPENING' AND m.amount  < 0 THEN -m.amount ELSE 0 END), 0) AS total_salidas,
      ISNULL(SUM(CASE WHEN m.typee <> 'OPENING' THEN m.amount ELSE 0 END), 0)                    AS neto,
      @opening_cash                                                                              AS opening_cash,
      (ISNULL(SUM(CASE WHEN m.typee <> 'OPENING' THEN m.amount ELSE 0 END),0) + @opening_cash)   AS cash_expected,

      /* Ventas por forma de pago: las de ESTA caja en este periodo. Son
         informativas; lo que suma al esperado son los movimientos del cajon. */
      (SELECT ISNULL(SUM(s.total), 0) FROM dbo.sales s WHERE s.payment_method = 'EFECTIVO'      AND (@ventas_caja IS NULL OR s.register_id = @ventas_caja)
          AND ((@ventas_desde IS NOT NULL AND s.datee >= @ventas_desde AND s.datee <= @ventas_hasta) OR (@ventas_dia_desde IS NOT NULL AND CAST(s.datee AS DATE) BETWEEN @ventas_dia_desde AND @ventas_dia_hasta))
          AND (@user_id IS NULL OR @closure_id IS NOT NULL OR s.useer_id = @user_id)) AS ventas_efectivo,
      (SELECT ISNULL(SUM(s.total), 0) FROM dbo.sales s WHERE s.payment_method = 'TARJETA'       AND (@ventas_caja IS NULL OR s.register_id = @ventas_caja)
          AND ((@ventas_desde IS NOT NULL AND s.datee >= @ventas_desde AND s.datee <= @ventas_hasta) OR (@ventas_dia_desde IS NOT NULL AND CAST(s.datee AS DATE) BETWEEN @ventas_dia_desde AND @ventas_dia_hasta))
          AND (@user_id IS NULL OR @closure_id IS NOT NULL OR s.useer_id = @user_id)) AS ventas_tarjeta,
      (SELECT ISNULL(SUM(s.total), 0) FROM dbo.sales s WHERE s.payment_method = 'TRANSFERENCIA' AND (@ventas_caja IS NULL OR s.register_id = @ventas_caja)
          AND ((@ventas_desde IS NOT NULL AND s.datee >= @ventas_desde AND s.datee <= @ventas_hasta) OR (@ventas_dia_desde IS NOT NULL AND CAST(s.datee AS DATE) BETWEEN @ventas_dia_desde AND @ventas_dia_hasta))
          AND (@user_id IS NULL OR @closure_id IS NOT NULL OR s.useer_id = @user_id)) AS ventas_transferencia,
      (SELECT ISNULL(SUM(s.total), 0) FROM dbo.sales s WHERE s.payment_method = 'TERMINAL_MP'   AND (@ventas_caja IS NULL OR s.register_id = @ventas_caja)
          AND ((@ventas_desde IS NOT NULL AND s.datee >= @ventas_desde AND s.datee <= @ventas_hasta) OR (@ventas_dia_desde IS NOT NULL AND CAST(s.datee AS DATE) BETWEEN @ventas_dia_desde AND @ventas_dia_hasta))
          AND (@user_id IS NULL OR @closure_id IS NOT NULL OR s.useer_id = @user_id)) AS ventas_mp,
      (SELECT ISNULL(SUM(s.total), 0) FROM dbo.sales s WHERE s.payment_method = 'CREDITO'       AND (@ventas_caja IS NULL OR s.register_id = @ventas_caja)
          AND ((@ventas_desde IS NOT NULL AND s.datee >= @ventas_desde AND s.datee <= @ventas_hasta) OR (@ventas_dia_desde IS NOT NULL AND CAST(s.datee AS DATE) BETWEEN @ventas_dia_desde AND @ventas_dia_hasta))
          AND (@user_id IS NULL OR @closure_id IS NOT NULL OR s.useer_id = @user_id)) AS ventas_credito
  FROM #m AS m;

  /* 3) Desglose por grupo y concepto. Sin el fondo (va aparte, arriba del
        todo). Los egresos van por su concepto; lo demas por su tipo. La suma
        de `total` de todas las filas es exactamente `neto`. */
  SELECT
      ISNULL(t.grupo, 'OTROS') AS grupo,
      MIN(ISNULL(t.sort_order, 900)) AS orden,
      CASE WHEN m.typee = 'EXPENSE' THEN ISNULL(ec.name, N'Egreso')
           ELSE ISNULL(t.label, CAST(m.typee AS NVARCHAR(60))) END AS concepto,
      SUM(m.amount) AS total,
      COUNT(*) AS movimientos
  FROM #m AS m
  LEFT JOIN dbo.cash_movement_types AS t ON t.code = m.typee
  LEFT JOIN dbo.expenses AS e ON m.typee = 'EXPENSE' AND (e.cash_movement_id = m.id OR e.void_cash_movement_id = m.id)
  LEFT JOIN dbo.expense_categories AS ec ON ec.id = e.category_id
  WHERE m.typee <> 'OPENING'
  GROUP BY ISNULL(t.grupo, 'OTROS'),
           CASE WHEN m.typee = 'EXPENSE' THEN ISNULL(ec.name, N'Egreso')
                ELSE ISNULL(t.label, CAST(m.typee AS NVARCHAR(60))) END
  ORDER BY orden, concepto;
END
GO

/* ---------- sp_get_expenses (SQL_STORED_PROCEDURE) ---------- */
/* sp_get_expenses
 * Definicion canonica. No editar en SSMS: modificar este archivo y crear una
 * migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* ------------------------------------------------------------------------
   HISTORIAL Y REPORTE DE EGRESOS. Una sola consulta para las dos vistas:
   "Egresos" (todo) y "Pagos al personal" (@only_staff = 1). Es la misma
   fuente: un pago al personal ES un egreso, no hay una segunda tabla.

   Resultados:
     1. los egresos del periodo (con los cancelados solo si se piden);
     2. total por concepto;
     3. total por persona (solo pagos al personal);
     4. total por forma de pago;
     5. el total, y cuanto de eso salio del cajon.
   Los totales nunca cuentan cancelados.

   Las compras NO estan aqui: tienen su dominio (purchase / supplier_payments).
   Un reporte consolidado puede ponerlas al lado, pero la fuente es otra.
   ------------------------------------------------------------------------ */
CREATE OR ALTER PROCEDURE dbo.sp_get_expenses
    @date_from       DATE = NULL,
    @date_to         DATE = NULL,
    @category_id     INT = NULL,
    @payment_method  VARCHAR(20) = NULL,
    @staff_user_id   INT = NULL,
    @only_staff      BIT = 0,
    @register_id     INT = NULL,
    @include_voided  BIT = 0
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @hoy DATE = CAST(SYSDATETIME() AS DATE);
    IF @date_to IS NULL SET @date_to = @hoy;
    IF @date_from IS NULL SET @date_from = DATEFROMPARTS(YEAR(@date_to), MONTH(@date_to), 1);
    SET @payment_method = NULLIF(UPPER(LTRIM(RTRIM(@payment_method))), '');

    SELECT e.id
      INTO #sel
      FROM dbo.expenses e
      JOIN dbo.expense_categories c ON c.id = e.category_id
     WHERE e.expense_date BETWEEN @date_from AND @date_to
       AND (@category_id    IS NULL OR e.category_id = @category_id)
       AND (@payment_method IS NULL OR e.payment_method = @payment_method)
       AND (@staff_user_id  IS NULL OR e.staff_user_id = @staff_user_id)
       AND (@only_staff = 0 OR c.kind = 'PERSONAL')
       AND (@register_id    IS NULL OR e.register_id = @register_id);

    /* 1) Detalle */
    SELECT
        e.id, e.expense_date, e.created_at, e.category_id, c.name AS category_name, c.kind AS category_kind,
        e.amount, e.payment_method, e.note, e.beneficiary,
        e.staff_user_id, st.usuario AS staff_name, e.period_kind, e.period_from, e.period_to,
        e.user_id, u.usuario AS user_name,
        e.register_id, r.name AS register_name, e.closure_id, e.cash_movement_id,
        e.voided_at, vu.usuario AS voided_by_name, e.void_reason,
        CAST(CASE WHEN e.payment_method = 'EFECTIVO' AND e.voided_at IS NULL
                   AND EXISTS (SELECT 1 FROM dbo.cash_closures cc WHERE cc.id = e.closure_id AND cc.closed_at IS NULL)
                  THEN 1
                  WHEN e.payment_method <> 'EFECTIVO' AND e.voided_at IS NULL THEN 1
                  ELSE 0 END AS BIT) AS cancelable
    FROM #sel s
    JOIN dbo.expenses e ON e.id = s.id
    JOIN dbo.expense_categories c ON c.id = e.category_id
    LEFT JOIN dbo.users st ON st.id = e.staff_user_id
    LEFT JOIN dbo.users u  ON u.id = e.user_id
    LEFT JOIN dbo.users vu ON vu.id = e.voided_by
    LEFT JOIN dbo.registers r ON r.id = e.register_id
    WHERE @include_voided = 1 OR e.voided_at IS NULL
    ORDER BY e.expense_date DESC, e.id DESC;

    /* 2) Por concepto */
    SELECT c.id AS category_id, c.name AS category_name, c.kind AS category_kind,
           SUM(e.amount) AS total, COUNT(*) AS egresos
      FROM #sel s JOIN dbo.expenses e ON e.id = s.id
      JOIN dbo.expense_categories c ON c.id = e.category_id
     WHERE e.voided_at IS NULL
     GROUP BY c.id, c.name, c.kind, c.sort_order
     ORDER BY SUM(e.amount) DESC, c.name;

    /* 3) Por persona (pagos al personal) */
    SELECT e.staff_user_id, st.usuario AS staff_name,
           SUM(e.amount) AS total, COUNT(*) AS pagos,
           MIN(e.period_from) AS primer_periodo, MAX(e.period_to) AS ultimo_periodo
      FROM #sel s JOIN dbo.expenses e ON e.id = s.id
      JOIN dbo.users st ON st.id = e.staff_user_id
     WHERE e.voided_at IS NULL
     GROUP BY e.staff_user_id, st.usuario
     ORDER BY SUM(e.amount) DESC, st.usuario;

    /* 4) Por forma de pago */
    SELECT e.payment_method, SUM(e.amount) AS total, COUNT(*) AS egresos
      FROM #sel s JOIN dbo.expenses e ON e.id = s.id
     WHERE e.voided_at IS NULL
     GROUP BY e.payment_method
     ORDER BY SUM(e.amount) DESC;

    /* 5) Total */
    SELECT ISNULL(SUM(e.amount), 0) AS total,
           ISNULL(SUM(CASE WHEN e.payment_method = 'EFECTIVO' THEN e.amount ELSE 0 END), 0) AS del_cajon,
           COUNT(*) AS egresos,
           @date_from AS date_from, @date_to AS date_to
      FROM #sel s JOIN dbo.expenses e ON e.id = s.id
     WHERE e.voided_at IS NULL;
END
GO

/* ---------- sp_refund_sale (SQL_STORED_PROCEDURE) ---------- */
/* sp_refund_sale
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* -------------------- sp_refund_sale --------------------
   Devolucion / cambio. Lo que se repone al inventario es lo que ESA venta
   consumio realmente (inventory_movements ligados al producto vendido), por
   unidad devuelta: quantity / units. Un Latte devuelto repone cafe, leche,
   vaso y tapa segun la receta y modificadores DE ESE DIA, no la receta de
   hoy. Un producto DIRECT repone el propio producto (como siempre). Ventas
   anteriores a Wybix Core (sin movimientos ligados) reponen el producto.
   -------------------------------------------------------- */
CREATE OR ALTER PROCEDURE [dbo].[sp_refund_sale]
  @sale_id INT,
  @user_id INT,
  @payment_method NVARCHAR(50),
  @RefundDetails dbo.SaleDetailType READONLY,
  @note NVARCHAR(400) = NULL,
  @apply_net_update BIT = 1,
  -- 0049: la caja que DEVUELVE el efectivo. El turno se busca por caja, no
  -- por quien lo abrio: si devolvia otra persona fallaba con "no hay turno", y
  -- en MultiCaja el dinero podia salir del corte de otra caja.
  @register_id INT = NULL,
  @machine_id NVARCHAR(64) = NULL,
  @machine_name NVARCHAR(120) = NULL
AS
BEGIN
  SET NOCOUNT ON;
  SET XACT_ABORT ON;

  IF @sale_id IS NULL OR @sale_id <= 0
  BEGIN
    RAISERROR('sale_id inválido.',16,1);
    RETURN;
  END

  BEGIN TRY
    BEGIN TRAN;

    DECLARE @sale_total DECIMAL(12,2);
    DECLARE @sale_method NVARCHAR(50);
    DECLARE @customer_id INT;

    SELECT
      @sale_total = s.total,
      @sale_method = s.payment_method,
      @customer_id = s.customer_id
    FROM dbo.sales s WITH (UPDLOCK, HOLDLOCK)
    WHERE s.id = @sale_id;

    IF @sale_total IS NULL
    BEGIN
      RAISERROR('La venta no existe.',16,1);
    END

    ;WITH r AS (
      SELECT product_id, SUM(quantity) AS qty
      FROM @RefundDetails
      GROUP BY product_id
    )
    SELECT * INTO #req FROM r;

    SELECT d.product_id, SUM(d.quantity) AS sold_qty, MAX(d.unitary_price) AS price
    INTO #sold
    FROM dbo.sale_detail d WITH (UPDLOCK, HOLDLOCK)
    WHERE d.sale_id = @sale_id
    GROUP BY d.product_id;

    SELECT srd.product_id, SUM(srd.quantity) AS refunded_qty
    INTO #ref
    FROM dbo.sale_refunds sr
    JOIN dbo.sale_refund_detail srd ON srd.refund_id = sr.id
    WHERE sr.sale_id = @sale_id
    GROUP BY srd.product_id;

    IF EXISTS (
      SELECT 1
      FROM #req q
      LEFT JOIN #sold s ON s.product_id = q.product_id
      LEFT JOIN #ref  r2 ON r2.product_id = q.product_id
      WHERE ISNULL(s.sold_qty,0) - ISNULL(r2.refunded_qty,0) < q.qty
    )
    BEGIN
      RAISERROR('Reembolso inválido: excede lo vendido/disponible para devolver.',16,1);
    END

    DECLARE @refund_total DECIMAL(12,2);
    SELECT @refund_total = ISNULL(SUM(q.qty * s.price),0)
    FROM #req q
    JOIN #sold s ON s.product_id = q.product_id;

    IF @refund_total <= 0
    BEGIN
      RAISERROR('El total del reembolso debe ser mayor a cero.',16,1);
    END

    DECLARE @closure_id_open INT = NULL;
    DECLARE @caja INT = NULL;
    IF UPPER(@payment_method) = 'EFECTIVO'
    BEGIN
      EXEC dbo.sp_resolve_cash_register
          @register_id = @register_id, @machine_id = @machine_id,
          @machine_name = @machine_name, @user_id = @user_id, @resolved = @caja OUTPUT;
      IF @caja IS NULL
        RAISERROR('No se pudo determinar la caja de la que sale la devolucion. Abre el turno en esta caja e intenta de nuevo.',16,1);

      SELECT TOP(1) @closure_id_open = id
      FROM dbo.cash_closures WITH (UPDLOCK, HOLDLOCK)
      WHERE register_id = @caja AND closed_at IS NULL
      ORDER BY opened_at DESC, id DESC;

      IF @closure_id_open IS NULL
      BEGIN
        RAISERROR('No hay turno abierto para registrar el reembolso en efectivo.',16,1);
      END
    END

    DECLARE @refund_id INT;
    INSERT INTO dbo.sale_refunds (sale_id, user_id, payment_method, refund_total, note, closure_id)
    VALUES (@sale_id, @user_id, @payment_method, @refund_total, @note, @closure_id_open);

    SET @refund_id = SCOPE_IDENTITY();

    INSERT INTO dbo.sale_refund_detail (refund_id, product_id, quantity, unitary_price)
    SELECT
      @refund_id,
      q.product_id,
      q.qty,
      s.price
    FROM #req q
    JOIN #sold s ON s.product_id = q.product_id;

    /* ---- Que repone cada producto devuelto: consumo REAL de esta venta ---- */
    SELECT q.product_id AS sold_product_id, m.product_id, SUM(m.quantity) AS consumed, SUM(m.units) AS units
    INTO #consumo
    FROM #req q
    JOIN dbo.inventory_movements m
      ON m.reference = CAST(@sale_id AS NVARCHAR(50))
     AND m.sold_product_id = q.product_id
     AND m.typee = 'salida'
     AND m.source IN ('SALE', 'RECIPE')
    GROUP BY q.product_id, m.product_id
    HAVING SUM(m.units) > 0;

    /* Ventas sin movimientos ligados (anteriores a Wybix Core): el propio producto. */
    INSERT INTO #consumo (sold_product_id, product_id, consumed, units)
    SELECT q.product_id, q.product_id, 1, 1
    FROM #req q
    JOIN dbo.products p ON p.id = q.product_id
    WHERE p.inventory_mode = 'DIRECT'
      AND NOT EXISTS (SELECT 1 FROM #consumo c WHERE c.sold_product_id = q.product_id);

    SELECT c.product_id,
           c.sold_product_id,
           CAST(q.qty * c.consumed / c.units AS DECIMAL(14,4)) AS qty,
           q.qty AS units
    INTO #restore
    FROM #consumo c
    JOIN #req q ON q.product_id = c.sold_product_id;

    UPDATE p
    SET p.stock = p.stock + r.qty
    FROM dbo.products p
    JOIN (SELECT product_id, SUM(qty) AS qty FROM #restore GROUP BY product_id) r ON r.product_id = p.id;

    INSERT INTO dbo.inventory_movements
      (product_id, typee, reference, quantity, datee, descriptionn, source, sold_product_id, units, unit_cost)
    SELECT
      r.product_id,
      'entrada',
      CAST(@sale_id AS NVARCHAR(50)),
      r.qty,
      GETDATE(),
      CONCAT('Reembolso venta ', @sale_id, ' (refund_id ', @refund_id, ')', COALESCE(CONCAT(' - ', @note), '')),
      'REFUND',
      r.sold_product_id,
      r.units,
      p.cost
    FROM #restore r
    JOIN dbo.products p ON p.id = r.product_id;

    IF UPPER(@payment_method)='EFECTIVO'
    BEGIN
      INSERT INTO dbo.cash_movements
        (datee, userId, typee, reference_id, reference, amount, note, closure_id, register_id)
      VALUES
        (GETDATE(), @user_id, 'REFUND', @sale_id,
         CONCAT('Reembolso Venta ', @sale_id, ' (', @refund_id, ')'),
         -@refund_total,
         @note,
         @closure_id_open,
         @caja);
    END

    IF @apply_net_update = 1
    BEGIN
      UPDATE d
      SET d.quantity = d.quantity - q.qty
      FROM dbo.sale_detail d
      JOIN #req q ON q.product_id = d.product_id
      WHERE d.sale_id = @sale_id;

      DELETE FROM dbo.sale_detail
      WHERE sale_id = @sale_id AND quantity <= 0;

      UPDATE dbo.sales
      SET total = total - @refund_total,
          paid_amount = CASE WHEN @customer_id IS NULL THEN (total - @refund_total) ELSE paid_amount END,
          balance = CASE WHEN @customer_id IS NULL THEN 0 ELSE (balance - @refund_total) END
      WHERE id = @sale_id;
    END

    COMMIT TRAN;

    SELECT
      @refund_id AS refund_id,
      @sale_id AS sale_id,
      @refund_total AS refund_total,
      @closure_id_open AS closure_id;
  END TRY
  BEGIN CATCH
    IF XACT_STATE() <> 0 ROLLBACK TRAN;
    DECLARE @msg NVARCHAR(4000) = ERROR_MESSAGE();
    RAISERROR(@msg,16,1);
  END CATCH
END
GO

/* ---------- sp_register_cash_out (SQL_STORED_PROCEDURE) ---------- */
/* sp_register_cash_out
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* ====================== sp_register_cash_out ====================== */
/* RETIRO DE CAJA. Dinero que cambia de lugar (al dueno, al banco): no es un
   gasto y sigue siendo WITHDRAW. Un gasto va por sp_register_expense y un
   pago a proveedor por sp_register_supplier_payment.
   0049: la caja ya no cae a "la primera de la tabla"; la decide
   sp_resolve_cash_register, igual que el resto del dinero. */
CREATE OR ALTER PROCEDURE [dbo].[sp_register_cash_out]
  @user_id       INT,
  @amount        DECIMAL(10,2),
  @note          NVARCHAR(255),
  @register_id   INT = NULL,            -- multicaja
  @machine_id    NVARCHAR(64) = NULL,
  @machine_name  NVARCHAR(120) = NULL
AS
BEGIN
  SET NOCOUNT ON;
  SET XACT_ABORT ON;
  DECLARE @cash_id INT;

  BEGIN TRY
    BEGIN TRAN;
    IF (@amount IS NULL OR @amount <= 0)
      RAISERROR('El monto debe ser mayor a cero.',16,1);
    IF (LTRIM(RTRIM(ISNULL(@note,''))) = '')
      RAISERROR('La nota es obligatoria.',16,1);

    DECLARE @caja INT;
    EXEC dbo.sp_resolve_cash_register
        @register_id = @register_id, @machine_id = @machine_id,
        @machine_name = @machine_name, @user_id = @user_id, @resolved = @caja OUTPUT;
    IF @caja IS NULL
      RAISERROR('No se pudo determinar la caja del retiro. Abre el turno en esta caja e intenta de nuevo.',16,1);
    SET @register_id = @caja;

    DECLARE @closure_id_open INT;
    SELECT TOP(1) @closure_id_open = id
    FROM dbo.cash_closures WITH (UPDLOCK, HOLDLOCK)
    WHERE register_id = @register_id
      AND closed_at IS NULL
    ORDER BY opened_at DESC, id DESC;

    IF @closure_id_open IS NULL
      RAISERROR('No hay un turno abierto en esta caja para registrar salida de efectivo.',16,1);

    INSERT INTO cash_movements(
      datee, userId, typee, reference_id, reference, amount, note, closure_id, register_id
    )
    VALUES(
      GETDATE(), @user_id, 'WITHDRAW', NULL, 'SALIDA CAJA', -@amount, @note, @closure_id_open, @register_id
    );

    SET @cash_id = SCOPE_IDENTITY();
    COMMIT TRAN;

    SELECT
      @cash_id AS cash_movement_id,
      @closure_id_open AS closure_id,
      @register_id AS register_id;
  END TRY
  BEGIN CATCH
    IF XACT_STATE() <> 0 ROLLBACK TRAN;
    DECLARE @msg NVARCHAR(4000) = ERROR_MESSAGE();
    RAISERROR(@msg, 16, 1);
  END CATCH
END
GO

/* ---------- sp_register_customer_payment (SQL_STORED_PROCEDURE) ---------- */
/* sp_register_customer_payment
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
CREATE OR ALTER PROCEDURE dbo.sp_register_customer_payment
    @customer_id    INT,
    @sale_id        INT,
    @amount         DECIMAL(10,2),
    @user_id        INT,
    @payment_method NVARCHAR(50),     -- EFECTIVO / TARJETA / TRANSFERENCIA
    @note           NVARCHAR(255) = NULL,
    @register_id    INT = NULL,       -- 0049: la caja que recibe el efectivo
    @machine_id     NVARCHAR(64) = NULL,
    @machine_name   NVARCHAR(120) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    /* 0049: SOLO EL EFECTIVO ENTRA AL CAJON. Antes cada abono -tambien con
       tarjeta o transferencia- dejaba un PAYMENT en la caja, sin caja ni
       turno: el corte esperaba dinero que nunca estuvo en el cajon y reportaba
       un faltante inexistente. En MultiCaja ademas caia en la Caja 1. */
    DECLARE @currentBalance DECIMAL(10,2);
    DECLARE @paidAmount     DECIMAL(10,2);
    DECLARE @saleMethod     NVARCHAR(50);
    DECLARE @payment_id     INT;
    DECLARE @metodo         NVARCHAR(50) = UPPER(LTRIM(RTRIM(ISNULL(@payment_method, N''))));
    DECLARE @caja           INT = NULL;
    DECLARE @closure_id     INT = NULL;
    DECLARE @cash_id        INT = NULL;

    IF @amount <= 0
    BEGIN
        RAISERROR('El monto del abono debe ser mayor a 0.', 16, 1);
        RETURN;
    END

    BEGIN TRY
        BEGIN TRAN;

        -- 1) Traer la venta y bloquearla mientras se actualiza
        SELECT TOP 1
            @currentBalance = balance,
            @paidAmount     = paid_amount,
            @saleMethod     = payment_method
        FROM sales WITH (UPDLOCK, HOLDLOCK)
        WHERE id = @sale_id
          AND customer_id = @customer_id;

        IF @currentBalance IS NULL
        BEGIN
            RAISERROR('La venta indicada no existe o no pertenece al cliente.', 16, 1);
            ROLLBACK TRAN;
            RETURN;
        END

        IF UPPER(@saleMethod) <> 'CREDITO'
        BEGIN
            RAISERROR('Solo se pueden registrar abonos sobre ventas a crédito.', 16, 1);
            ROLLBACK TRAN;
            RETURN;
        END

        IF @currentBalance <= 0
        BEGIN
            RAISERROR('La venta ya está totalmente liquidada.', 16, 1);
            ROLLBACK TRAN;
            RETURN;
        END

        IF @amount > @currentBalance
        BEGIN
            RAISERROR('El monto del abono no puede ser mayor al saldo pendiente.', 16, 1);
            ROLLBACK TRAN;
            RETURN;
        END

        -- 2) Actualizar la venta
        UPDATE sales
        SET paid_amount = paid_amount + @amount,
            balance     = balance - @amount
        WHERE id = @sale_id;

        -- 3) Registrar el pago
        INSERT INTO customer_payments
        (
            customer_id,
            sale_id,
            datee,
            amount,
            user_id,
            payment_method,
            note
        )
        VALUES
        (
            @customer_id,
            @sale_id,
            SYSDATETIME(),
            @amount,
            @user_id,
            @payment_method,
            @note
        );

        SET @payment_id = SCOPE_IDENTITY();

        -- 4) Movimiento de caja: SOLO si el abono fue en efectivo, en el turno
        --    abierto de la caja que lo recibe.
        IF @metodo = 'EFECTIVO'
        BEGIN
            EXEC dbo.sp_resolve_cash_register
                @register_id = @register_id, @machine_id = @machine_id,
                @machine_name = @machine_name, @user_id = @user_id, @resolved = @caja OUTPUT;
            IF @caja IS NULL
                RAISERROR('No se pudo determinar la caja que recibe el efectivo. Abre el turno en esta caja e intenta de nuevo.', 16, 1);

            SELECT TOP (1) @closure_id = id
              FROM dbo.cash_closures WITH (UPDLOCK, HOLDLOCK)
             WHERE register_id = @caja AND closed_at IS NULL
             ORDER BY opened_at DESC, id DESC;
            IF @closure_id IS NULL
                RAISERROR('Para recibir un abono en efectivo hace falta un turno abierto en esta caja.', 16, 1);

            INSERT INTO cash_movements
                (datee, userId, typee, reference_id, reference, amount, note, closure_id, register_id)
            VALUES
                (SYSDATETIME(), @user_id, 'PAYMENT', @payment_id,
                 CONCAT('Abono venta ', @sale_id, ' cliente ', @customer_id),
                 @amount, @note, @closure_id, @caja);
            SET @cash_id = SCOPE_IDENTITY();
        END

        COMMIT TRAN;

        -- 5) Regresar datos útiles
        SELECT
            @payment_id AS payment_id,
            @sale_id    AS sale_id,
            @customer_id AS customer_id,
            @amount     AS amount,
            (SELECT balance FROM sales WHERE id = @sale_id) AS new_balance,
            @cash_id    AS cash_movement_id,
            @closure_id AS closure_id,
            @caja       AS register_id;

    END TRY
    BEGIN CATCH
        IF XACT_STATE() <> 0 ROLLBACK TRAN;
        DECLARE @msg NVARCHAR(4000) = ERROR_MESSAGE();
        RAISERROR(@msg, 16, 1);
    END CATCH
END;
GO

/* ---------- sp_register_expense (SQL_STORED_PROCEDURE) ---------- */
/* sp_register_expense
 * Definicion canonica. No editar en SSMS: modificar este archivo y crear una
 * migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* ------------------------------------------------------------------------
   REGISTRAR UN EGRESO (y un PAGO AL PERSONAL, que es un egreso de concepto
   "Pago al personal" ligado a una persona).

   LA REGLA CENTRAL
     EFECTIVO   sale del cajon: exige turno abierto en ESA caja y deja un
                cash_movement negativo (typee EXPENSE) amarrado a ese turno.
                Todo en una transaccion: o quedan el egreso y la salida, o no
                queda nada. Baja el efectivo esperado del corte.
     otro medio (TRANSFERENCIA, TARJETA, OTRO) se registra el egreso y NO
                toca el cajon ni el corte.
   La tabla lo exige tambien (CK_expenses_cash): no se puede escribir un
   egreso en efectivo sin su salida del cajon.

   PAGO AL PERSONAL (concepto PERSONAL)
     Exige la persona (@staff_user_id, de `users`: la entidad del personal en
     Wybix) y el tipo de periodo:
       DIA     si no se dan fechas, el periodo es el dia del pago;
       SEMANA  si no se dan fechas, la semana (lunes a domingo) del pago;
       OTRO    las dos fechas son obligatorias.
     No es nomina: no hay percepciones, deducciones ni impuestos. Es dejar
     constancia de cuanto se le pago a quien y por que periodo.
   Un concepto que NO es de personal no admite persona ni periodo: un Uber no
   se le paga a un empleado del sistema.

   Un egreso en efectivo sale HOY del cajon, asi que su fecha es la de hoy.
   Uno por transferencia puede capturarse despues con la fecha que tuvo.
   ------------------------------------------------------------------------ */
CREATE OR ALTER PROCEDURE dbo.sp_register_expense
    @user_id         INT,
    @category_id     INT,
    @amount          DECIMAL(12,2),
    @payment_method  VARCHAR(20),
    @expense_date    DATE = NULL,
    @note            NVARCHAR(255) = NULL,
    @beneficiary     NVARCHAR(120) = NULL,
    @staff_user_id   INT = NULL,
    @period_kind     VARCHAR(10) = NULL,
    @period_from     DATE = NULL,
    @period_to       DATE = NULL,
    @register_id     INT = NULL,
    @machine_id      NVARCHAR(64) = NULL,
    @machine_name    NVARCHAR(120) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    DECLARE @hoy DATE = CAST(SYSDATETIME() AS DATE);
    DECLARE @metodo VARCHAR(20) = UPPER(LTRIM(RTRIM(ISNULL(@payment_method, ''))));
    DECLARE @kind VARCHAR(10), @cat_name NVARCHAR(60), @cat_active BIT;
    DECLARE @caja INT = NULL, @closure_id INT = NULL, @cash_id INT = NULL, @expense_id INT;

    SET @note = NULLIF(LTRIM(RTRIM(@note)), N'');
    SET @beneficiary = NULLIF(LTRIM(RTRIM(@beneficiary)), N'');
    SET @period_kind = NULLIF(UPPER(LTRIM(RTRIM(@period_kind))), '');

    BEGIN TRY
        BEGIN TRAN;

        IF @amount IS NULL OR @amount <= 0
            RAISERROR('El monto del egreso debe ser mayor a cero.', 16, 1);
        IF @metodo NOT IN ('EFECTIVO', 'TRANSFERENCIA', 'TARJETA', 'OTRO')
            RAISERROR('Forma de pago no valida para un egreso.', 16, 1);

        SELECT @kind = kind, @cat_name = name, @cat_active = active
          FROM dbo.expense_categories WHERE id = @category_id;
        IF @kind IS NULL
            RAISERROR('El concepto de egreso no existe.', 16, 1);
        IF @cat_active = 0
            RAISERROR('Ese concepto esta desactivado. Activalo o elige otro.', 16, 1);

        IF @expense_date IS NULL SET @expense_date = @hoy;
        IF @metodo = 'EFECTIVO' AND @expense_date <> @hoy
            RAISERROR('Un egreso en efectivo sale hoy del cajon: su fecha es la de hoy. Si lo pagaste otro dia, registralo con la forma de pago que tuvo.', 16, 1);
        IF @expense_date > @hoy
            RAISERROR('La fecha del egreso no puede ser futura.', 16, 1);

        /* ---------------- pago al personal ---------------- */
        IF @kind = 'PERSONAL'
        BEGIN
            IF @staff_user_id IS NULL
                RAISERROR('Elige a quien se le paga.', 16, 1);
            IF NOT EXISTS (SELECT 1 FROM dbo.users WHERE id = @staff_user_id)
                RAISERROR('La persona elegida no existe.', 16, 1);
            IF @period_kind IS NULL OR @period_kind NOT IN ('DIA', 'SEMANA', 'OTRO')
                RAISERROR('Indica el periodo que se paga: dia, semana u otro.', 16, 1);

            IF @period_kind = 'DIA'
            BEGIN
                SET @period_from = ISNULL(@period_from, @expense_date);
                SET @period_to   = ISNULL(@period_to, @period_from);
            END
            ELSE IF @period_kind = 'SEMANA' AND (@period_from IS NULL OR @period_to IS NULL)
            BEGIN
                /* Lunes de la semana del pago, sin depender de DATEFIRST. */
                DECLARE @base DATE = ISNULL(@period_from, @expense_date);
                SET @period_from = DATEADD(DAY, -((DATEDIFF(DAY, '19000101', @base)) % 7), @base);
                SET @period_to   = DATEADD(DAY, 6, @period_from);
            END
            ELSE IF @period_kind = 'OTRO' AND (@period_from IS NULL OR @period_to IS NULL)
                RAISERROR('Para un periodo "otro" indica desde y hasta que fecha se paga.', 16, 1);

            IF @period_from > @period_to
                RAISERROR('El periodo pagado esta al reves: "desde" es posterior a "hasta".', 16, 1);
        END
        ELSE
        BEGIN
            IF @staff_user_id IS NOT NULL
                RAISERROR('Solo un pago al personal va ligado a una persona. Elige el concepto "pago al personal".', 16, 1);
            SELECT @period_kind = NULL, @period_from = NULL, @period_to = NULL;
        END

        /* ---------------- efectivo: sale del cajon ---------------- */
        IF @metodo = 'EFECTIVO'
        BEGIN
            EXEC dbo.sp_resolve_cash_register
                @register_id = @register_id, @machine_id = @machine_id,
                @machine_name = @machine_name, @user_id = @user_id, @resolved = @caja OUTPUT;
            IF @caja IS NULL
                RAISERROR('No se pudo determinar la caja de la que sale el efectivo. Abre el turno en esta caja e intenta de nuevo.', 16, 1);

            SELECT TOP (1) @closure_id = id
              FROM dbo.cash_closures WITH (UPDLOCK, HOLDLOCK)
             WHERE register_id = @caja AND closed_at IS NULL
             ORDER BY opened_at DESC, id DESC;
            IF @closure_id IS NULL
                RAISERROR('Para pagar en efectivo hace falta un turno abierto en esta caja.', 16, 1);

            INSERT INTO dbo.cash_movements (datee, userId, typee, reference_id, reference, amount, note, closure_id, register_id)
            VALUES (GETDATE(), @user_id, 'EXPENSE', NULL, LEFT(CONCAT(N'Egreso: ', @cat_name), 100),
                    -@amount, LEFT(@note, 200), @closure_id, @caja);
            SET @cash_id = SCOPE_IDENTITY();
        END
        ELSE
            /* Fuera del cajon la caja es solo informativa: se guarda si se dio. */
            SET @caja = @register_id;

        INSERT INTO dbo.expenses (
            expense_date, category_id, amount, payment_method, note, user_id,
            register_id, closure_id, cash_movement_id, beneficiary,
            staff_user_id, period_kind, period_from, period_to)
        VALUES (
            @expense_date, @category_id, @amount, @metodo, @note, @user_id,
            @caja, @closure_id, @cash_id, @beneficiary,
            @staff_user_id, @period_kind, @period_from, @period_to);
        SET @expense_id = SCOPE_IDENTITY();

        IF @cash_id IS NOT NULL
            UPDATE dbo.cash_movements SET reference_id = @expense_id WHERE id = @cash_id;

        COMMIT TRAN;

        SELECT @expense_id AS expense_id, @cash_id AS cash_movement_id,
               @closure_id AS closure_id, @caja AS register_id,
               @period_from AS period_from, @period_to AS period_to;
    END TRY
    BEGIN CATCH
        IF XACT_STATE() <> 0 ROLLBACK TRAN;
        DECLARE @msg NVARCHAR(4000) = ERROR_MESSAGE();
        RAISERROR(@msg, 16, 1);
    END CATCH
END
GO

/* ---------- sp_register_purchase (SQL_STORED_PROCEDURE) ---------- */
/* sp_register_purchase
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
-- Registra una compra. Sigue siendo LA UNICA ruta de compra: los
-- ingredientes de Hospitality entran por aqui.
--
-- Transicion ADITIVA (SQL Server no permite ALTER TYPE): se aceptan
-- @PurchaseDetails (tipo v1, sin presentacion) y @PurchaseDetails2 (v2, con
-- presentation_id). quantity y unit_price van en la PRESENTACION capturada
-- (5 bolsas a $200); factor_to_base convierte a la unidad base del producto
-- (+5000 g). Sin presentacion el factor es 1 y todo queda como antes.
--
-- Costo: products.cost = costo por unidad BASE (unit_price / factor). Es el
-- "ultimo costo", la fuente instantanea de V1 (sin promedio ponderado).
--
-- FORMA DE PAGO (@payment_method). Una compra es un documento del proveedor;
-- el dinero es otra cosa:
--   CREDITO        queda a deber. balance = total, PENDIENTE. No toca la caja.
--   EFECTIVO       sale del cajon: exige turno abierto y deja el movimiento
--                  colgado de ESE turno, para que salga en el corte.
--   TARJETA        pagadas, pero el efectivo del cajon no se mueve: se
--   TRANSFERENCIA  registra el pago al proveedor y nada mas.
-- Asi el corte cuadra con lo que hay fisicamente en el cajon, y la cuenta por
-- pagar vive en purchase.balance / supplier_payments.
CREATE OR ALTER PROCEDURE dbo.sp_register_purchase
    @user_id     INT,
    @supplier_id INT,
    @subtotal    DECIMAL(10,2),
    @tax_rate    DECIMAL(5,2),
    @tax_amount  DECIMAL(10,2),
    @total       DECIMAL(10,2),
    @PurchaseDetails  dbo.PurchaseDetailType READONLY,
    @PurchaseDetails2 dbo.PurchaseDetailType2 READONLY,
    @payment_method NVARCHAR(20) = 'CREDITO',
    @register_id    INT = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    IF (@supplier_id IS NULL)
    BEGIN
        RAISERROR('La compra requiere un proveedor.', 16, 1);
        RETURN;
    END

    DECLARE @metodo NVARCHAR(20) = UPPER(LTRIM(RTRIM(ISNULL(@payment_method, 'CREDITO'))));
    IF @metodo NOT IN ('CREDITO', 'EFECTIVO', 'TARJETA', 'TRANSFERENCIA')
    BEGIN
        RAISERROR('Forma de pago no valida para una compra.', 16, 1);
        RETURN;
    END

    -- El efectivo sale del cajon: sin turno abierto no hay de donde sacarlo, y
    -- el movimiento quedaria fuera de todo corte. La caja la decide
    -- sp_resolve_cash_register (ya no "la primera de la tabla").
    DECLARE @closure_id INT = NULL;
    IF @metodo = 'EFECTIVO'
    BEGIN
        DECLARE @caja INT;
        EXEC dbo.sp_resolve_cash_register
            @register_id = @register_id, @user_id = @user_id, @resolved = @caja OUTPUT;
        IF @caja IS NULL
        BEGIN
            RAISERROR('No se pudo determinar la caja de la que sale el efectivo. Abre el turno en esta caja e intenta de nuevo.', 16, 1);
            RETURN;
        END
        SET @register_id = @caja;

        SELECT TOP (1) @closure_id = id
        FROM dbo.cash_closures
        WHERE register_id = @register_id
          AND closed_at IS NULL
        ORDER BY opened_at DESC, id DESC;

        IF @closure_id IS NULL
        BEGIN
            RAISERROR('Para pagar una compra en efectivo hace falta un turno abierto en esta caja.', 16, 1);
            RETURN;
        END
    END

    DECLARE @rows TABLE (
        rn INT IDENTITY(1,1) NOT NULL,
        product_id INT NOT NULL,
        quantity DECIMAL(12,2) NOT NULL,
        unit_price DECIMAL(10,2) NOT NULL,
        profit_percent DECIMAL(5,2) NOT NULL,
        presentation_id INT NULL,
        factor DECIMAL(14,4) NULL
    );

    INSERT INTO @rows (product_id, quantity, unit_price, profit_percent, presentation_id, factor)
    SELECT product_id, quantity, unit_price,
           CASE WHEN ISNULL(profit_percent, 0) < 0 THEN 0 ELSE ISNULL(profit_percent, 0) END,
           NULL, 1
    FROM @PurchaseDetails
    UNION ALL
    SELECT product_id, quantity, unit_price,
           CASE WHEN ISNULL(profit_percent, 0) < 0 THEN 0 ELSE ISNULL(profit_percent, 0) END,
           presentation_id, CASE WHEN presentation_id IS NULL THEN 1 ELSE NULL END
    FROM @PurchaseDetails2;

    IF NOT EXISTS (SELECT 1 FROM @rows)
    BEGIN
        RAISERROR('La compra no tiene partidas.', 16, 1);
        RETURN;
    END

    -- Presentacion: debe existir y pertenecer al producto de la linea.
    UPDATE r SET factor = pp.factor_to_base
    FROM @rows r
    JOIN dbo.product_presentations pp ON pp.id = r.presentation_id AND pp.product_id = r.product_id;

    IF EXISTS (SELECT 1 FROM @rows WHERE factor IS NULL)
    BEGIN
        RAISERROR('Una presentacion de compra no corresponde al producto de la linea.', 16, 1);
        RETURN;
    END

    IF EXISTS (SELECT 1 FROM @rows r LEFT JOIN dbo.products p ON p.id = r.product_id WHERE p.id IS NULL)
    BEGIN
        RAISERROR('Un producto de la compra no existe.', 16, 1);
        RETURN;
    END

    BEGIN TRY
        BEGIN TRAN;

        DECLARE @saldo DECIMAL(10,2) = CASE WHEN @metodo = 'CREDITO' THEN @total ELSE 0 END;

        -- Cabecera: proveedor unico de la compra
        DECLARE @purchase_id INT;
        INSERT INTO purchase (datee, useer_id, total, tax_rate, tax_amount, supplier_id, balance, payment_status)
        VALUES (GETDATE(), @user_id, @total, @tax_rate, @tax_amount, @supplier_id, @saldo,
                CASE WHEN @metodo = 'CREDITO' THEN 'PENDIENTE' ELSE 'PAGADO' END);
        SET @purchase_id = SCOPE_IDENTITY();

        -- Mismo proveedor en la linea (compatibilidad con sp_get_purchases)
        INSERT INTO purchase_detail (
            puchase_id, product_id, supplier_id, quantity, unitary_price, profit_percent,
            presentation_id, factor_to_base
        )
        SELECT @purchase_id, product_id, @supplier_id, quantity, unit_price, profit_percent,
               presentation_id, factor
        FROM @rows
        ORDER BY rn;

        -- Costo y precio de venta: solo lineas con precio; si un producto
        -- viene varias veces, manda la ultima (como hacia el cursor).
        ;WITH ult AS (
            SELECT r.*, ROW_NUMBER() OVER (PARTITION BY r.product_id ORDER BY r.rn DESC) AS k
            FROM @rows r
            WHERE r.unit_price > 0
        )
        UPDATE p
        SET cost  = CAST(u.unit_price / u.factor AS DECIMAL(14,4)),
            -- El precio de venta solo tiene sentido en lo que se vende. Un
            -- ingrediente (sellable = 0) no se cobra en caja: escribirle un
            -- precio solo ensucia el inventario con "$0.30" por gramo.
            price = CASE WHEN p.sellable = 0 THEN p.price ELSE ROUND(
                      -- Costo SIN IVA -> precio de venta CON IVA (0 si no es objeto de IVA)
                      (u.unit_price / u.factor)
                      * (1 + CASE WHEN ISNULL(p.objeto_impuesto, '02') <> '02' THEN 0
                                  ELSE ISNULL(p.tasa_iva, @tax_rate) END)
                      * (1 + (u.profit_percent / 100.0)), 2) END
        FROM products p
        JOIN ult u ON u.product_id = p.id
        WHERE u.k = 1;

        -- Stock en unidad base
        UPDATE p
        SET stock = p.stock + s.qty
        FROM products p
        JOIN (SELECT product_id, SUM(quantity * factor) AS qty FROM @rows GROUP BY product_id) s
          ON s.product_id = p.id;

        INSERT INTO inventory_movements (
            product_id, typee, reference, quantity, datee, descriptionn, source, unit_cost
        )
        SELECT product_id, 'entrada', CAST(@purchase_id AS NVARCHAR(50)),
               quantity * factor, GETDATE(), 'Compra', 'PURCHASE',
               CASE WHEN unit_price > 0 THEN CAST(unit_price / factor AS DECIMAL(14,4)) ELSE NULL END
        FROM @rows
        ORDER BY rn;

        -- Pago. A credito no hay nada que registrar aqui: la deuda ya quedo
        -- en purchase.balance y se salda por sp_register_supplier_payment.
        -- El pago y su salida del cajon (solo si es efectivo) los escribe la
        -- logica unica de pago a proveedor, dentro de ESTA transaccion.
        DECLARE @payment_id INT = NULL, @cash_id INT = NULL, @closure_pago INT = NULL;
        IF @metodo <> 'CREDITO' AND ISNULL(@total, 0) > 0
        BEGIN
            DECLARE @nota_pago NVARCHAR(255) = CONCAT('Pago de la compra ', @purchase_id);
            DECLARE @ref_pago NVARCHAR(100) = CONCAT('Compra ', @purchase_id);
            EXEC dbo.sp_supplier_payment_apply
                @user_id = @user_id, @supplier_id = @supplier_id, @purchase_id = @purchase_id,
                @amount = @total, @payment_method = @metodo, @note = @nota_pago,
                @register_id = @register_id, @reference = @ref_pago,
                @payment_id = @payment_id OUTPUT, @cash_id = @cash_id OUTPUT, @closure_id = @closure_pago OUTPUT;
            IF @closure_pago IS NOT NULL SET @closure_id = @closure_pago;
        END

        COMMIT TRAN;
        SELECT @purchase_id AS purchase_id,
               @metodo      AS payment_method,
               @saldo       AS balance,
               @payment_id  AS payment_id,
               @cash_id     AS cash_movement_id,
               @closure_id  AS closure_id;
    END TRY
    BEGIN CATCH
        IF XACT_STATE() <> 0 ROLLBACK TRAN;
        DECLARE @ErrMsg NVARCHAR(4000) = ERROR_MESSAGE();
        DECLARE @ErrSev INT = ERROR_SEVERITY();
        DECLARE @ErrSta INT = ERROR_STATE();
        RAISERROR(@ErrMsg, @ErrSev, @ErrSta);
    END CATCH
END
GO

/* ---------- sp_register_supplier_payment (SQL_STORED_PROCEDURE) ---------- */
/* sp_register_supplier_payment
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
-- =============================================
-- Author:		<David Casillas>
-- Create date: <07-12-2025>
-- Description:	<Registrar pago a proveedores>
-- Update:      Solo el EFECTIVO mueve el cajon. Antes, pagar por
--              transferencia o con cheque tambien restaba de la caja: el
--              arqueo salia corto por dinero que nunca estuvo ahi. Y el
--              movimiento nacia sin closure_id ni register_id, asi que en
--              multicaja podia acabar en el corte de otra.
-- Update 0049: es la PUERTA UNICA para pagar a un proveedor desde cualquier
--              pantalla (Proveedores y "salida de efectivo" en Venta). La
--              escritura del pago y de su salida del cajon vive en
--              sp_supplier_payment_apply, que tambien usa la compra de
--              contado. La caja ya no cae a "la primera": la decide
--              sp_resolve_cash_register, igual que el resto del dinero.
-- =============================================
CREATE OR ALTER PROCEDURE dbo.sp_register_supplier_payment
  @user_id        INT,
  @supplier_id    INT,
  @purchase_id    INT = NULL,
  @amount         DECIMAL(10,2),
  @payment_method NVARCHAR(50),
  @note           NVARCHAR(255) = NULL,
  @register_id    INT = NULL,
  @machine_id     NVARCHAR(64) = NULL,
  @machine_name   NVARCHAR(120) = NULL
AS
BEGIN
  SET NOCOUNT ON;
  SET XACT_ABORT ON;

  DECLARE @currentBalance DECIMAL(10,2);
  DECLARE @payment_id INT, @cash_id INT, @closure_id INT;
  DECLARE @metodo NVARCHAR(50) = UPPER(LTRIM(RTRIM(ISNULL(@payment_method, 'EFECTIVO'))));
  DECLARE @caja INT;

  BEGIN TRY
    BEGIN TRAN;

    /* Solo el efectivo necesita caja; lo demas no pasa por el cajon. */
    IF @metodo = 'EFECTIVO'
    BEGIN
      EXEC dbo.sp_resolve_cash_register
          @register_id = @register_id, @machine_id = @machine_id,
          @machine_name = @machine_name, @user_id = @user_id,
          @resolved = @caja OUTPUT;
      IF @caja IS NULL
        RAISERROR('No se pudo determinar la caja de la que sale el efectivo. Abre el turno en esta caja e intenta de nuevo.', 16, 1);
    END

    IF @purchase_id IS NOT NULL
    BEGIN
      SELECT @currentBalance = balance
      FROM dbo.purchase WITH (UPDLOCK, HOLDLOCK)
      WHERE id = @purchase_id
        AND supplier_id = @supplier_id;

      IF @currentBalance IS NULL
        RAISERROR('La compra no existe o no pertenece al proveedor.', 16, 1);

      IF @amount > @currentBalance
        RAISERROR('El pago no puede ser mayor al saldo de la compra.', 16, 1);
    END

    EXEC dbo.sp_supplier_payment_apply
        @user_id = @user_id, @supplier_id = @supplier_id, @purchase_id = @purchase_id,
        @amount = @amount, @payment_method = @metodo, @note = @note,
        @register_id = @caja,
        @payment_id = @payment_id OUTPUT, @cash_id = @cash_id OUTPUT, @closure_id = @closure_id OUTPUT;

    IF @purchase_id IS NOT NULL
    BEGIN
      UPDATE dbo.purchase
      SET balance = balance - @amount,
          payment_status = CASE
                             WHEN balance - @amount <= 0 THEN 'PAGADO'
                             ELSE 'PARCIAL'
                           END
      WHERE id = @purchase_id;
    END

    COMMIT TRAN;

    SELECT @payment_id AS payment_id, @cash_id AS cash_movement_id,
           @closure_id AS closure_id, @caja AS register_id;
  END TRY
  BEGIN CATCH
    IF XACT_STATE() <> 0 ROLLBACK TRAN;
    DECLARE @msg NVARCHAR(4000) = ERROR_MESSAGE();
    RAISERROR(@msg, 16, 1);
  END CATCH
END
GO

/* ---------- sp_resolve_cash_register (SQL_STORED_PROCEDURE) ---------- */
/* sp_resolve_cash_register
 * Definicion canonica. No editar en SSMS: modificar este archivo y crear una
 * migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* ------------------------------------------------------------------------
   ¿DE QUE CAJA ES ESTA OPERACION DE DINERO?

   Una sola respuesta para todas las operaciones que tocan el cajon (retiro,
   abono, devolucion, ajuste de venta, pago a proveedor, egreso). Antes cada
   procedure decidia por su cuenta, y dos lo hacian mal:

     · `SELECT TOP 1 id FROM registers ORDER BY id` -> "la Caja 1". En
       MultiCaja, el dinero de la Caja 2 acababa en el corte de la Caja 1.
     · `WHERE userId = @user_id` -> el turno de quien lo ABRIO. Si devolvia
       otra persona, "no hay turno abierto"; si esa persona tenia turno en otra
       caja, el dinero caia ahi.

   ORDEN (gana el primero que responda):
     1. la caja que dice quien llama (debe existir);
     2. la que este equipo tiene arrendada (register_assignments);
     3. la del unico turno abierto que tenga este usuario (compatibilidad con
        versiones de la app que no mandan ni caja ni equipo);
     4. la unica caja activa del negocio (MonoCaja).
   Si nada de eso responde, @resolved queda NULL y QUIEN LLAMA decide: una
   operacion en efectivo debe fallar con un mensaje claro, nunca adivinar.

   MULTICAJA: si el equipo se identifica (@machine_id), la caja debe ser SUYA.
   Es el mismo contrato que abrir turno, cerrar y vender (sp_register_lease_
   touch): sin identidad no se exige nada, con identidad se valida y renueva
   el arriendo.
   ------------------------------------------------------------------------ */
CREATE OR ALTER PROCEDURE dbo.sp_resolve_cash_register
    @register_id  INT = NULL,
    @machine_id   NVARCHAR(64) = NULL,
    @machine_name NVARCHAR(120) = NULL,
    @user_id      INT = NULL,
    @resolved     INT OUTPUT
AS
BEGIN
    SET NOCOUNT ON;
    SET @resolved = NULL;
    SET @machine_id = NULLIF(LTRIM(RTRIM(ISNULL(@machine_id, N''))), N'');

    /* 1) La que dice quien llama. Una caja que no existe es un error: seguir
          con otra seria mover dinero a un corte que nadie pidio. */
    IF @register_id IS NOT NULL
    BEGIN
        IF NOT EXISTS (SELECT 1 FROM dbo.registers WHERE id = @register_id)
        BEGIN
            RAISERROR('La caja indicada no existe.', 16, 1);
            RETURN;
        END
        SET @resolved = @register_id;
    END

    /* 2) La de este equipo. */
    IF @resolved IS NULL AND @machine_id IS NOT NULL
        SELECT @resolved = a.register_id
          FROM dbo.register_assignments a
         WHERE a.machine_id = @machine_id
           AND a.released_at IS NULL
           AND a.lease_until > SYSUTCDATETIME();

    /* 3) El unico turno abierto de esta persona. Si tiene dos (o ninguno), no
          se elige: eso es justo el error que se esta corrigiendo. */
    IF @resolved IS NULL AND @user_id IS NOT NULL
        AND (SELECT COUNT(*) FROM dbo.cash_closures WHERE userId = @user_id AND closed_at IS NULL) = 1
        SELECT @resolved = register_id
          FROM dbo.cash_closures
         WHERE userId = @user_id AND closed_at IS NULL;

    /* 4) Un negocio con una sola caja no tiene nada que decidir. */
    IF @resolved IS NULL AND (SELECT COUNT(*) FROM dbo.registers WHERE is_active = 1) = 1
        SELECT @resolved = id FROM dbo.registers WHERE is_active = 1;

    /* MultiCaja: la caja resuelta tiene que ser de este equipo. */
    IF @resolved IS NOT NULL AND @machine_id IS NOT NULL
    BEGIN
        DECLARE @lease_res NVARCHAR(20), @lease_holder NVARCHAR(64),
                @lease_holder_name NVARCHAR(120), @lease_hasta DATETIME2(0);
        EXEC dbo.sp_register_lease_touch
            @register_id   = @resolved,
            @machine_id    = @machine_id,
            @machine_name  = @machine_name,
            @lease_seconds = 300,
            @resultado     = @lease_res OUTPUT,
            @holder_id     = @lease_holder OUTPUT,
            @holder_name   = @lease_holder_name OUTPUT,
            @lease_until   = @lease_hasta OUTPUT;
        IF @lease_res = N'OCUPADA'
        BEGIN
            /* Sin acentos: el texto de un error de SQL Server llega al cliente
               degradado a un byte por caracter. */
            DECLARE @quien NVARCHAR(120) = ISNULL(NULLIF(LTRIM(RTRIM(@lease_holder_name)), N''), N'otro equipo');
            SET @resolved = NULL;
            RAISERROR('Esta caja la esta usando %s. El dinero de cada caja va a su propio corte.', 16, 1, @quien);
            RETURN;
        END
    END
END
GO

/* ---------- sp_supplier_payment_apply (SQL_STORED_PROCEDURE) ---------- */
/* sp_supplier_payment_apply
 * Definicion canonica. No editar en SSMS: modificar este archivo y crear una
 * migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* ------------------------------------------------------------------------
   PAGAR A UN PROVEEDOR: la UNICA logica que escribe el pago y su salida del
   cajon.

   Antes habia tres caminos para el mismo acto:
     · Proveedores -> sp_register_supplier_payment (SUPPLIER_PAYMENT);
     · Compra de contado -> su propia copia dentro de sp_register_purchase;
     · Venta, "salida de efectivo para un proveedor" -> un WITHDRAW mas un
       INSERT escrito en JavaScript, fuera de todo procedure.
   El mismo pago quedaba con tipos distintos segun por donde entrara, y el
   tercero ni siquiera era una transaccion: si el INSERT fallaba, el dinero
   ya habia salido del cajon sin quedar abonado al proveedor.

   Este procedure NO abre transaccion: corre DENTRO de la de quien lo llama
   (sp_register_supplier_payment y sp_register_purchase), para que el pago, la
   salida del cajon y lo demas que haga el llamador se confirmen o se
   deshagan juntos. Por eso exige @@TRANCOUNT > 0.

   No toca purchase.balance: eso es del llamador (una compra de contado nace
   ya saldada; un abono a una compra a credito la va saldando).

   Solo el EFECTIVO sale del cajon. Una transferencia, una tarjeta o un cheque
   salen del banco.
   ------------------------------------------------------------------------ */
CREATE OR ALTER PROCEDURE dbo.sp_supplier_payment_apply
    @user_id        INT,
    @supplier_id    INT,
    @purchase_id    INT = NULL,
    @amount         DECIMAL(10,2),
    @payment_method NVARCHAR(50),
    @note           NVARCHAR(255) = NULL,
    @register_id    INT = NULL,      -- ya resuelta por el llamador (sp_resolve_cash_register)
    @reference      NVARCHAR(100) = NULL,
    @payment_id     INT OUTPUT,
    @cash_id        INT OUTPUT,
    @closure_id     INT OUTPUT
AS
BEGIN
    SET NOCOUNT ON;
    SET @payment_id = NULL;
    SET @cash_id = NULL;
    SET @closure_id = NULL;

    IF @@TRANCOUNT = 0
    BEGIN
        RAISERROR('sp_supplier_payment_apply debe correr dentro de una transaccion.', 16, 1);
        RETURN;
    END

    DECLARE @metodo NVARCHAR(50) = UPPER(LTRIM(RTRIM(ISNULL(@payment_method, 'EFECTIVO'))));

    IF @amount IS NULL OR @amount <= 0
    BEGIN
        RAISERROR('El monto del pago debe ser mayor a cero.', 16, 1);
        RETURN;
    END
    IF NOT EXISTS (SELECT 1 FROM dbo.CAT_suppliers WHERE id = @supplier_id)
    BEGIN
        RAISERROR('El proveedor no existe.', 16, 1);
        RETURN;
    END

    IF @metodo = 'EFECTIVO'
    BEGIN
        IF @register_id IS NULL
        BEGIN
            RAISERROR('No se pudo determinar la caja de la que sale el efectivo.', 16, 1);
            RETURN;
        END
        SELECT TOP (1) @closure_id = id
          FROM dbo.cash_closures WITH (UPDLOCK, HOLDLOCK)
         WHERE register_id = @register_id
           AND closed_at IS NULL
         ORDER BY opened_at DESC, id DESC;
        IF @closure_id IS NULL
        BEGIN
            RAISERROR('Para pagar en efectivo hace falta un turno abierto en esta caja.', 16, 1);
            RETURN;
        END
    END

    INSERT INTO dbo.supplier_payments (supplier_id, purchase_id, datee, amount, payment_method, user_id, note)
    VALUES (@supplier_id, @purchase_id, GETDATE(), @amount, @metodo, @user_id, @note);
    SET @payment_id = SCOPE_IDENTITY();

    IF @metodo = 'EFECTIVO'
    BEGIN
        INSERT INTO dbo.cash_movements (datee, userId, typee, reference_id, reference, amount, note, closure_id, register_id)
        VALUES (GETDATE(), @user_id, 'SUPPLIER_PAYMENT', @payment_id,
                ISNULL(@reference, CONCAT('Pago prov. ', @supplier_id,
                       CASE WHEN @purchase_id IS NOT NULL THEN CONCAT(' compra ', @purchase_id) ELSE '' END)),
                -@amount, @note, @closure_id, @register_id);
        SET @cash_id = SCOPE_IDENTITY();

        UPDATE dbo.supplier_payments SET cash_movement_id = @cash_id WHERE id = @payment_id;
    END
END
GO

/* ---------- sp_update_sale (SQL_STORED_PROCEDURE) ---------- */
/* sp_update_sale
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* -------------------- sp_update_sale -------------------- */
CREATE OR ALTER PROCEDURE [dbo].[sp_update_sale]
  @sale_id INT,
  @user_id INT,
  @SaleDetails dbo.SaleDetailType READONLY,
  @note NVARCHAR(400) = NULL,
  -- 0049: la caja donde se cobra o se devuelve la diferencia. El turno se
  -- busca por caja, no por quien lo abrio (mismo criterio que la devolucion).
  @register_id INT = NULL,
  @machine_id NVARCHAR(64) = NULL,
  @machine_name NVARCHAR(120) = NULL
AS
BEGIN
  SET NOCOUNT ON;
  SET XACT_ABORT ON;

  IF @sale_id IS NULL OR @sale_id <= 0
  BEGIN
    RAISERROR('sale_id inválido.',16,1);
    RETURN;
  END

  BEGIN TRY
    BEGIN TRAN;

    IF EXISTS (SELECT 1 FROM dbo.sale_refunds WHERE sale_id = @sale_id)
    BEGIN
      RAISERROR('No se puede actualizar: la venta ya tiene reembolsos.',16,1);
      ROLLBACK TRAN;
      RETURN;
    END

    /* La edicion recalcula stock por PRODUCTO vendido: solo vale para lineas
       DIRECT sin modificadores. Una venta con recetas se corrige con
       Reembolso / Cambio, que repone lo que realmente se consumio. */
    IF EXISTS (SELECT 1 FROM dbo.sale_detail d WHERE d.sale_id = @sale_id AND d.inventory_mode = 'RECIPE')
       OR EXISTS (SELECT 1 FROM dbo.sale_detail d JOIN dbo.sale_detail_modifiers m ON m.sale_detail_id = d.id WHERE d.sale_id = @sale_id)
       OR EXISTS (SELECT 1 FROM @SaleDetails n JOIN dbo.products p ON p.id = n.product_id WHERE p.inventory_mode = 'RECIPE')
    BEGIN
      RAISERROR('Esta venta contiene recetas o modificadores: usa Reembolso / Cambio en lugar de modificarla.',16,1);
      ROLLBACK TRAN;
      RETURN;
    END

    DECLARE @old_total DECIMAL(12,2);
    DECLARE @payment_method NVARCHAR(50);
    DECLARE @customer_id INT;
    DECLARE @paid_amount DECIMAL(12,2);
    DECLARE @balance DECIMAL(12,2);

    SELECT
      @old_total = s.total,
      @payment_method = s.payment_method,
      @customer_id = s.customer_id,
      @paid_amount = s.paid_amount,
      @balance = s.balance
    FROM dbo.sales s WITH (UPDLOCK, HOLDLOCK)
    WHERE s.id = @sale_id;

    IF @old_total IS NULL
    BEGIN
      RAISERROR('La venta no existe.',16,1);
      ROLLBACK TRAN;
      RETURN;
    END

    IF (@customer_id IS NOT NULL AND UPPER(@payment_method)='CREDITO')
       AND (ISNULL(@paid_amount,0) > 0 AND ISNULL(@balance,0) < ISNULL(@old_total,0))
    BEGIN
      RAISERROR('No se puede actualizar: venta a crédito con pagos registrados.',16,1);
      ROLLBACK TRAN;
      RETURN;
    END

    ;WITH n AS (
      SELECT product_id, SUM(quantity) AS qty, MAX(unit_price) AS unit_price
      FROM @SaleDetails
      GROUP BY product_id
    )
    SELECT * INTO #new FROM n;

    SELECT
      d.product_id,
      SUM(d.quantity) AS qty,
      MAX(d.unitary_price) AS unit_price,
      MAX(d.unit_cost) AS unit_cost
    INTO #old
    FROM dbo.sale_detail d
    WHERE d.sale_id = @sale_id
    GROUP BY d.product_id;

    /* Solo los productos con inventario directo mueven stock; NONE no. */
    ;WITH delta AS (
      SELECT
        COALESCE(o.product_id, n.product_id) AS product_id,
        ISNULL(o.qty,0) AS old_qty,
        ISNULL(n.qty,0) AS new_qty,
        CASE WHEN p.inventory_mode = 'DIRECT' THEN (ISNULL(o.qty,0) - ISNULL(n.qty,0)) ELSE 0 END AS stock_change
      FROM #old o
      FULL JOIN #new n ON n.product_id = o.product_id
      JOIN dbo.products p ON p.id = COALESCE(o.product_id, n.product_id)
    )
    SELECT * INTO #delta FROM delta;

    IF EXISTS (
      SELECT 1
      FROM #delta d
      JOIN dbo.products p WITH (UPDLOCK, HOLDLOCK) ON p.id = d.product_id
      WHERE d.stock_change < 0
        AND p.stock < ABS(d.stock_change)
    )
    BEGIN
      RAISERROR('No hay stock suficiente para aumentar cantidades en la venta.',16,1);
      ROLLBACK TRAN;
      RETURN;
    END

    UPDATE p
    SET p.stock = p.stock + d.stock_change
    FROM dbo.products p
    JOIN #delta d ON d.product_id = p.id;

    DECLARE @new_total DECIMAL(12,2);
    SELECT @new_total = ISNULL(SUM(qty * unit_price),0) FROM #new;

    DELETE FROM dbo.sale_detail WHERE sale_id = @sale_id;

    /* Se conserva el costo congelado de la linea original; una linea nueva
       toma el costo actual del producto. */
    INSERT INTO dbo.sale_detail (sale_id, product_id, quantity, unitary_price, unit_cost, inventory_mode)
    SELECT @sale_id, n.product_id, n.qty, n.unit_price, ISNULL(o.unit_cost, p.cost), p.inventory_mode
    FROM #new n
    JOIN dbo.products p ON p.id = n.product_id
    LEFT JOIN #old o ON o.product_id = n.product_id;

    INSERT INTO dbo.inventory_movements (product_id, typee, reference, quantity, datee, descriptionn, source, sold_product_id, units, unit_cost)
    SELECT
      d.product_id,
      CASE WHEN d.stock_change < 0 THEN 'salida' ELSE 'entrada' END,
      CAST(@sale_id AS NVARCHAR(50)),
      ABS(d.stock_change),
      GETDATE(),
      CONCAT('Ajuste venta ', @sale_id, COALESCE(CONCAT(' - ', @note), '')),
      'EDIT',
      d.product_id,
      ABS(d.stock_change),
      p.cost
    FROM #delta d
    JOIN dbo.products p ON p.id = d.product_id
    WHERE d.stock_change <> 0;

    UPDATE dbo.sales
    SET total = @new_total,
        paid_amount = CASE
            WHEN @customer_id IS NOT NULL AND UPPER(@payment_method)='CREDITO' THEN ISNULL(paid_amount,0)
            ELSE @new_total
        END,
        balance = CASE
            WHEN @customer_id IS NOT NULL AND UPPER(@payment_method)='CREDITO' THEN @new_total
            ELSE 0
        END
    WHERE id = @sale_id;

    IF (@customer_id IS NULL OR UPPER(@payment_method) <> 'CREDITO')
       AND UPPER(@payment_method)='EFECTIVO'
    BEGIN
      DECLARE @delta_total DECIMAL(12,2) = (@new_total - ISNULL(@old_total,0));

      /* Sin diferencia no se toca el cajon, y por lo tanto no hace falta ni
         caja ni turno: editar una venta sin cambiar su total no debe fallar
         porque la caja este cerrada. */
      IF @delta_total <> 0
      BEGIN
        DECLARE @caja INT, @closure_id_open INT;
        EXEC dbo.sp_resolve_cash_register
            @register_id = @register_id, @machine_id = @machine_id,
            @machine_name = @machine_name, @user_id = @user_id, @resolved = @caja OUTPUT;
        IF @caja IS NULL
          RAISERROR('No se pudo determinar la caja del ajuste. Abre el turno en esta caja e intenta de nuevo.',16,1);

        SELECT TOP(1) @closure_id_open = id
        FROM dbo.cash_closures WITH (UPDLOCK, HOLDLOCK)
        WHERE register_id = @caja AND closed_at IS NULL
        ORDER BY opened_at DESC, id DESC;

        IF @closure_id_open IS NULL
          RAISERROR('No hay turno abierto para registrar el ajuste en caja.',16,1);

        INSERT INTO dbo.cash_movements
          (datee, userId, typee, reference_id, reference, amount, note, closure_id, register_id)
        VALUES
          (GETDATE(), @user_id, 'SALE_ADJ', @sale_id,
           CONCAT('Ajuste Venta ', @sale_id),
           @delta_total,
           @note,
           @closure_id_open,
           @caja);
      END
    END

    COMMIT TRAN;

    SELECT
      @sale_id AS sale_id,
      @old_total AS old_total,
      @new_total AS new_total,
      (@new_total - @old_total) AS delta_total;

  END TRY
  BEGIN CATCH
    IF XACT_STATE() <> 0 ROLLBACK TRAN;
    DECLARE @msg NVARCHAR(4000) = ERROR_MESSAGE();
    RAISERROR(@msg,16,1);
  END CATCH
END
GO

/* ---------- sp_void_expense (SQL_STORED_PROCEDURE) ---------- */
/* sp_void_expense
 * Definicion canonica. No editar en SSMS: modificar este archivo y crear una
 * migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* ------------------------------------------------------------------------
   CANCELAR UN EGRESO capturado por error. No se borra: queda marcado con
   quien, cuando y por que, y deja de contar en los reportes.

   Si fue en EFECTIVO, el dinero salio del cajon de un turno. Se puede
   cancelar mientras ESE turno siga abierto: se devuelve al cajon con un
   movimiento EXPENSE positivo en el mismo turno, y el corte queda como si el
   egreso no hubiera existido. Si el turno ya se cerro, el corte ya se
   entrego y no se reescribe: se cancela un egreso de otro medio o se
   registra lo que corresponda en el turno actual.
   ------------------------------------------------------------------------ */
CREATE OR ALTER PROCEDURE dbo.sp_void_expense
    @expense_id INT,
    @user_id    INT,
    @reason     NVARCHAR(200)
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    SET @reason = NULLIF(LTRIM(RTRIM(@reason)), N'');

    BEGIN TRY
        BEGIN TRAN;

        IF @reason IS NULL
            RAISERROR('Escribe por que se cancela el egreso.', 16, 1);

        DECLARE @metodo VARCHAR(20), @monto DECIMAL(12,2), @caja INT, @turno INT,
                @anulado DATETIME2(0), @cat NVARCHAR(60);
        SELECT @metodo = e.payment_method, @monto = e.amount, @caja = e.register_id,
               @turno = e.closure_id, @anulado = e.voided_at, @cat = c.name
          FROM dbo.expenses e WITH (UPDLOCK, HOLDLOCK)
          JOIN dbo.expense_categories c ON c.id = e.category_id
         WHERE e.id = @expense_id;

        IF @metodo IS NULL
            RAISERROR('El egreso no existe.', 16, 1);
        IF @anulado IS NOT NULL
            RAISERROR('Ese egreso ya estaba cancelado.', 16, 1);

        DECLARE @devolucion INT = NULL;
        IF @metodo = 'EFECTIVO'
        BEGIN
            IF NOT EXISTS (SELECT 1 FROM dbo.cash_closures WITH (UPDLOCK, HOLDLOCK)
                            WHERE id = @turno AND closed_at IS NULL)
                RAISERROR('Ese egreso salio del cajon en un turno que ya se cerro. El corte ya se entrego y no se reescribe.', 16, 1);

            INSERT INTO dbo.cash_movements (datee, userId, typee, reference_id, reference, amount, note, closure_id, register_id)
            VALUES (GETDATE(), @user_id, 'EXPENSE', @expense_id,
                    LEFT(CONCAT(N'Cancelacion egreso: ', @cat), 100), @monto, LEFT(@reason, 200), @turno, @caja);
            SET @devolucion = SCOPE_IDENTITY();
        END

        UPDATE dbo.expenses
           SET voided_at = SYSDATETIME(), voided_by = @user_id, void_reason = @reason,
               void_cash_movement_id = @devolucion
         WHERE id = @expense_id;

        COMMIT TRAN;
        SELECT @expense_id AS expense_id, @devolucion AS void_cash_movement_id;
    END TRY
    BEGIN CATCH
        IF XACT_STATE() <> 0 ROLLBACK TRAN;
        DECLARE @msg NVARCHAR(4000) = ERROR_MESSAGE();
        RAISERROR(@msg, 16, 1);
    END CATCH
END
GO
