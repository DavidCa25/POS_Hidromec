/* ============================================================
   0031 — servicios

   Generada con scripts/db/generar-migracion.mjs desde los archivos
   canonicos de sql/. No editar a mano: regenerar.

   Idempotente: todos los objetos usan CREATE OR ALTER, y los tipos
   comprueban su existencia antes de crearse. Se puede reejecutar.

   Incluye el bloque de esquema sql/schema/changes/0031_servicios.sql (tablas,
   columnas, seed). Cada paso de ese bloque comprueba su existencia.
   ============================================================ */

/* ========== ESQUEMA: sql/schema/changes/0031_servicios.sql ========== */
/* ============================================================
   0031 — Wybix Servicios.

   El negocio que cobra por TRABAJO y no solo por producto: el taller, la
   estetica, la clinica veterinaria, el servicio a domicilio. Todo lo de
   aqui esta apagado mientras el modulo `servicios` no se encienda desde
   Aplicaciones; una instalacion que no lo use no ve ninguna diferencia.

   LAS CUATRO DECISIONES QUE EXPLICAN EL RESTO
   -------------------------------------------
   1. UN SERVICIO ES UN PRODUCTO. `services` extiende `products` 1 a 1, no
      la sustituye. Un catalogo paralelo con sus propios precios habria
      duplicado impuestos, claves del SAT, reportes, la venta y la factura.
      Lo que un servicio tiene DE MAS -cuanto dura, si necesita a alguien
      que lo haga, cuanto se comisiona- vive aqui.

   2. EL ACTIVO DEL CLIENTE ES UNO SOLO Y GENERICO. El coche del taller, la
      mascota del veterinario y la maquina del tecnico son la misma cosa:
      «sobre que se trabaja». Una tabla por giro habria obligado a una
      migracion por cada giro nuevo; un JSON generico habria hecho
      imposible buscar por placa.

   3. PROFESIONAL NO ES USUARIO NI ES ROL. «Mecanico» y «Estilista» son
      datos del negocio, no permisos. El enlace con `users` es opcional y
      no concede nada: sirve para saber quien atendio, no que puede hacer.

   4. EL ESTADO ECONOMICO NO SE GUARDA. Si estuviera en una columna, un
      abono registrado en otra caja la dejaria mintiendo hasta que alguien
      la refrescara. Se deriva de la venta enlazada, que es donde el dinero
      de verdad esta.

   Todo idempotente. Se puede reejecutar.
   ============================================================ */

/* ------------------------------------------------------------------ SERVICIOS

   `product_id` es a la vez clave primaria y foranea: no puede existir un
   servicio que no sea un producto, ni dos filas para el mismo. Esa es la
   relacion 1 a 1, dicha por el esquema y no por una convencion.

   NO se duplica aqui el precio, ni el nombre, ni la tasa de IVA, ni la clave
   del SAT. Ya estan en `products` y tener dos copias significa elegir cual
   creer el dia que difieran. */
IF OBJECT_ID(N'dbo.services', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.services (
        product_id INT NOT NULL,

        /* Cuanto ocupa en la agenda. Es una estimacion para poder colocar la
           cita, no un compromiso: lo que se cobra son las lineas de la orden. */
        duration_minutes INT NOT NULL CONSTRAINT DF_services_duration DEFAULT ((30)),

        /* Si hace falta decir QUIEN lo hace. Un cambio de aceite si -de ahi
           sale la comision-; una revision de cortesia puede que no. */
        requires_professional BIT NOT NULL CONSTRAINT DF_services_req_prof DEFAULT ((1)),

        /* La comision por omision de ESTE servicio.
           NULL y 0 NO son lo mismo, y por eso admite NULL: NULL significa
           "este servicio no dice nada, usa la de la persona"; 0 significa
           "este servicio no comisiona, aunque la persona tenga porcentaje".
           Con un NOT NULL DEFAULT 0 las dos cosas se escribirian igual y la
           segunda seria imposible de expresar. */
        default_commission_pct DECIMAL(5, 2) NULL,

        /* Si se puede reservar en la Agenda. Un servicio interno -«revision
           previa»- existe en el catalogo y no se agenda. */
        schedulable BIT NOT NULL CONSTRAINT DF_services_sched DEFAULT ((1)),

        notes NVARCHAR(400) COLLATE Modern_Spanish_CI_AS NULL,
        created_at DATETIME2(0) NOT NULL CONSTRAINT DF_services_created DEFAULT (SYSDATETIME()),
        updated_at DATETIME2(0) NULL,

        CONSTRAINT PK_services PRIMARY KEY CLUSTERED (product_id),
        CONSTRAINT FK_services_product FOREIGN KEY (product_id) REFERENCES dbo.products (id)
    );
END;
GO

IF OBJECT_ID(N'dbo.CK_services_duration', 'C') IS NULL
ALTER TABLE dbo.services WITH CHECK
  ADD CONSTRAINT CK_services_duration CHECK (duration_minutes BETWEEN 1 AND 1440);
GO

IF OBJECT_ID(N'dbo.CK_services_commission', 'C') IS NULL
ALTER TABLE dbo.services WITH CHECK
  ADD CONSTRAINT CK_services_commission CHECK (default_commission_pct IS NULL OR default_commission_pct BETWEEN 0 AND 100);
GO

/* --------------------------------------------------- ACTIVOS DE UN CLIENTE

   Sobre que se trabaja. El coche, la moto, la mascota, la maquina, el equipo
   de aire. Una tabla, no una por giro.

   POR QUE ESTAS COLUMNAS Y NO UN JSON
   -----------------------------------
   Un `attributes NVARCHAR(MAX)` habria sido comodo de escribir y terrible de
   usar: no se puede indexar, no se puede buscar «todos los coches con placa
   que empiece por ABC», y acaba siendo el sitio donde cae lo que nadie quiso
   modelar. Tampoco una tabla por giro, que obligaria a una migracion cada vez
   que Wybix entre en un negocio nuevo.

   Lo que hay es el conjunto minimo que sirve a los tres giros reales:
   identificarlo (placa, serie, chip), reconocerlo (marca, modelo, ano, color)
   y decirlo en el mostrador (`label`). Un veterinario usa `brand` para la
   especie y `model` para la raza, y eso esta bien: la etiqueta la pone la
   pantalla, no la base. */
IF OBJECT_ID(N'dbo.customer_assets', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.customer_assets (
        id INT IDENTITY(1, 1) NOT NULL,
        customer_id INT NOT NULL,

        /* VEHICULO | MASCOTA | EQUIPO | INMUEBLE | OTRO. Sin CHECK: el dia que
           un giro nuevo necesite otra clase, no puede fallar una migracion
           sobre la base de un cliente. La pantalla ofrece las conocidas. */
        kind NVARCHAR(20) COLLATE Modern_Spanish_CI_AS NOT NULL CONSTRAINT DF_cassets_kind DEFAULT ('OTRO'),

        /* Como lo llama el mostrador: «Jetta 2018 gris», «Rocky», «Compresor 2». */
        label NVARCHAR(120) COLLATE Modern_Spanish_CI_AS NOT NULL,

        /* Lo que lo identifica sin ambiguedad: placa, numero de serie, chip. */
        identifier NVARCHAR(60) COLLATE Modern_Spanish_CI_AS NULL,
        /* El segundo, cuando hay dos: VIN, IMEI, numero de expediente. */
        secondary_identifier NVARCHAR(60) COLLATE Modern_Spanish_CI_AS NULL,

        brand NVARCHAR(60) COLLATE Modern_Spanish_CI_AS NULL,
        model NVARCHAR(60) COLLATE Modern_Spanish_CI_AS NULL,
        /* Ano de un coche, edad de una mascota. Texto porque «3 meses» no es
           un numero y obligar a que lo sea pierde el dato. */
        year_or_age NVARCHAR(20) COLLATE Modern_Spanish_CI_AS NULL,
        color NVARCHAR(40) COLLATE Modern_Spanish_CI_AS NULL,

        notes NVARCHAR(400) COLLATE Modern_Spanish_CI_AS NULL,
        active BIT NOT NULL CONSTRAINT DF_cassets_active DEFAULT ((1)),
        created_at DATETIME2(0) NOT NULL CONSTRAINT DF_cassets_created DEFAULT (SYSDATETIME()),
        updated_at DATETIME2(0) NULL,

        CONSTRAINT PK_customer_assets PRIMARY KEY CLUSTERED (id),
        CONSTRAINT FK_customer_assets_customer FOREIGN KEY (customer_id) REFERENCES dbo.customers (id)
    );
END;
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_customer_assets_customer'
               AND object_id = OBJECT_ID(N'dbo.customer_assets'))
CREATE NONCLUSTERED INDEX IX_customer_assets_customer
  ON dbo.customer_assets (customer_id, active) INCLUDE (label, identifier);
GO

/* Buscar por placa o por serie es la forma natural de encontrar al cliente en
   un taller: llega el coche, no llega el nombre. */
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_customer_assets_identifier'
               AND object_id = OBJECT_ID(N'dbo.customer_assets'))
CREATE NONCLUSTERED INDEX IX_customer_assets_identifier
  ON dbo.customer_assets (identifier) WHERE identifier IS NOT NULL;
GO

/* ----------------------------------------------------------- PROFESIONALES

   Quien hace el trabajo. NO es un rol ni un permiso: es un dato del negocio,
   igual que un proveedor.

   `user_id` es opcional y unico. Opcional porque hay negocios donde el
   mecanico no toca la caja y no necesita usuario. Unico porque una persona no
   puede ser dos profesionales. Y NO concede nada: enlazarlo sirve para saber
   quien atendio y para que esa persona vea su propia agenda, no para que
   pueda hacer mas cosas. Los permisos siguen saliendo de `users.rol`. */
IF OBJECT_ID(N'dbo.professionals', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.professionals (
        id INT IDENTITY(1, 1) NOT NULL,
        full_name NVARCHAR(120) COLLATE Modern_Spanish_CI_AS NOT NULL,

        /* Lo que hace, dicho como lo dice el negocio: Mecanico, Estilista,
           Medico veterinario. Es una etiqueta, no una clase del sistema. */
        title NVARCHAR(60) COLLATE Modern_Spanish_CI_AS NULL,

        phone NVARCHAR(30) COLLATE Modern_Spanish_CI_AS NULL,
        email NVARCHAR(120) COLLATE Modern_Spanish_CI_AS NULL,

        user_id INT NULL,

        /* Su comision por omision, cuando el servicio no dice otra cosa. */
        default_commission_pct DECIMAL(5, 2) NOT NULL CONSTRAINT DF_prof_comm DEFAULT ((0)),

        /* El color con el que aparece en la Agenda. Sin esto, diez columnas de
           citas son diez columnas iguales. */
        color NVARCHAR(9) COLLATE Modern_Spanish_CI_AS NULL,

        active BIT NOT NULL CONSTRAINT DF_prof_active DEFAULT ((1)),
        created_at DATETIME2(0) NOT NULL CONSTRAINT DF_prof_created DEFAULT (SYSDATETIME()),
        updated_at DATETIME2(0) NULL,

        CONSTRAINT PK_professionals PRIMARY KEY CLUSTERED (id),
        CONSTRAINT FK_professionals_user FOREIGN KEY (user_id) REFERENCES dbo.users (id)
    );
END;
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'UX_professionals_user'
               AND object_id = OBJECT_ID(N'dbo.professionals'))
CREATE UNIQUE NONCLUSTERED INDEX UX_professionals_user
  ON dbo.professionals (user_id) WHERE user_id IS NOT NULL;
GO

IF OBJECT_ID(N'dbo.CK_professionals_commission', 'C') IS NULL
ALTER TABLE dbo.professionals WITH CHECK
  ADD CONSTRAINT CK_professionals_commission CHECK (default_commission_pct BETWEEN 0 AND 100);
GO

/* ------------------------------------------- QUE SERVICIO HACE CADA PERSONA

   Sin filas para un servicio, lo hace cualquiera: un negocio pequeno no
   quiere mantener una matriz, y obligarle a llenarla antes de poder trabajar
   seria una pantalla vacia el primer dia.

   Con filas, solo esos, y la Agenda ya no ofrece a quien no lo hace. */
IF OBJECT_ID(N'dbo.service_professionals', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.service_professionals (
        service_product_id INT NOT NULL,
        professional_id INT NOT NULL,
        /* NULL = usa el del servicio, y si el servicio no dice, el de la
           persona. Tres niveles, y el que manda es el mas concreto. */
        commission_pct DECIMAL(5, 2) NULL,
        created_at DATETIME2(0) NOT NULL CONSTRAINT DF_svcprof_created DEFAULT (SYSDATETIME()),

        CONSTRAINT PK_service_professionals PRIMARY KEY CLUSTERED (service_product_id, professional_id),
        CONSTRAINT FK_svcprof_service FOREIGN KEY (service_product_id) REFERENCES dbo.services (product_id),
        CONSTRAINT FK_svcprof_prof FOREIGN KEY (professional_id) REFERENCES dbo.professionals (id)
    );
END;
GO

/* --------------------------------------------------------------- HORARIOS

   El horario semanal de cada persona. `weekday` es 1..7 con 1 = domingo, que
   es lo que devuelve DATEPART(WEEKDAY) con la configuracion por omision de
   SQL Server: usar la misma numeracion evita una conversion en cada consulta
   y el error que esa conversion acaba teniendo. */
IF OBJECT_ID(N'dbo.professional_schedules', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.professional_schedules (
        id INT IDENTITY(1, 1) NOT NULL,
        professional_id INT NOT NULL,
        weekday TINYINT NOT NULL,
        starts_at TIME(0) NOT NULL,
        ends_at TIME(0) NOT NULL,
        active BIT NOT NULL CONSTRAINT DF_schedule_active DEFAULT ((1)),

        CONSTRAINT PK_professional_schedules PRIMARY KEY CLUSTERED (id),
        CONSTRAINT FK_schedule_prof FOREIGN KEY (professional_id) REFERENCES dbo.professionals (id)
    );
END;
GO

IF OBJECT_ID(N'dbo.CK_schedule_weekday', 'C') IS NULL
ALTER TABLE dbo.professional_schedules WITH CHECK
  ADD CONSTRAINT CK_schedule_weekday CHECK (weekday BETWEEN 1 AND 7);
GO

IF OBJECT_ID(N'dbo.CK_schedule_range', 'C') IS NULL
ALTER TABLE dbo.professional_schedules WITH CHECK
  ADD CONSTRAINT CK_schedule_range CHECK (ends_at > starts_at);
GO

/* Las excepciones: vacaciones, una tarde libre, una incapacidad. Se guardan
   aparte del horario semanal porque son de OTRA naturaleza -tienen fecha, no
   dia de la semana- y mezclarlas obligaria a que cada consulta distinguiera
   cual es cual. */
IF OBJECT_ID(N'dbo.professional_time_off', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.professional_time_off (
        id INT IDENTITY(1, 1) NOT NULL,
        professional_id INT NOT NULL,
        starts_at DATETIME2(0) NOT NULL,
        ends_at DATETIME2(0) NOT NULL,
        reason NVARCHAR(200) COLLATE Modern_Spanish_CI_AS NULL,
        created_at DATETIME2(0) NOT NULL CONSTRAINT DF_timeoff_created DEFAULT (SYSDATETIME()),

        CONSTRAINT PK_professional_time_off PRIMARY KEY CLUSTERED (id),
        CONSTRAINT FK_timeoff_prof FOREIGN KEY (professional_id) REFERENCES dbo.professionals (id)
    );
END;
GO

IF OBJECT_ID(N'dbo.CK_timeoff_range', 'C') IS NULL
ALTER TABLE dbo.professional_time_off WITH CHECK
  ADD CONSTRAINT CK_timeoff_range CHECK (ends_at > starts_at);
GO

/* --------------------------------------------------- ORDENES DE SERVICIO

   El trabajo, desde que entra hasta que se entrega.

   EL ESTADO OPERATIVO Y EL ECONOMICO SON DOS COSAS
   ------------------------------------------------
   `status` dice como va el TRABAJO. Si esta cobrado o no se deduce de
   `sale_id` y del saldo de esa venta, y no se guarda aqui: una columna
   `pagada` mentiria en cuanto alguien registrara un abono desde otra caja.

   LA AUTORIZACION ES VERSIONADA
   -----------------------------
   El cliente autoriza UN presupuesto, no «la orden». Si despues se anade una
   linea, lo que autorizo ya no es lo que se va a cobrar. `quote_version` sube
   con cada cambio que mueva el importe; `authorized_version` recuerda cual
   aprobo. Cuando la primera adelanta a la segunda, la orden necesita
   reautorizacion y la pantalla lo dice.

   Sin esto, la conversacion del mostrador es «usted autorizo» / «yo autorice
   otra cosa», y no hay forma de saber quien tiene razon.

   CONCURRENCIA
   ------------
   `rowver` es el testigo de version. Dos personas con la misma orden abierta
   -el mostrador y el taller- es lo normal, no la excepcion. Sin testigo, la
   ultima en guardar se lleva por delante lo que escribio la otra sin que
   ninguna se entere. */
IF OBJECT_ID(N'dbo.service_orders', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.service_orders (
        id INT IDENTITY(1, 1) NOT NULL,

        /* Derivado del identificador: sin contador aparte, sin huecos que
           administrar y sin dos cajas peleandose por el siguiente numero. */
        folio AS ('OS-' + RIGHT('000000' + CONVERT(VARCHAR(7), id), 6)) PERSISTED,

        customer_id INT NOT NULL,
        customer_asset_id INT NULL,

        /* BORRADOR | ABIERTA | EN_PROCESO | TERMINADA | ENTREGADA | CANCELADA.
           Sin CHECK, por el mismo motivo que `users.rol`: una version futura
           con un estado mas no puede romper la base de un cliente. Los
           procedimientos validan las transiciones. */
        status NVARCHAR(20) COLLATE Modern_Spanish_CI_AS NOT NULL CONSTRAINT DF_sorders_status DEFAULT ('BORRADOR'),

        /* Lo que el cliente conto y lo que se encontro. Dos campos y no uno
           porque son dos momentos distintos, y juntarlos pierde el primero. */
        reported_issue NVARCHAR(1000) COLLATE Modern_Spanish_CI_AS NULL,
        diagnosis NVARCHAR(1000) COLLATE Modern_Spanish_CI_AS NULL,

        quote_version INT NOT NULL CONSTRAINT DF_sorders_qver DEFAULT ((1)),
        authorized_version INT NULL,
        authorized_at DATETIME2(0) NULL,
        /* Quien autorizo, dicho como se pudo: el cliente por telefono no tiene
           usuario en Wybix. Se guarda su nombre y por que via. */
        authorized_by_name NVARCHAR(120) COLLATE Modern_Spanish_CI_AS NULL,
        authorized_channel NVARCHAR(20) COLLATE Modern_Spanish_CI_AS NULL,
        /* Y quien de la casa lo registro: eso si es un usuario. */
        authorized_by_user INT NULL,

        promised_at DATETIME2(0) NULL,

        opened_at DATETIME2(0) NOT NULL CONSTRAINT DF_sorders_opened DEFAULT (SYSDATETIME()),
        opened_by INT NULL,
        closed_at DATETIME2(0) NULL,
        closed_by INT NULL,

        /* La venta que la cobro. NULL mientras no se haya cobrado, y es lo que
           convierte «terminada» en «cobrada» sin guardar esa palabra. */
        sale_id INT NULL,

        register_id INT NULL,
        notes NVARCHAR(1000) COLLATE Modern_Spanish_CI_AS NULL,

        rowver ROWVERSION NOT NULL,

        CONSTRAINT PK_service_orders PRIMARY KEY CLUSTERED (id),
        CONSTRAINT FK_sorders_customer FOREIGN KEY (customer_id) REFERENCES dbo.customers (id),
        CONSTRAINT FK_sorders_asset FOREIGN KEY (customer_asset_id) REFERENCES dbo.customer_assets (id),
        CONSTRAINT FK_sorders_sale FOREIGN KEY (sale_id) REFERENCES dbo.sales (id),
        CONSTRAINT FK_sorders_opened_by FOREIGN KEY (opened_by) REFERENCES dbo.users (id),
        CONSTRAINT FK_sorders_closed_by FOREIGN KEY (closed_by) REFERENCES dbo.users (id),
        CONSTRAINT FK_sorders_auth_user FOREIGN KEY (authorized_by_user) REFERENCES dbo.users (id)
    );
END;
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_service_orders_status'
               AND object_id = OBJECT_ID(N'dbo.service_orders'))
CREATE NONCLUSTERED INDEX IX_service_orders_status
  ON dbo.service_orders (status, opened_at DESC) INCLUDE (customer_id, sale_id);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_service_orders_customer'
               AND object_id = OBJECT_ID(N'dbo.service_orders'))
CREATE NONCLUSTERED INDEX IX_service_orders_customer
  ON dbo.service_orders (customer_id, opened_at DESC);
GO

/* Una venta cobra UNA orden. Enlazar dos a la misma venta convertiria el
   cobro en algo que nadie sabria repartir. */
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'UX_service_orders_sale'
               AND object_id = OBJECT_ID(N'dbo.service_orders'))
CREATE UNIQUE NONCLUSTERED INDEX UX_service_orders_sale
  ON dbo.service_orders (sale_id) WHERE sale_id IS NOT NULL;
GO

/* ------------------------------------------------------ LINEAS DE LA ORDEN

   Servicios y refacciones, en la misma lista y con la misma forma. En un
   taller no son dos documentos: son la misma orden, y el cliente ve un solo
   total.

   TODO LO QUE SE COBRA ESTA CONGELADO
   -----------------------------------
   El nombre, el precio, el costo, la tasa y el porcentaje de comision se
   copian al anadir la linea. Si manana sube el precio del aceite, la orden
   que el cliente autorizo ayer sigue costando lo de ayer. Sin la copia, un
   cambio de catalogo reescribiria presupuestos ya aprobados y comisiones ya
   calculadas, sin que nadie lo pidiera.

   Se guarda `product_id` igualmente: para el inventario, la factura y para
   saber de que producto se trataba. La copia es el precio acordado, no un
   sustituto del catalogo. */
IF OBJECT_ID(N'dbo.service_order_lines', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.service_order_lines (
        id INT IDENTITY(1, 1) NOT NULL,
        order_id INT NOT NULL,
        line_no INT NOT NULL,

        /* SERVICIO | PRODUCTO. Cambia lo que se hace con el inventario y
           quien puede comisionar, no como se cobra. */
        line_kind NVARCHAR(10) COLLATE Modern_Spanish_CI_AS NOT NULL,

        product_id INT NOT NULL,

        name_snapshot NVARCHAR(120) COLLATE Modern_Spanish_CI_AS NOT NULL,
        unit_price_snapshot DECIMAL(12, 2) NOT NULL,
        unit_cost_snapshot DECIMAL(14, 4) NULL,
        tasa_iva_snapshot DECIMAL(5, 4) NOT NULL CONSTRAINT DF_solines_iva DEFAULT ((0.16)),

        quantity DECIMAL(12, 2) NOT NULL CONSTRAINT DF_solines_qty DEFAULT ((1)),
        line_total AS (CONVERT(DECIMAL(14, 2), quantity * unit_price_snapshot)) PERSISTED,

        /* Quien lo hizo, y con que porcentaje. El porcentaje tambien se
           congela: cambiarle la comision a alguien no puede reescribir lo que
           ya gano en trabajos cerrados. */
        professional_id INT NULL,
        commission_pct_snapshot DECIMAL(5, 2) NULL,

        /* PENDIENTE | EN_PROCESO | HECHA | CANCELADA. Una linea cancelada se
           queda: borrarla escondería que se cotizo y se quito. */
        status NVARCHAR(12) COLLATE Modern_Spanish_CI_AS NOT NULL CONSTRAINT DF_solines_status DEFAULT ('PENDIENTE'),

        notes NVARCHAR(400) COLLATE Modern_Spanish_CI_AS NULL,
        added_at DATETIME2(0) NOT NULL CONSTRAINT DF_solines_added DEFAULT (SYSDATETIME()),
        added_by INT NULL,

        CONSTRAINT PK_service_order_lines PRIMARY KEY CLUSTERED (id),
        CONSTRAINT FK_solines_order FOREIGN KEY (order_id) REFERENCES dbo.service_orders (id),
        CONSTRAINT FK_solines_product FOREIGN KEY (product_id) REFERENCES dbo.products (id),
        CONSTRAINT FK_solines_prof FOREIGN KEY (professional_id) REFERENCES dbo.professionals (id),
        CONSTRAINT FK_solines_user FOREIGN KEY (added_by) REFERENCES dbo.users (id)
    );
END;
GO

IF OBJECT_ID(N'dbo.CK_solines_kind', 'C') IS NULL
ALTER TABLE dbo.service_order_lines WITH CHECK
  ADD CONSTRAINT CK_solines_kind CHECK (line_kind IN ('SERVICIO', 'PRODUCTO'));
GO

IF OBJECT_ID(N'dbo.CK_solines_qty', 'C') IS NULL
ALTER TABLE dbo.service_order_lines WITH CHECK
  ADD CONSTRAINT CK_solines_qty CHECK (quantity > 0);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_solines_order'
               AND object_id = OBJECT_ID(N'dbo.service_order_lines'))
CREATE NONCLUSTERED INDEX IX_solines_order ON dbo.service_order_lines (order_id, line_no);
GO

/* ------------------------------------------------------------- HISTORIAL

   Que paso, cuando y quien lo hizo. Es lo que responde la pregunta que
   siempre acaba haciendose: «¿por que esta orden cuesta el doble de lo que
   le dije al cliente?».

   Se escribe desde los procedimientos, nunca desde el renderer: un historial
   que la interfaz pueda elegir no escribir no es un historial. */
IF OBJECT_ID(N'dbo.service_order_events', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.service_order_events (
        id INT IDENTITY(1, 1) NOT NULL,
        order_id INT NOT NULL,
        happened_at DATETIME2(0) NOT NULL CONSTRAINT DF_soevents_at DEFAULT (SYSDATETIME()),

        /* ABIERTA | LINEA_ANADIDA | LINEA_QUITADA | LINEA_HECHA | DIAGNOSTICO
           | AUTORIZADA | REAUTORIZACION_REQUERIDA | ESTADO | COBRADA |
           CANCELADA | NOTA. Texto libre a proposito: un evento nuevo no puede
           exigir una migracion. */
        event_type NVARCHAR(30) COLLATE Modern_Spanish_CI_AS NOT NULL,

        from_status NVARCHAR(20) COLLATE Modern_Spanish_CI_AS NULL,
        to_status NVARCHAR(20) COLLATE Modern_Spanish_CI_AS NULL,
        quote_version INT NULL,
        amount DECIMAL(14, 2) NULL,
        detail NVARCHAR(400) COLLATE Modern_Spanish_CI_AS NULL,

        user_id INT NULL,

        CONSTRAINT PK_service_order_events PRIMARY KEY CLUSTERED (id),
        CONSTRAINT FK_soevents_order FOREIGN KEY (order_id) REFERENCES dbo.service_orders (id),
        CONSTRAINT FK_soevents_user FOREIGN KEY (user_id) REFERENCES dbo.users (id)
    );
END;
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_soevents_order'
               AND object_id = OBJECT_ID(N'dbo.service_order_events'))
CREATE NONCLUSTERED INDEX IX_soevents_order ON dbo.service_order_events (order_id, happened_at);
GO

/* ------------------------------------------------------------------ CITAS

   La Agenda. Una cita es una promesa; la orden es el trabajo. Son dos cosas
   y por eso son dos tablas: hay citas que nunca llegan a ser trabajo -se
   cancelan, no se presentan- y hay trabajo que entra sin cita.

   `service_order_id` las enlaza cuando la promesa se cumple. */
IF OBJECT_ID(N'dbo.appointments', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.appointments (
        id INT IDENTITY(1, 1) NOT NULL,

        customer_id INT NOT NULL,
        customer_asset_id INT NULL,
        professional_id INT NULL,
        service_product_id INT NULL,

        starts_at DATETIME2(0) NOT NULL,
        ends_at DATETIME2(0) NOT NULL,

        /* AGENDADA | CONFIRMADA | ATENDIDA | CANCELADA | NO_ASISTIO.
           `NO_ASISTIO` existe separado de `CANCELADA` porque no son lo mismo
           para el negocio: una se avisa y la otra se pierde. */
        status NVARCHAR(15) COLLATE Modern_Spanish_CI_AS NOT NULL CONSTRAINT DF_appt_status DEFAULT ('AGENDADA'),

        service_order_id INT NULL,

        /* De donde vino esta cita, cuando es una reprogramacion. Se guarda el
           enlace en vez de reescribir la original: quien reprograma tres veces
           deja tres filas y se ve. */
        rescheduled_from_id INT NULL,

        notes NVARCHAR(400) COLLATE Modern_Spanish_CI_AS NULL,
        created_at DATETIME2(0) NOT NULL CONSTRAINT DF_appt_created DEFAULT (SYSDATETIME()),
        created_by INT NULL,
        updated_at DATETIME2(0) NULL,

        CONSTRAINT PK_appointments PRIMARY KEY CLUSTERED (id),
        CONSTRAINT FK_appt_customer FOREIGN KEY (customer_id) REFERENCES dbo.customers (id),
        CONSTRAINT FK_appt_asset FOREIGN KEY (customer_asset_id) REFERENCES dbo.customer_assets (id),
        CONSTRAINT FK_appt_prof FOREIGN KEY (professional_id) REFERENCES dbo.professionals (id),
        CONSTRAINT FK_appt_service FOREIGN KEY (service_product_id) REFERENCES dbo.services (product_id),
        CONSTRAINT FK_appt_order FOREIGN KEY (service_order_id) REFERENCES dbo.service_orders (id),
        CONSTRAINT FK_appt_prev FOREIGN KEY (rescheduled_from_id) REFERENCES dbo.appointments (id),
        CONSTRAINT FK_appt_user FOREIGN KEY (created_by) REFERENCES dbo.users (id)
    );
END;
GO

IF OBJECT_ID(N'dbo.CK_appt_range', 'C') IS NULL
ALTER TABLE dbo.appointments WITH CHECK
  ADD CONSTRAINT CK_appt_range CHECK (ends_at > starts_at);
GO

/* La consulta de la Agenda es siempre «que hay entre estas dos fechas», y
   casi siempre filtrando por persona. */
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_appointments_rango'
               AND object_id = OBJECT_ID(N'dbo.appointments'))
CREATE NONCLUSTERED INDEX IX_appointments_rango
  ON dbo.appointments (starts_at, ends_at) INCLUDE (professional_id, status, customer_id);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_appointments_prof'
               AND object_id = OBJECT_ID(N'dbo.appointments'))
CREATE NONCLUSTERED INDEX IX_appointments_prof
  ON dbo.appointments (professional_id, starts_at) WHERE professional_id IS NOT NULL;
GO

/* ------------------------------------------------------------- COMISIONES

   Lo que gano cada persona por un trabajo YA COBRADO.

   Se calcula una vez, al cobrar, y se guarda. No se deriva al vuelo de las
   lineas porque entonces cambiaria cada vez que alguien tocara un porcentaje,
   y una comision ya devengada no puede moverse sola: es dinero que alguien
   espera.

   Esto NO es nomina ni liquidacion. No hay pagos, ni periodos, ni descuentos:
   eso quedo explicitamente fuera. Es el reporte de cuanto genero cada quien. */
IF OBJECT_ID(N'dbo.service_commissions', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.service_commissions (
        id INT IDENTITY(1, 1) NOT NULL,
        order_id INT NOT NULL,
        order_line_id INT NOT NULL,
        sale_id INT NOT NULL,
        professional_id INT NOT NULL,

        base_amount DECIMAL(14, 2) NOT NULL,
        pct DECIMAL(5, 2) NOT NULL,
        amount DECIMAL(14, 2) NOT NULL,

        earned_at DATETIME2(0) NOT NULL CONSTRAINT DF_commissions_at DEFAULT (SYSDATETIME()),

        CONSTRAINT PK_service_commissions PRIMARY KEY CLUSTERED (id),
        CONSTRAINT FK_commissions_order FOREIGN KEY (order_id) REFERENCES dbo.service_orders (id),
        CONSTRAINT FK_commissions_line FOREIGN KEY (order_line_id) REFERENCES dbo.service_order_lines (id),
        CONSTRAINT FK_commissions_sale FOREIGN KEY (sale_id) REFERENCES dbo.sales (id),
        CONSTRAINT FK_commissions_prof FOREIGN KEY (professional_id) REFERENCES dbo.professionals (id)
    );
END;
GO

/* Una linea comisiona UNA vez. Cobrar dos veces la misma orden -un reintento,
   una doble pulsacion- no puede duplicar lo que alguien gano. */
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'UX_commissions_line'
               AND object_id = OBJECT_ID(N'dbo.service_commissions'))
CREATE UNIQUE NONCLUSTERED INDEX UX_commissions_line ON dbo.service_commissions (order_line_id);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_commissions_prof'
               AND object_id = OBJECT_ID(N'dbo.service_commissions'))
CREATE NONCLUSTERED INDEX IX_commissions_prof
  ON dbo.service_commissions (professional_id, earned_at DESC);
GO

/* ------------------------------------------------------- EL MODULO EXISTE

   Se registra apagado. Encenderlo es una decision del negocio y se toma desde
   Aplicaciones, no en una migracion: una instalacion que actualiza no puede
   despertarse con un modulo nuevo en el menu que nadie pidio. */
IF NOT EXISTS (SELECT 1 FROM dbo.business_modules WHERE module_key = 'servicios')
    INSERT INTO dbo.business_modules (module_key, enabled, updated_at)
    VALUES ('servicios', 0, SYSDATETIME());
GO

/* ---------- sp_appointment_get (SQL_STORED_PROCEDURE) ---------- */
/* sp_appointment_get
 * Definicion canonica. Modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* Una cita, con todo lo que la pantalla necesita para pintarla y avisar.
 *
 * LOS AVISOS VIENEN CON LA CITA
 * -----------------------------
 * `fuera_de_horario` y `en_ausencia` no impiden nada: una cita un sabado por
 * la tarde, o en mitad de unas vacaciones, pasa constantemente y casi siempre
 * a proposito. Lo que no puede pasar es que nadie se entere. Se calculan al
 * leer y no se guardan, porque el horario puede cambiar despues de agendar y
 * entonces un aviso guardado seria falso.
 */
CREATE OR ALTER PROCEDURE dbo.sp_appointment_get
    @id INT
AS
BEGIN
    SET NOCOUNT ON;

    SELECT a.id, a.customer_id, c.customerName AS customer_name,
           c.phone AS customer_phone, c.mobile AS customer_mobile,
           a.customer_asset_id, ca.label AS asset_label, ca.identifier AS asset_identifier,
           a.professional_id, pr.full_name AS professional_name, pr.color AS professional_color,
           a.service_product_id, p.nombre AS service_name, s.duration_minutes,
           a.starts_at, a.ends_at, a.status,
           a.service_order_id, o.folio AS order_folio, o.status AS order_status,
           a.rescheduled_from_id, a.notes,
           a.created_at, a.created_by, u.usuario AS created_by_name, a.updated_at,

           /* Fuera del horario semanal de esa persona. */
           CONVERT(BIT, CASE
             WHEN a.professional_id IS NULL THEN 0
             WHEN NOT EXISTS (SELECT 1 FROM dbo.professional_schedules sc
                               WHERE sc.professional_id = a.professional_id AND sc.active = 1)
                  THEN 0   -- sin horario declarado no hay nada que contradecir
             WHEN EXISTS (SELECT 1 FROM dbo.professional_schedules sc
                           WHERE sc.professional_id = a.professional_id
                             AND sc.active = 1
                             AND sc.weekday = DATEPART(WEEKDAY, a.starts_at)
                             AND sc.starts_at <= CONVERT(TIME(0), a.starts_at)
                             AND sc.ends_at   >= CONVERT(TIME(0), a.ends_at))
                  THEN 0
             ELSE 1 END) AS fuera_de_horario,

           /* Dentro de una ausencia declarada. */
           CONVERT(BIT, CASE
             WHEN a.professional_id IS NULL THEN 0
             WHEN EXISTS (SELECT 1 FROM dbo.professional_time_off t
                           WHERE t.professional_id = a.professional_id
                             AND t.starts_at < a.ends_at AND a.starts_at < t.ends_at)
                  THEN 1 ELSE 0 END) AS en_ausencia,

           /* Otra cita de la misma persona a la misma hora. */
           (SELECT COUNT(*) FROM dbo.appointments b
             WHERE b.professional_id = a.professional_id
               AND b.id <> a.id
               AND b.status IN ('AGENDADA', 'CONFIRMADA')
               AND b.starts_at < a.ends_at AND a.starts_at < b.ends_at) AS citas_encimadas
      FROM dbo.appointments a
      JOIN dbo.customers c ON c.id = a.customer_id
      LEFT JOIN dbo.customer_assets ca ON ca.id = a.customer_asset_id
      LEFT JOIN dbo.professionals pr ON pr.id = a.professional_id
      LEFT JOIN dbo.services s ON s.product_id = a.service_product_id
      LEFT JOIN dbo.products p ON p.id = a.service_product_id
      LEFT JOIN dbo.service_orders o ON o.id = a.service_order_id
      LEFT JOIN dbo.users u ON u.id = a.created_by
     WHERE a.id = @id;
END
GO

/* ---------- sp_appointment_list (SQL_STORED_PROCEDURE) ---------- */
/* sp_appointment_list
 * Definicion canonica. Modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* La Agenda de un rango: dia, semana o mes.
 *
 * SIEMPRE UN RANGO, NUNCA "TODO"
 * ------------------------------
 * Una agenda sin fechas es la tabla entera, y a los dos anos son decenas de
 * miles de filas para pintar una semana. El rango es obligatorio y el indice
 * esta hecho para el.
 *
 * Devuelve tambien las AUSENCIAS del rango, en su propio conjunto: la Agenda
 * tiene que pintar las vacaciones de alguien como un bloque, no como un hueco
 * libre donde se puede agendar.
 */
CREATE OR ALTER PROCEDURE dbo.sp_appointment_list
    @desde           DATETIME2(0),
    @hasta           DATETIME2(0),
    @professional_id INT = NULL,
    @estados         NVARCHAR(200) = NULL,
    @customer_id     INT = NULL
AS
BEGIN
    SET NOCOUNT ON;

    IF @desde IS NULL OR @hasta IS NULL OR @hasta <= @desde
    BEGIN
        RAISERROR('El rango de fechas es obligatorio y tiene que ir hacia adelante.', 16, 1);
        RETURN;
    END

    DECLARE @filtro TABLE (estado NVARCHAR(15) PRIMARY KEY);
    IF @estados IS NOT NULL AND LTRIM(RTRIM(@estados)) <> ''
        INSERT INTO @filtro (estado)
        SELECT DISTINCT LTRIM(RTRIM(value)) FROM STRING_SPLIT(@estados, ',')
         WHERE LTRIM(RTRIM(value)) <> '';

    SELECT a.id, a.customer_id, c.customerName AS customer_name,
           c.phone AS customer_phone, c.mobile AS customer_mobile,
           a.customer_asset_id, ca.label AS asset_label,
           a.professional_id, pr.full_name AS professional_name, pr.color AS professional_color,
           a.service_product_id, p.nombre AS service_name,
           a.starts_at, a.ends_at, a.status,
           a.service_order_id, o.folio AS order_folio,
           a.rescheduled_from_id, a.notes
      FROM dbo.appointments a
      JOIN dbo.customers c ON c.id = a.customer_id
      LEFT JOIN dbo.customer_assets ca ON ca.id = a.customer_asset_id
      LEFT JOIN dbo.professionals pr ON pr.id = a.professional_id
      LEFT JOIN dbo.products p ON p.id = a.service_product_id
      LEFT JOIN dbo.service_orders o ON o.id = a.service_order_id
     WHERE a.starts_at < @hasta
       AND a.ends_at > @desde
       AND (@professional_id IS NULL OR a.professional_id = @professional_id)
       AND (@customer_id IS NULL OR a.customer_id = @customer_id)
       AND (NOT EXISTS (SELECT 1 FROM @filtro) OR a.status IN (SELECT estado FROM @filtro))
     ORDER BY a.starts_at, a.id;

    /* Las ausencias del rango: bloques, no huecos. */
    SELECT t.id, t.professional_id, pr.full_name AS professional_name,
           t.starts_at, t.ends_at, t.reason
      FROM dbo.professional_time_off t
      JOIN dbo.professionals pr ON pr.id = t.professional_id
     WHERE t.starts_at < @hasta
       AND t.ends_at > @desde
       AND (@professional_id IS NULL OR t.professional_id = @professional_id)
     ORDER BY t.starts_at;
END
GO

/* ---------- sp_appointment_reschedule (SQL_STORED_PROCEDURE) ---------- */
/* sp_appointment_reschedule
 * Definicion canonica. Modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* Mueve una cita a otra hora.
 *
 * NO REESCRIBE: CREA LA NUEVA Y ENLAZA
 * ------------------------------------
 * La cita original queda como CANCELADA con un enlace desde la nueva. Podria
 * haberse cambiado la fecha en la misma fila -es una linea de codigo menos-,
 * pero entonces un cliente al que se le mueve la cita tres veces dejaria una
 * sola fila con la ultima fecha, y la pregunta "¿por que este cliente siempre
 * se queja?" no tendria respuesta en ningun sitio.
 *
 * Con el enlace, tres reprogramaciones son tres filas encadenadas y se ven.
 *
 * SE HEREDA TODO SALVO LA HORA
 * ----------------------------
 * Cliente, activo, servicio y persona se conservan. Lo que se esta moviendo es
 * la hora; si ademas cambia el resto, eso es una cita distinta y se agenda
 * como tal.
 */
CREATE OR ALTER PROCEDURE dbo.sp_appointment_reschedule
    @id               INT,
    @starts_at        DATETIME2(0),
    @ends_at          DATETIME2(0) = NULL,
    @professional_id  INT = NULL,
    @reason           NVARCHAR(200) = NULL,
    @permitir_encimar BIT = 0,
    @user_id          INT = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    DECLARE @customer_id INT, @asset_id INT, @service_id INT,
            @prof_actual INT, @status NVARCHAR(15), @order_id INT,
            @duracion INT, @notes NVARCHAR(400);

    SELECT @customer_id = customer_id, @asset_id = customer_asset_id,
           @service_id = service_product_id, @prof_actual = professional_id,
           @status = status, @order_id = service_order_id, @notes = notes,
           @duracion = DATEDIFF(MINUTE, starts_at, ends_at)
      FROM dbo.appointments WHERE id = @id;

    IF @customer_id IS NULL
    BEGIN
        RAISERROR('Esa cita no existe.', 16, 1);
        RETURN;
    END

    IF @status NOT IN ('AGENDADA', 'CONFIRMADA')
    BEGIN
        RAISERROR('Solo se reprograma una cita que sigue en pie.', 16, 1);
        RETURN;
    END

    IF @order_id IS NOT NULL
    BEGIN
        RAISERROR('Esta cita ya genero una orden de servicio.', 16, 1);
        RETURN;
    END

    IF @ends_at IS NULL SET @ends_at = DATEADD(MINUTE, ISNULL(NULLIF(@duracion, 0), 30), @starts_at);

    DECLARE @nueva INT;

    BEGIN TRAN;

    UPDATE dbo.appointments
       SET status = 'CANCELADA',
           notes = LEFT(ISNULL(@notes + ' · ', '') + 'Reprogramada'
                        + CASE WHEN @reason IS NULL THEN '' ELSE ': ' + @reason END, 400),
           updated_at = SYSDATETIME()
     WHERE id = @id;

    INSERT INTO dbo.appointments
        (customer_id, customer_asset_id, professional_id, service_product_id,
         starts_at, ends_at, status, notes, created_by, rescheduled_from_id)
    VALUES
        (@customer_id, @asset_id, ISNULL(@professional_id, @prof_actual), @service_id,
         @starts_at, @ends_at, 'AGENDADA', @reason, @user_id, @id);

    SET @nueva = SCOPE_IDENTITY();

    /* El choque se comprueba DESPUES de crear la nueva y con la original ya
       cancelada: si se comprobara antes, la cita se chocaria consigo misma. */
    IF ISNULL(@professional_id, @prof_actual) IS NOT NULL AND @permitir_encimar = 0
       AND EXISTS (SELECT 1 FROM dbo.appointments b
                    WHERE b.professional_id = ISNULL(@professional_id, @prof_actual)
                      AND b.id <> @nueva
                      AND b.status IN ('AGENDADA', 'CONFIRMADA')
                      AND b.starts_at < @ends_at AND @starts_at < b.ends_at)
    BEGIN
        ROLLBACK TRAN;
        RAISERROR('Ya hay una cita a esa hora.', 16, 1);
        RETURN;
    END

    COMMIT TRAN;

    EXEC dbo.sp_appointment_get @id = @nueva;
END
GO

/* ---------- sp_appointment_save (SQL_STORED_PROCEDURE) ---------- */
/* sp_appointment_save
 * Definicion canonica. Modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* Agenda una cita, o corrige una que ya existe.
 *
 * ENCIMAR CITAS SE IMPIDE; TRABAJAR FUERA DE HORARIO, SE AVISA
 * ------------------------------------------------------------
 * Son dos cosas distintas y merecen dos respuestas distintas.
 *
 * Dos citas a la misma hora con la misma persona es una promesa que no se
 * puede cumplir: alguien va a esperar. Eso se impide. Con `@permitir_encimar`
 * se puede forzar -hay negocios que sobreagendan a proposito, contando con
 * que uno de cada cinco no llega- y entonces queda dicho en las notas, que es
 * distinto de que pase sin que nadie lo sepa.
 *
 * En cambio, atender un sabado fuera del horario habitual, o en mitad de unas
 * vacaciones, pasa constantemente y casi siempre a proposito. Impedirlo
 * obligaria a editar el horario para meter una cita. Se avisa y se sigue.
 *
 * LA DURACION SALE DEL SERVICIO
 * -----------------------------
 * Si no se dice cuando termina, se calcula con la duracion del servicio. Es
 * lo que la Agenda necesita para colocar el bloque, y pedirsela a quien agenda
 * por telefono es pedirle una cuenta que el sistema ya sabe hacer.
 */
CREATE OR ALTER PROCEDURE dbo.sp_appointment_save
    @id                 INT = NULL,
    @customer_id        INT,
    @customer_asset_id  INT = NULL,
    @professional_id    INT = NULL,
    @service_product_id INT = NULL,
    @starts_at          DATETIME2(0),
    @ends_at            DATETIME2(0) = NULL,
    @notes              NVARCHAR(400) = NULL,
    @permitir_encimar   BIT = 0,
    @user_id            INT = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    IF NOT EXISTS (SELECT 1 FROM dbo.customers WHERE id = @customer_id)
    BEGIN
        RAISERROR('El cliente no existe.', 16, 1);
        RETURN;
    END

    IF @customer_asset_id IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM dbo.customer_assets
                        WHERE id = @customer_asset_id AND customer_id = @customer_id)
    BEGIN
        RAISERROR('Ese activo no es de este cliente.', 16, 1);
        RETURN;
    END

    IF @professional_id IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM dbo.professionals WHERE id = @professional_id AND active = 1)
    BEGIN
        RAISERROR('Ese profesional no existe o esta dado de baja.', 16, 1);
        RETURN;
    END

    IF @service_product_id IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM dbo.services s
                       JOIN dbo.products p ON p.id = s.product_id
                       WHERE s.product_id = @service_product_id AND p.active = 1)
    BEGIN
        RAISERROR('Ese servicio no existe o esta dado de baja.', 16, 1);
        RETURN;
    END

    /* Quien no hace ese servicio no puede recibir la cita: el cliente llegaria
       a una hora que nadie puede atender. */
    IF @professional_id IS NOT NULL AND @service_product_id IS NOT NULL
       AND EXISTS (SELECT 1 FROM dbo.service_professionals WHERE service_product_id = @service_product_id)
       AND NOT EXISTS (SELECT 1 FROM dbo.service_professionals
                        WHERE service_product_id = @service_product_id
                          AND professional_id = @professional_id)
    BEGIN
        RAISERROR('Esa persona no tiene asignado este servicio.', 16, 1);
        RETURN;
    END

    IF @ends_at IS NULL
    BEGIN
        DECLARE @minutos INT = ISNULL(
            (SELECT duration_minutes FROM dbo.services WHERE product_id = @service_product_id), 30);
        SET @ends_at = DATEADD(MINUTE, @minutos, @starts_at);
    END

    IF @ends_at <= @starts_at
    BEGIN
        RAISERROR('La cita tiene que terminar despues de empezar.', 16, 1);
        RETURN;
    END

    -- --------------------------------------------------------- se encima?
    DECLARE @choque INT = NULL, @choque_desde DATETIME2(0);
    IF @professional_id IS NOT NULL
        SELECT TOP 1 @choque = a.id, @choque_desde = a.starts_at
          FROM dbo.appointments a
         WHERE a.professional_id = @professional_id
           AND a.status IN ('AGENDADA', 'CONFIRMADA')
           AND (@id IS NULL OR a.id <> @id)
           AND a.starts_at < @ends_at
           AND @starts_at < a.ends_at
         ORDER BY a.starts_at;

    IF @choque IS NOT NULL AND @permitir_encimar = 0
    BEGIN
        DECLARE @msg NVARCHAR(200) =
            'Ya hay una cita a esa hora (' + CONVERT(NVARCHAR(16), @choque_desde, 120) + ').';
        RAISERROR(@msg, 16, 1);
        RETURN;
    END

    IF @choque IS NOT NULL AND @permitir_encimar = 1
        SET @notes = LEFT(ISNULL(@notes + ' · ', '') + 'Encimada con la cita '
                          + CONVERT(NVARCHAR(12), @choque) + '.', 400);

    BEGIN TRAN;

    IF @id IS NULL
    BEGIN
        INSERT INTO dbo.appointments
            (customer_id, customer_asset_id, professional_id, service_product_id,
             starts_at, ends_at, status, notes, created_by)
        VALUES
            (@customer_id, @customer_asset_id, @professional_id, @service_product_id,
             @starts_at, @ends_at, 'AGENDADA', @notes, @user_id);
        SET @id = SCOPE_IDENTITY();
    END
    ELSE
    BEGIN
        IF EXISTS (SELECT 1 FROM dbo.appointments
                    WHERE id = @id AND status IN ('ATENDIDA', 'CANCELADA', 'NO_ASISTIO'))
        BEGIN
            ROLLBACK TRAN;
            RAISERROR('Esa cita ya esta cerrada. Para moverla, agenda una nueva.', 16, 1);
            RETURN;
        END

        UPDATE dbo.appointments
           SET customer_id = @customer_id,
               customer_asset_id = @customer_asset_id,
               professional_id = @professional_id,
               service_product_id = @service_product_id,
               starts_at = @starts_at,
               ends_at = @ends_at,
               notes = @notes,
               updated_at = SYSDATETIME()
         WHERE id = @id;

        IF @@ROWCOUNT = 0
        BEGIN
            ROLLBACK TRAN;
            RAISERROR('Esa cita ya no existe.', 16, 1);
            RETURN;
        END
    END

    COMMIT TRAN;

    EXEC dbo.sp_appointment_get @id = @id;
END
GO

/* ---------- sp_appointment_set_status (SQL_STORED_PROCEDURE) ---------- */
/* sp_appointment_set_status
 * Definicion canonica. Modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* Confirma, atiende, cancela o marca que no llego.
 *
 * "CANCELADA" Y "NO_ASISTIO" NO SON LO MISMO
 * ------------------------------------------
 * Una se avisa y la otra se pierde. Para el negocio son dos cosas distintas:
 * la primera libera el hueco con tiempo, la segunda deja a alguien parado una
 * hora. Juntarlas en un solo estado haria imposible saber cual de los dos
 * problemas tiene el negocio, que es justo lo que se querria saber.
 *
 * ATENDIDA SE PONE SOLA
 * ---------------------
 * Cuando la cita se convierte en orden de servicio,
 * `sp_appointment_to_order` la marca. Ponerla a mano existe para el caso en
 * que se atendio sin abrir orden -una revision de cortesia-, no como camino
 * normal.
 */
CREATE OR ALTER PROCEDURE dbo.sp_appointment_set_status
    @id      INT,
    @status  NVARCHAR(15),
    @notes   NVARCHAR(400) = NULL,
    @user_id INT = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    DECLARE @antes NVARCHAR(15), @order_id INT;
    SELECT @antes = status, @order_id = service_order_id FROM dbo.appointments WHERE id = @id;

    IF @antes IS NULL
    BEGIN
        RAISERROR('Esa cita no existe.', 16, 1);
        RETURN;
    END

    IF @status NOT IN ('AGENDADA', 'CONFIRMADA', 'ATENDIDA', 'CANCELADA', 'NO_ASISTIO')
    BEGIN
        RAISERROR('Estado de cita desconocido.', 16, 1);
        RETURN;
    END

    /* Una cita que ya genero trabajo no se cancela: el trabajo existe. Lo que
       se cancela en ese caso es la orden, y eso arrastra la cita. */
    IF @status IN ('CANCELADA', 'NO_ASISTIO') AND @order_id IS NOT NULL
    BEGIN
        RAISERROR('Esta cita ya genero una orden de servicio. Cancela la orden.', 16, 1);
        RETURN;
    END

    UPDATE dbo.appointments
       SET status = @status,
           notes = CASE WHEN @notes IS NULL THEN notes
                        ELSE LEFT(ISNULL(notes + ' · ', '') + @notes, 400) END,
           updated_at = SYSDATETIME()
     WHERE id = @id;

    EXEC dbo.sp_appointment_get @id = @id;
END
GO

/* ---------- sp_appointment_to_order (SQL_STORED_PROCEDURE) ---------- */
/* sp_appointment_to_order
 * Definicion canonica. Modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* El cliente llego: la cita se convierte en trabajo.
 *
 * ES EL MOMENTO EN QUE LA PROMESA SE CUMPLE
 * -----------------------------------------
 * La cita era una promesa; la orden es el trabajo. Este procedimiento es el
 * unico sitio donde una se convierte en la otra, y por eso hace las dos cosas
 * de una vez: abre la orden y marca la cita como atendida. Si fueran dos
 * llamadas, la mitad de las veces se quedaria una cita AGENDADA de un cliente
 * que lleva dos horas dentro.
 *
 * LA LINEA DEL SERVICIO SE ANADE SOLA
 * -----------------------------------
 * Si la cita decia que servicio era, la orden nace con esa linea. Es lo que
 * se acordo por telefono, y obligar a buscarlo otra vez en el catalogo con el
 * cliente delante es pedirle al mostrador que repita un trabajo ya hecho.
 *
 * ES IDEMPOTENTE
 * --------------
 * Si la cita ya tiene orden, se devuelve esa. Dos clics en "el cliente llego"
 * no pueden abrir dos ordenes del mismo trabajo.
 */
CREATE OR ALTER PROCEDURE dbo.sp_appointment_to_order
    @appointment_id INT,
    @user_id        INT = NULL,
    @register_id    INT = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    DECLARE @customer_id INT, @asset_id INT, @service_id INT, @prof_id INT,
            @status NVARCHAR(15), @order_id INT, @notes NVARCHAR(400);

    SELECT @customer_id = customer_id, @asset_id = customer_asset_id,
           @service_id = service_product_id, @prof_id = professional_id,
           @status = status, @order_id = service_order_id, @notes = notes
      FROM dbo.appointments WHERE id = @appointment_id;

    IF @customer_id IS NULL
    BEGIN
        RAISERROR('Esa cita no existe.', 16, 1);
        RETURN;
    END

    IF @order_id IS NOT NULL
    BEGIN
        EXEC dbo.sp_service_order_get @id = @order_id;
        RETURN;
    END

    IF @status IN ('CANCELADA', 'NO_ASISTIO')
    BEGIN
        RAISERROR('Esa cita esta cerrada.', 16, 1);
        RETURN;
    END

    BEGIN TRAN;

    INSERT INTO dbo.service_orders
        (customer_id, customer_asset_id, status, reported_issue, opened_by, register_id)
    VALUES
        (@customer_id, @asset_id, 'ABIERTA', @notes, @user_id, @register_id);

    SET @order_id = SCOPE_IDENTITY();

    INSERT INTO dbo.service_order_events
        (order_id, event_type, to_status, quote_version, detail, user_id)
    VALUES
        (@order_id, 'ABIERTA', 'ABIERTA', 1,
         'Desde la cita ' + CONVERT(NVARCHAR(12), @appointment_id), @user_id);

    UPDATE dbo.appointments
       SET status = 'ATENDIDA', service_order_id = @order_id, updated_at = SYSDATETIME()
     WHERE id = @appointment_id;

    COMMIT TRAN;

    /* La linea, fuera de la transaccion anterior y por el camino normal: las
       validaciones de `add_line` -producto activo, persona asignada- son las
       mismas aqui que en cualquier otro sitio, y duplicarlas seria tener dos
       versiones de la misma regla. */
    IF @service_id IS NOT NULL
        EXEC dbo.sp_service_order_add_line
            @order_id = @order_id,
            @product_id = @service_id,
            @quantity = 1,
            @professional_id = @prof_id,
            @user_id = @user_id;
    ELSE
        EXEC dbo.sp_service_order_get @id = @order_id;
END
GO

/* ---------- sp_commissions_report (SQL_STORED_PROCEDURE) ---------- */
/* sp_commissions_report
 * Definicion canonica. Modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* Cuanto genero cada persona en un periodo.
 *
 * ESTO NO ES NOMINA
 * -----------------
 * No hay pagos, ni periodos cerrados, ni descuentos, ni liquidaciones. Eso
 * quedo explicitamente fuera del alcance y meterlo a medias seria peor que no
 * tenerlo: una pantalla que dice "pagado" sin que nadie haya pagado nada es
 * una fuente de discusiones, no una herramienta.
 *
 * Lo que hay es el dato del que sale cualquier liquidacion: que trabajos se
 * cobraron, de quien eran y cuanto sumaban.
 *
 * SOLO CUENTA LO COBRADO
 * ----------------------
 * Una comision se devenga al cobrar la orden, no al terminarla. Un trabajo
 * hecho y sin cobrar no ha generado nada todavia, y ensenarlo como generado
 * seria prometer dinero que aun no entro.
 *
 * DOS CONJUNTOS: EL TOTAL POR PERSONA Y EL DETALLE
 * ------------------------------------------------
 * El primero es lo que se mira; el segundo es lo que se revisa cuando alguien
 * no esta de acuerdo con el primero.
 */
CREATE OR ALTER PROCEDURE dbo.sp_commissions_report
    @desde           DATE,
    @hasta           DATE,
    @professional_id INT = NULL
AS
BEGIN
    SET NOCOUNT ON;

    IF @desde IS NULL OR @hasta IS NULL
    BEGIN
        RAISERROR('Hacen falta las dos fechas.', 16, 1);
        RETURN;
    END

    DECLARE @fin DATETIME2(0) = DATEADD(DAY, 1, CONVERT(DATETIME2(0), @hasta));
    DECLARE @ini DATETIME2(0) = CONVERT(DATETIME2(0), @desde);

    SELECT pr.id AS professional_id,
           pr.full_name AS professional_name,
           pr.title,
           COUNT(*) AS lineas,
           COUNT(DISTINCT c.order_id) AS ordenes,
           SUM(c.base_amount) AS base,
           SUM(c.amount) AS comision
      FROM dbo.service_commissions c
      JOIN dbo.professionals pr ON pr.id = c.professional_id
     WHERE c.earned_at >= @ini AND c.earned_at < @fin
       AND (@professional_id IS NULL OR c.professional_id = @professional_id)
     GROUP BY pr.id, pr.full_name, pr.title
     ORDER BY SUM(c.amount) DESC;

    SELECT c.id, c.earned_at,
           c.professional_id, pr.full_name AS professional_name,
           c.order_id, o.folio AS order_folio,
           c.sale_id,
           l.name_snapshot AS concepto,
           l.quantity,
           c.base_amount, c.pct, c.amount,
           cu.customerName AS customer_name
      FROM dbo.service_commissions c
      JOIN dbo.professionals pr ON pr.id = c.professional_id
      JOIN dbo.service_orders o ON o.id = c.order_id
      JOIN dbo.service_order_lines l ON l.id = c.order_line_id
      JOIN dbo.customers cu ON cu.id = o.customer_id
     WHERE c.earned_at >= @ini AND c.earned_at < @fin
       AND (@professional_id IS NULL OR c.professional_id = @professional_id)
     ORDER BY c.earned_at DESC, c.id DESC;
END
GO

/* ---------- sp_customer_asset_save (SQL_STORED_PROCEDURE) ---------- */
/* sp_customer_asset_save
 * Definicion canonica. Modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* Guarda el activo de un cliente: su coche, su mascota, su maquina.
 *
 * `label` es lo unico obligatorio ademas del cliente, y es a proposito: en el
 * mostrador, lo primero que se sabe es como llamarlo. La placa, el ano y el
 * color se rellenan despues, o nunca. Un alta que exija ocho campos no se
 * hace con el cliente delante.
 */
CREATE OR ALTER PROCEDURE dbo.sp_customer_asset_save
    @id                   INT = NULL,
    @customer_id          INT,
    @kind                 NVARCHAR(20) = 'OTRO',
    @label                NVARCHAR(120),
    @identifier           NVARCHAR(60) = NULL,
    @secondary_identifier NVARCHAR(60) = NULL,
    @brand                NVARCHAR(60) = NULL,
    @model                NVARCHAR(60) = NULL,
    @year_or_age          NVARCHAR(20) = NULL,
    @color                NVARCHAR(40) = NULL,
    @notes                NVARCHAR(400) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    IF @label IS NULL OR LTRIM(RTRIM(@label)) = ''
    BEGIN
        RAISERROR('Ponle un nombre para reconocerlo.', 16, 1);
        RETURN;
    END

    IF NOT EXISTS (SELECT 1 FROM dbo.customers WHERE id = @customer_id)
    BEGIN
        RAISERROR('El cliente no existe.', 16, 1);
        RETURN;
    END

    /* Vacio y NULL son lo mismo para un identificador, y guardarlos distinto
       convierte "buscar por placa" en dos busquedas. */
    SET @identifier = NULLIF(LTRIM(RTRIM(@identifier)), '');
    SET @secondary_identifier = NULLIF(LTRIM(RTRIM(@secondary_identifier)), '');

    IF @id IS NULL
    BEGIN
        INSERT INTO dbo.customer_assets
            (customer_id, kind, label, identifier, secondary_identifier,
             brand, model, year_or_age, color, notes)
        VALUES
            (@customer_id, ISNULL(@kind, 'OTRO'), @label, @identifier, @secondary_identifier,
             @brand, @model, @year_or_age, @color, @notes);
        SET @id = SCOPE_IDENTITY();
    END
    ELSE
    BEGIN
        UPDATE dbo.customer_assets
           SET customer_id = @customer_id,
               kind = ISNULL(@kind, kind),
               label = @label,
               identifier = @identifier,
               secondary_identifier = @secondary_identifier,
               brand = @brand,
               model = @model,
               year_or_age = @year_or_age,
               color = @color,
               notes = @notes,
               updated_at = SYSDATETIME()
         WHERE id = @id;

        IF @@ROWCOUNT = 0
        BEGIN
            RAISERROR('Ese registro ya no existe.', 16, 1);
            RETURN;
        END
    END

    SELECT * FROM dbo.customer_assets WHERE id = @id;
END
GO

/* ---------- sp_customer_asset_set_active (SQL_STORED_PROCEDURE) ---------- */
/* sp_customer_asset_set_active
 * Definicion canonica. Modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* Retira un activo de las listas, o lo devuelve.
 *
 * El cliente vendio el coche. No se borra: las ordenes de servicio que se le
 * hicieron siguen siendo suyas y siguen teniendo que poder consultarse.
 */
CREATE OR ALTER PROCEDURE dbo.sp_customer_asset_set_active
    @id     INT,
    @active BIT
AS
BEGIN
    SET NOCOUNT ON;

    UPDATE dbo.customer_assets
       SET active = @active, updated_at = SYSDATETIME()
     WHERE id = @id;

    IF @@ROWCOUNT = 0
    BEGIN
        RAISERROR('Ese registro ya no existe.', 16, 1);
        RETURN;
    END

    SELECT @id AS id, @active AS active;
END
GO

/* ---------- sp_get_customer_assets (SQL_STORED_PROCEDURE) ---------- */
/* sp_get_customer_assets
 * Definicion canonica. Modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* Los activos de un cliente, o la busqueda por lo que los identifica.
 *
 * DOS FORMAS DE LLEGAR, PORQUE HAY DOS SITUACIONES
 * ------------------------------------------------
 * Con `@customer_id`: ya se sabe quien es y se elige cual de sus coches.
 * Con `@busqueda`: llega el coche y no llega el nombre. En un taller esto es
 * lo habitual, y obligar a encontrar antes al cliente convierte una busqueda
 * de placa en dos pantallas.
 *
 * Viene el nombre del cliente en la misma fila justamente por eso: quien busca
 * por placa necesita saber de quien es.
 */
CREATE OR ALTER PROCEDURE dbo.sp_get_customer_assets
    @customer_id  INT = NULL,
    @busqueda     NVARCHAR(60) = NULL,
    @solo_activos BIT = 1
AS
BEGIN
    SET NOCOUNT ON;

    SET @busqueda = NULLIF(LTRIM(RTRIM(@busqueda)), '');

    SELECT a.id, a.customer_id, c.customerName AS customer_name,
           a.kind, a.label, a.identifier, a.secondary_identifier,
           a.brand, a.model, a.year_or_age, a.color, a.notes, a.active,
           a.created_at, a.updated_at,
           (SELECT COUNT(*) FROM dbo.service_orders o WHERE o.customer_asset_id = a.id) AS orders_count
      FROM dbo.customer_assets a
      JOIN dbo.customers c ON c.id = a.customer_id
     WHERE (@solo_activos = 0 OR a.active = 1)
       AND (@customer_id IS NULL OR a.customer_id = @customer_id)
       AND (@busqueda IS NULL
            OR a.identifier LIKE '%' + @busqueda + '%'
            OR a.secondary_identifier LIKE '%' + @busqueda + '%'
            OR a.label LIKE '%' + @busqueda + '%')
     ORDER BY c.customerName, a.label;
END
GO

/* ---------- sp_get_professional_schedule (SQL_STORED_PROCEDURE) ---------- */
/* sp_get_professional_schedule
 * Definicion canonica. Modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* El horario semanal y las ausencias de una persona, o de todas.
 *
 * Dos conjuntos porque son dos cosas distintas: el horario se repite cada
 * semana y las ausencias tienen fecha. Devolverlas mezcladas obligaria a quien
 * las reciba a separarlas otra vez.
 *
 * Las ausencias viejas no se traen: una pantalla de horarios con las
 * vacaciones del ano pasado es una pantalla que nadie lee.
 */
CREATE OR ALTER PROCEDURE dbo.sp_get_professional_schedule
    @professional_id INT = NULL
AS
BEGIN
    SET NOCOUNT ON;

    SELECT s.id, s.professional_id, p.full_name, s.weekday, s.starts_at, s.ends_at, s.active
      FROM dbo.professional_schedules s
      JOIN dbo.professionals p ON p.id = s.professional_id
     WHERE (@professional_id IS NULL OR s.professional_id = @professional_id)
     ORDER BY p.full_name, s.weekday, s.starts_at;

    SELECT t.id, t.professional_id, p.full_name, t.starts_at, t.ends_at, t.reason
      FROM dbo.professional_time_off t
      JOIN dbo.professionals p ON p.id = t.professional_id
     WHERE (@professional_id IS NULL OR t.professional_id = @professional_id)
       AND t.ends_at >= DATEADD(DAY, -30, SYSDATETIME())
     ORDER BY t.starts_at;
END
GO

/* ---------- sp_get_professionals (SQL_STORED_PROCEDURE) ---------- */
/* sp_get_professionals
 * Definicion canonica. Modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* Quien hace el trabajo, con lo que la pantalla necesita para pintarlo.
 *
 * `services_count` distingue "hace de todo" -ninguna fila en la matriz- de
 * "hace estos cuatro". `open_lines` dice cuanto tiene encima ahora mismo, que
 * es lo que de verdad se pregunta al repartir un trabajo que acaba de entrar.
 */
CREATE OR ALTER PROCEDURE dbo.sp_get_professionals
    @solo_activos BIT = 1,
    @service_product_id INT = NULL
AS
BEGIN
    SET NOCOUNT ON;

    SELECT pr.id, pr.full_name, pr.title, pr.phone, pr.email,
           pr.user_id, u.usuario AS user_name,
           pr.default_commission_pct, pr.color, pr.active,
           (SELECT COUNT(*) FROM dbo.service_professionals sp
             WHERE sp.professional_id = pr.id) AS services_count,
           (SELECT COUNT(*) FROM dbo.service_order_lines l
              JOIN dbo.service_orders o ON o.id = l.order_id
             WHERE l.professional_id = pr.id
               AND l.status IN ('PENDIENTE', 'EN_PROCESO')
               AND o.status NOT IN ('CANCELADA', 'ENTREGADA')) AS open_lines
      FROM dbo.professionals pr
      LEFT JOIN dbo.users u ON u.id = pr.user_id
     WHERE (@solo_activos = 0 OR pr.active = 1)
       AND (@service_product_id IS NULL
            /* Sin matriz para ese servicio, lo hace cualquiera. */
            OR NOT EXISTS (SELECT 1 FROM dbo.service_professionals sp
                            WHERE sp.service_product_id = @service_product_id)
            OR EXISTS (SELECT 1 FROM dbo.service_professionals sp
                        WHERE sp.service_product_id = @service_product_id
                          AND sp.professional_id = pr.id))
     ORDER BY pr.full_name;
END
GO

/* ---------- sp_get_services (SQL_STORED_PROCEDURE) ---------- */
/* sp_get_services
 * Definicion canonica. Modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* El catalogo de servicios, con lo que cada uno tiene de producto y de
 * servicio en una sola fila.
 *
 * Devuelve tambien cuantas personas lo hacen: la pantalla necesita distinguir
 * "lo hace cualquiera" -sin filas en `service_professionals`- de "lo hacen
 * estas tres", y sin el conteo tendria que pedir la matriz entera para
 * pintar una lista.
 */
CREATE OR ALTER PROCEDURE dbo.sp_get_services
    @solo_activos BIT = 1,
    @busqueda     NVARCHAR(100) = NULL
AS
BEGIN
    SET NOCOUNT ON;

    SELECT p.id AS product_id,
           p.part_number,
           p.nombre,
           p.price,
           p.tasa_iva,
           p.clave_prod_serv,
           p.clave_unidad,
           p.category_id,
           c.namee AS category_name,
           p.active,
           s.duration_minutes,
           s.requires_professional,
           s.default_commission_pct,
           s.schedulable,
           s.notes,
           (SELECT COUNT(*) FROM dbo.service_professionals sp
             WHERE sp.service_product_id = p.id) AS professionals_count
      FROM dbo.services s
      JOIN dbo.products p ON p.id = s.product_id
      LEFT JOIN dbo.CAT_categories c ON c.id = p.category_id
     WHERE (@solo_activos = 0 OR p.active = 1)
       AND (@busqueda IS NULL
            OR p.nombre LIKE '%' + @busqueda + '%'
            OR p.part_number LIKE '%' + @busqueda + '%')
     ORDER BY p.nombre;
END
GO

/* ---------- sp_professional_availability (SQL_STORED_PROCEDURE) ---------- */
/* sp_professional_availability
 * Definicion canonica. Modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* Los huecos libres de un dia, por persona.
 *
 * ES LO QUE SE PREGUNTA POR TELEFONO
 * ----------------------------------
 * "¿Para cuando me puede dar?" La respuesta util no es la agenda entera: son
 * las horas concretas en las que cabe ESE servicio. Por eso recibe la duracion
 * -o el servicio, de donde se saca- y devuelve huecos de ese tamano, no
 * intervalos genericos que luego alguien tenga que trocear a ojo.
 *
 * SE PARTE DEL HORARIO Y SE RESTA LO OCUPADO
 * ------------------------------------------
 * Del horario semanal se quitan las ausencias y las citas en pie. Lo que
 * queda, troceado cada `@paso` minutos, es lo que se puede ofrecer.
 *
 * Sin horario declarado no se devuelve nada, y eso es correcto: un negocio que
 * no dijo cuando trabaja no puede recibir una respuesta inventada. La pantalla
 * lo dice y ofrece declararlo.
 */
CREATE OR ALTER PROCEDURE dbo.sp_professional_availability
    @fecha              DATE,
    @professional_id    INT = NULL,
    @service_product_id INT = NULL,
    @duracion_minutos   INT = NULL,
    @paso_minutos       INT = 15
AS
BEGIN
    SET NOCOUNT ON;

    IF @fecha IS NULL
    BEGIN
        RAISERROR('Hace falta la fecha.', 16, 1);
        RETURN;
    END

    SET @paso_minutos = CASE WHEN ISNULL(@paso_minutos, 0) <= 0 THEN 15 ELSE @paso_minutos END;

    DECLARE @duracion INT = ISNULL(
        @duracion_minutos,
        ISNULL((SELECT duration_minutes FROM dbo.services WHERE product_id = @service_product_id), 30));

    DECLARE @dia TINYINT = DATEPART(WEEKDAY, @fecha);
    DECLARE @inicio DATETIME2(0) = CONVERT(DATETIME2(0), @fecha);
    DECLARE @fin DATETIME2(0) = DATEADD(DAY, 1, @inicio);

    /* Quien entra en la respuesta: quien trabaja ese dia y, si se pidio un
       servicio, quien lo hace. Sin matriz para ese servicio, lo hace
       cualquiera. */
    DECLARE @gente TABLE (professional_id INT PRIMARY KEY);
    INSERT INTO @gente (professional_id)
    SELECT p.id
      FROM dbo.professionals p
     WHERE p.active = 1
       AND (@professional_id IS NULL OR p.id = @professional_id)
       AND (@service_product_id IS NULL
            OR NOT EXISTS (SELECT 1 FROM dbo.service_professionals sp
                            WHERE sp.service_product_id = @service_product_id)
            OR EXISTS (SELECT 1 FROM dbo.service_professionals sp
                        WHERE sp.service_product_id = @service_product_id
                          AND sp.professional_id = p.id));

    /* Todos los comienzos posibles del dia, cada `@paso` minutos. La tabla de
       numeros se construye al vuelo: son 96 filas para un paso de 15 minutos
       y no merece una tabla permanente. */
    WITH pasos AS (
        SELECT 0 AS n
        UNION ALL
        SELECT n + 1 FROM pasos WHERE n + 1 < (1440 / @paso_minutos)
    ),
    candidatos AS (
        SELECT g.professional_id,
               DATEADD(MINUTE, p.n * @paso_minutos, @inicio) AS desde,
               DATEADD(MINUTE, p.n * @paso_minutos + @duracion, @inicio) AS hasta
          FROM @gente g
         CROSS JOIN pasos p
    )
    SELECT c.professional_id,
           pr.full_name AS professional_name,
           pr.color AS professional_color,
           c.desde AS starts_at,
           c.hasta AS ends_at
      FROM candidatos c
      JOIN dbo.professionals pr ON pr.id = c.professional_id
     WHERE c.hasta <= @fin
       /* Dentro de una franja de su horario, entera. */
       AND EXISTS (SELECT 1 FROM dbo.professional_schedules s
                    WHERE s.professional_id = c.professional_id
                      AND s.active = 1
                      AND s.weekday = @dia
                      AND s.starts_at <= CONVERT(TIME(0), c.desde)
                      AND s.ends_at   >= CONVERT(TIME(0), c.hasta))
       /* Ni en una ausencia. */
       AND NOT EXISTS (SELECT 1 FROM dbo.professional_time_off t
                        WHERE t.professional_id = c.professional_id
                          AND t.starts_at < c.hasta AND c.desde < t.ends_at)
       /* Ni encima de una cita en pie. */
       AND NOT EXISTS (SELECT 1 FROM dbo.appointments a
                        WHERE a.professional_id = c.professional_id
                          AND a.status IN ('AGENDADA', 'CONFIRMADA')
                          AND a.starts_at < c.hasta AND c.desde < a.ends_at)
     ORDER BY pr.full_name, c.desde
     OPTION (MAXRECURSION 200);
END
GO

/* ---------- sp_professional_save (SQL_STORED_PROCEDURE) ---------- */
/* sp_professional_save
 * Definicion canonica. Modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* Da de alta a quien hace el trabajo.
 *
 * ENLAZAR CON UN USUARIO NO LE DA PERMISOS
 * ----------------------------------------
 * `@user_id` dice "este profesional ademas entra a Wybix". Sirve para que vea
 * su propia agenda y para saber quien atendio. Lo que puede hacer lo sigue
 * decidiendo `users.rol` y el catalogo de paquetes del binario.
 *
 * Es opcional porque hay negocios donde el mecanico no toca la caja: exigirle
 * un usuario seria crear credenciales que nadie usa, y unas credenciales que
 * nadie usa son las que acaban compartidas.
 *
 * Y es unico: una persona no puede ser dos profesionales. Si lo fuera, sus
 * comisiones se repartirian entre dos filas y ninguna de las dos seria la
 * suya.
 */
CREATE OR ALTER PROCEDURE dbo.sp_professional_save
    @id                     INT = NULL,
    @full_name              NVARCHAR(120),
    @title                  NVARCHAR(60) = NULL,
    @phone                  NVARCHAR(30) = NULL,
    @email                  NVARCHAR(120) = NULL,
    @user_id                INT = NULL,
    @default_commission_pct DECIMAL(5, 2) = 0,
    @color                  NVARCHAR(9) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    IF @full_name IS NULL OR LTRIM(RTRIM(@full_name)) = ''
    BEGIN
        RAISERROR('El profesional necesita un nombre.', 16, 1);
        RETURN;
    END

    IF @default_commission_pct IS NULL OR @default_commission_pct < 0 OR @default_commission_pct > 100
    BEGIN
        RAISERROR('La comision va de 0 a 100.', 16, 1);
        RETURN;
    END

    IF @user_id IS NOT NULL
    BEGIN
        IF NOT EXISTS (SELECT 1 FROM dbo.users WHERE id = @user_id)
        BEGIN
            RAISERROR('Ese usuario no existe.', 16, 1);
            RETURN;
        END
        IF EXISTS (SELECT 1 FROM dbo.professionals
                    WHERE user_id = @user_id AND (@id IS NULL OR id <> @id))
        BEGIN
            RAISERROR('Ese usuario ya esta enlazado con otro profesional.', 16, 1);
            RETURN;
        END
    END

    IF @id IS NULL
    BEGIN
        INSERT INTO dbo.professionals
            (full_name, title, phone, email, user_id, default_commission_pct, color)
        VALUES
            (@full_name, @title, @phone, @email, @user_id, @default_commission_pct, @color);
        SET @id = SCOPE_IDENTITY();
    END
    ELSE
    BEGIN
        UPDATE dbo.professionals
           SET full_name = @full_name,
               title = @title,
               phone = @phone,
               email = @email,
               user_id = @user_id,
               default_commission_pct = @default_commission_pct,
               color = @color,
               updated_at = SYSDATETIME()
         WHERE id = @id;

        IF @@ROWCOUNT = 0
        BEGIN
            RAISERROR('Ese profesional ya no existe.', 16, 1);
            RETURN;
        END
    END

    SELECT * FROM dbo.professionals WHERE id = @id;
END
GO

/* ---------- sp_professional_set_active (SQL_STORED_PROCEDURE) ---------- */
/* sp_professional_set_active
 * Definicion canonica. Modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* Da de baja a un profesional, o lo devuelve.
 *
 * NO SE PUEDE DAR DE BAJA CON TRABAJO ENCIMA
 * ------------------------------------------
 * Si tiene lineas pendientes en ordenes abiertas, esas lineas se quedarian sin
 * responsable y sus comisiones sin destinatario. Primero se reasigna el
 * trabajo, despues se da de baja. Decirlo con el numero delante es mas util
 * que un "no se puede" a secas.
 */
CREATE OR ALTER PROCEDURE dbo.sp_professional_set_active
    @id     INT,
    @active BIT
AS
BEGIN
    SET NOCOUNT ON;

    IF @active = 0
    BEGIN
        DECLARE @pendientes INT = (
            SELECT COUNT(*)
              FROM dbo.service_order_lines l
              JOIN dbo.service_orders o ON o.id = l.order_id
             WHERE l.professional_id = @id
               AND l.status IN ('PENDIENTE', 'EN_PROCESO')
               AND o.status NOT IN ('CANCELADA', 'ENTREGADA'));

        IF @pendientes > 0
        BEGIN
            DECLARE @msg NVARCHAR(200) =
                'Tiene ' + CONVERT(NVARCHAR(10), @pendientes) +
                ' trabajo(s) sin terminar. Reasignalos antes de darlo de baja.';
            RAISERROR(@msg, 16, 1);
            RETURN;
        END
    END

    UPDATE dbo.professionals
       SET active = @active, updated_at = SYSDATETIME()
     WHERE id = @id;

    IF @@ROWCOUNT = 0
    BEGIN
        RAISERROR('Ese profesional ya no existe.', 16, 1);
        RETURN;
    END

    SELECT @id AS id, @active AS active;
END
GO

/* ---------- sp_professional_time_off_delete (SQL_STORED_PROCEDURE) ---------- */
/* sp_professional_time_off_delete
 * Definicion canonica. Modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* Quita una ausencia y devuelve esas horas a la agenda.
 *
 * Esto SI borra, y es de las pocas cosas del modulo que lo hacen. Una ausencia
 * no es un hecho del negocio -no se le cobro nada a nadie, no cambio ningun
 * saldo-: es una prevision que dejo de serlo. Conservarla marcada como
 * "anulada" solo llenaria la pantalla de horarios de ruido.
 */
CREATE OR ALTER PROCEDURE dbo.sp_professional_time_off_delete
    @id INT
AS
BEGIN
    SET NOCOUNT ON;

    DELETE FROM dbo.professional_time_off WHERE id = @id;

    IF @@ROWCOUNT = 0
    BEGIN
        RAISERROR('Esa ausencia ya no existe.', 16, 1);
        RETURN;
    END

    SELECT @id AS id;
END
GO

/* ---------- sp_professional_time_off_save (SQL_STORED_PROCEDURE) ---------- */
/* sp_professional_time_off_save
 * Definicion canonica. Modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* Una ausencia: vacaciones, una tarde libre, una incapacidad.
 *
 * AVISA DE LAS CITAS QUE SE QUEDAN DENTRO, PERO NO LAS TOCA
 * ---------------------------------------------------------
 * Cancelarlas solo seria decidir por el negocio: a esas personas hay que
 * llamarlas, y hasta que alguien llame la cita sigue existiendo. Lo que se
 * hace es devolver cuales son, con su telefono, para que la pantalla lo diga
 * y alguien pueda hacer las llamadas.
 *
 * `@id = NULL` da de alta; con `@id` se corrige una existente. Borrar es otro
 * procedimiento porque devuelve horas a la agenda y eso merece ser una
 * decision aparte.
 */
CREATE OR ALTER PROCEDURE dbo.sp_professional_time_off_save
    @id              INT = NULL,
    @professional_id INT,
    @starts_at       DATETIME2(0),
    @ends_at         DATETIME2(0),
    @reason          NVARCHAR(200) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    IF @ends_at <= @starts_at
    BEGIN
        RAISERROR('La ausencia tiene que terminar despues de empezar.', 16, 1);
        RETURN;
    END

    IF NOT EXISTS (SELECT 1 FROM dbo.professionals WHERE id = @professional_id)
    BEGIN
        RAISERROR('Ese profesional no existe.', 16, 1);
        RETURN;
    END

    IF @id IS NULL
    BEGIN
        INSERT INTO dbo.professional_time_off (professional_id, starts_at, ends_at, reason)
        VALUES (@professional_id, @starts_at, @ends_at, @reason);
        SET @id = SCOPE_IDENTITY();
    END
    ELSE
    BEGIN
        UPDATE dbo.professional_time_off
           SET professional_id = @professional_id,
               starts_at = @starts_at,
               ends_at = @ends_at,
               reason = @reason
         WHERE id = @id;

        IF @@ROWCOUNT = 0
        BEGIN
            RAISERROR('Esa ausencia ya no existe.', 16, 1);
            RETURN;
        END
    END

    SELECT * FROM dbo.professional_time_off WHERE id = @id;

    /* Las citas que quedan dentro. No se tocan: se avisan. */
    SELECT a.id, a.starts_at, a.ends_at, a.status,
           c.customerName AS customer_name, c.phone, c.mobile
      FROM dbo.appointments a
      JOIN dbo.customers c ON c.id = a.customer_id
     WHERE a.professional_id = @professional_id
       AND a.status IN ('AGENDADA', 'CONFIRMADA')
       AND a.starts_at < @ends_at
       AND @starts_at < a.ends_at
     ORDER BY a.starts_at;
END
GO

/* ---------- sp_service_order_add_line (SQL_STORED_PROCEDURE) ---------- */
/* sp_service_order_add_line
 * Definicion canonica. Modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* Anade trabajo o refacciones a una orden.
 *
 * SERVICIOS Y PRODUCTOS, LA MISMA LISTA
 * -------------------------------------
 * En un taller no son dos documentos: el cliente ve un solo total. Lo que
 * cambia entre uno y otro es el inventario -una refaccion descuenta
 * existencias al cobrar, una hora de trabajo no- y quien comisiona. La forma
 * de la linea es la misma, y por eso `line_kind` se deduce del producto en vez
 * de pedirlo: si tiene ficha en `services`, es un servicio. No hay forma de
 * equivocarse porque no hay nada que elegir.
 *
 * TODO SE CONGELA AL ANADIR
 * -------------------------
 * Nombre, precio, costo, tasa y porcentaje de comision se copian ahora. Si
 * manana sube el precio del aceite, el presupuesto que el cliente autorizo
 * ayer sigue costando lo de ayer. Sin la copia, un cambio de catalogo
 * reescribiria presupuestos aprobados y comisiones ya calculadas sin que
 * nadie lo pidiera.
 *
 * EL INVENTARIO NO SE MUEVE AQUI
 * ------------------------------
 * Ni se reserva. Anadir una refaccion a una orden no la saca del almacen:
 * eso pasa al cobrar, por la misma via que cualquier venta. Una orden abierta
 * tres dias que reservara piezas dejaria el inventario diciendo que hay menos
 * de lo que hay, y la caja de al lado no podria vender lo que tiene delante.
 *
 * SUBE EL PRESUPUESTO
 * -------------------
 * Anadir una linea mueve el importe, asi que `quote_version` sube. Si el
 * cliente ya habia autorizado, la orden queda marcada como pendiente de
 * reautorizacion, y eso es exactamente lo que se quiere: lo que autorizo ya no
 * es lo que se le va a cobrar.
 */
CREATE OR ALTER PROCEDURE dbo.sp_service_order_add_line
    @order_id        INT,
    @product_id      INT,
    @quantity        DECIMAL(12, 2) = 1,
    @professional_id INT = NULL,
    @unit_price      DECIMAL(12, 2) = NULL,
    @commission_pct  DECIMAL(5, 2) = NULL,
    @notes           NVARCHAR(400) = NULL,
    @user_id         INT = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    DECLARE @status NVARCHAR(20), @sale_id INT;
    SELECT @status = status, @sale_id = sale_id FROM dbo.service_orders WHERE id = @order_id;

    IF @status IS NULL
    BEGIN
        RAISERROR('Esa orden no existe.', 16, 1);
        RETURN;
    END

    /* Una orden ya cobrada no admite lineas nuevas: el total cambiaria y la
       venta ya no cuadraria con lo que la orden dice. Lo que se hace en ese
       caso es otra orden, o una devolucion sobre la venta. */
    IF @sale_id IS NOT NULL
    BEGIN
        RAISERROR('Esta orden ya se cobro. Abre una nueva para trabajo adicional.', 16, 1);
        RETURN;
    END

    IF @status = 'CANCELADA'
    BEGIN
        RAISERROR('Esta orden esta cancelada.', 16, 1);
        RETURN;
    END

    IF @quantity IS NULL OR @quantity <= 0
    BEGIN
        RAISERROR('La cantidad tiene que ser mayor que cero.', 16, 1);
        RETURN;
    END

    DECLARE @nombre NVARCHAR(100), @precio DECIMAL(10, 2), @costo DECIMAL(14, 4),
            @iva DECIMAL(5, 4), @activo BIT;
    SELECT @nombre = nombre, @precio = price, @costo = cost,
           @iva = tasa_iva, @activo = ISNULL(active, 0)
      FROM dbo.products WHERE id = @product_id;

    IF @nombre IS NULL
    BEGIN
        RAISERROR('Ese producto no existe.', 16, 1);
        RETURN;
    END

    IF @activo = 0
    BEGIN
        RAISERROR('Ese producto esta dado de baja.', 16, 1);
        RETURN;
    END

    DECLARE @es_servicio BIT =
        CASE WHEN EXISTS (SELECT 1 FROM dbo.services WHERE product_id = @product_id) THEN 1 ELSE 0 END;
    DECLARE @line_kind NVARCHAR(10) = CASE WHEN @es_servicio = 1 THEN 'SERVICIO' ELSE 'PRODUCTO' END;

    /* Quien no puede hacer ese servicio no puede quedarse con la linea: la
       comision saldria a nombre de alguien que no lo hizo. Sin matriz para ese
       servicio, lo hace cualquiera. */
    IF @professional_id IS NOT NULL AND @es_servicio = 1
       AND EXISTS (SELECT 1 FROM dbo.service_professionals WHERE service_product_id = @product_id)
       AND NOT EXISTS (SELECT 1 FROM dbo.service_professionals
                        WHERE service_product_id = @product_id
                          AND professional_id = @professional_id)
    BEGIN
        RAISERROR('Esa persona no tiene asignado este servicio.', 16, 1);
        RETURN;
    END

    IF @professional_id IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM dbo.professionals WHERE id = @professional_id AND active = 1)
    BEGIN
        RAISERROR('Ese profesional no existe o esta dado de baja.', 16, 1);
        RETURN;
    END

    /* El precio: el que se pase -un descuento pactado en el mostrador- o el
       del catalogo. Cero es un precio valido: una cortesia. */
    DECLARE @precio_final DECIMAL(12, 2) = ISNULL(@unit_price, @precio);
    IF @precio_final < 0
    BEGIN
        RAISERROR('El precio no puede ser negativo.', 16, 1);
        RETURN;
    END

    /* LA COMISION, DE LO MAS CONCRETO A LO MAS GENERAL.
       Lo que se pase gana; si no, lo pactado para esa persona en ese servicio;
       si no, lo del servicio; si no, lo de la persona. Un producto no
       comisiona salvo que alguien lo diga expresamente. */
    DECLARE @comision DECIMAL(5, 2) = @commission_pct;
    IF @comision IS NULL AND @professional_id IS NOT NULL
    BEGIN
        SELECT @comision = sp.commission_pct
          FROM dbo.service_professionals sp
         WHERE sp.service_product_id = @product_id AND sp.professional_id = @professional_id;

        IF @comision IS NULL AND @es_servicio = 1
            SELECT @comision = default_commission_pct FROM dbo.services WHERE product_id = @product_id;

        IF @comision IS NULL
            SELECT @comision = default_commission_pct FROM dbo.professionals WHERE id = @professional_id;
    END

    IF @comision IS NOT NULL AND (@comision < 0 OR @comision > 100)
    BEGIN
        RAISERROR('La comision va de 0 a 100.', 16, 1);
        RETURN;
    END

    BEGIN TRAN;

    DECLARE @line_no INT =
        ISNULL((SELECT MAX(line_no) FROM dbo.service_order_lines WHERE order_id = @order_id), 0) + 1;

    INSERT INTO dbo.service_order_lines
        (order_id, line_no, line_kind, product_id,
         name_snapshot, unit_price_snapshot, unit_cost_snapshot, tasa_iva_snapshot,
         quantity, professional_id, commission_pct_snapshot, status, notes, added_by)
    VALUES
        (@order_id, @line_no, @line_kind, @product_id,
         @nombre, @precio_final, @costo, ISNULL(@iva, 0.16),
         @quantity, @professional_id, @comision, 'PENDIENTE', @notes, @user_id);

    DECLARE @line_id INT = SCOPE_IDENTITY();

    UPDATE dbo.service_orders
       SET quote_version = quote_version + 1,
           status = CASE WHEN status = 'BORRADOR' THEN 'BORRADOR' ELSE status END
     WHERE id = @order_id;

    DECLARE @version INT = (SELECT quote_version FROM dbo.service_orders WHERE id = @order_id);

    INSERT INTO dbo.service_order_events
        (order_id, event_type, quote_version, amount, detail, user_id)
    VALUES
        (@order_id, 'LINEA_ANADIDA', @version,
         CONVERT(DECIMAL(14, 2), @quantity * @precio_final),
         @nombre + ' x' + CONVERT(NVARCHAR(20), @quantity), @user_id);

    COMMIT TRAN;

    EXEC dbo.sp_service_order_get @id = @order_id;
END
GO

/* ---------- sp_service_order_authorize (SQL_STORED_PROCEDURE) ---------- */
/* sp_service_order_authorize
 * Definicion canonica. Modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* El cliente aprueba el presupuesto.
 *
 * SE AUTORIZA UNA VERSION, NO "LA ORDEN"
 * --------------------------------------
 * El cliente aprueba un importe concreto. Si despues se anade una linea, lo
 * que aprobo ya no es lo que se le va a cobrar, y decir que "la orden esta
 * autorizada" seria falso. Por eso se guarda CUAL version aprobo: cuando el
 * presupuesto vuelva a moverse, la comparacion lo dira sola.
 *
 * Sin esto, la conversacion del mostrador es "usted autorizo" contra "yo
 * autorice otra cosa", y no hay forma de saber quien tiene razon.
 *
 * QUIEN AUTORIZA NO TIENE USUARIO EN WYBIX
 * ----------------------------------------
 * Es el cliente, por telefono o en el mostrador. Se guarda su nombre tal cual
 * y por que via, mas el usuario de la casa que lo registro. Son dos personas y
 * las dos importan: una da el permiso y la otra responde de haberlo anotado.
 *
 * SE PUEDE AUTORIZAR VARIAS VECES
 * -------------------------------
 * Cada reautorizacion deja su propio evento. Tres cambios de presupuesto son
 * tres autorizaciones, y el historial las ensena todas.
 */
CREATE OR ALTER PROCEDURE dbo.sp_service_order_authorize
    @id         INT,
    @by_name    NVARCHAR(120),
    @channel    NVARCHAR(20) = 'MOSTRADOR',
    @user_id    INT = NULL,
    @rowver     BINARY(8) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    DECLARE @actual BINARY(8), @status NVARCHAR(20), @version INT,
            @autorizada INT, @sale_id INT;
    SELECT @actual = rowver, @status = status, @version = quote_version,
           @autorizada = authorized_version, @sale_id = sale_id
      FROM dbo.service_orders WHERE id = @id;

    IF @status IS NULL
    BEGIN
        RAISERROR('Esa orden no existe.', 16, 1);
        RETURN;
    END

    IF @rowver IS NOT NULL AND @rowver <> @actual
    BEGIN
        RAISERROR('CONFLICTO_DE_VERSION', 16, 1);
        RETURN;
    END

    IF @status = 'CANCELADA'
    BEGIN
        RAISERROR('Esta orden esta cancelada.', 16, 1);
        RETURN;
    END

    IF @sale_id IS NOT NULL
    BEGIN
        RAISERROR('Esta orden ya se cobro.', 16, 1);
        RETURN;
    END

    IF @by_name IS NULL OR LTRIM(RTRIM(@by_name)) = ''
    BEGIN
        RAISERROR('Anota quien autoriza.', 16, 1);
        RETURN;
    END

    /* Autorizar dos veces la misma version no es un error, pero tampoco es un
       hecho nuevo: se dice y no se escribe otro evento igual. */
    IF @autorizada IS NOT NULL AND @autorizada >= @version
    BEGIN
        RAISERROR('Este presupuesto ya estaba autorizado.', 16, 1);
        RETURN;
    END

    DECLARE @total DECIMAL(14, 2) = ISNULL(
        (SELECT SUM(line_total) FROM dbo.service_order_lines
          WHERE order_id = @id AND status <> 'CANCELADA'), 0);

    BEGIN TRAN;

    UPDATE dbo.service_orders
       SET authorized_version = @version,
           authorized_at = SYSDATETIME(),
           authorized_by_name = @by_name,
           authorized_channel = ISNULL(@channel, 'MOSTRADOR'),
           authorized_by_user = @user_id,
           /* Autorizar pone la orden en marcha, pero no la saca de donde ya
              estaba: si el taller ya empezo, sigue EN_PROCESO. */
           status = CASE WHEN status IN ('BORRADOR', 'ABIERTA') THEN 'ABIERTA' ELSE status END
     WHERE id = @id;

    INSERT INTO dbo.service_order_events
        (order_id, event_type, quote_version, amount, detail, user_id)
    VALUES
        (@id,
         CASE WHEN @autorizada IS NULL THEN 'AUTORIZADA' ELSE 'REAUTORIZADA' END,
         @version, @total,
         @by_name + ' (' + ISNULL(@channel, 'MOSTRADOR') + ')', @user_id);

    COMMIT TRAN;

    EXEC dbo.sp_service_order_get @id = @id;
END
GO

/* ---------- sp_service_order_cancel (SQL_STORED_PROCEDURE) ---------- */
/* sp_service_order_cancel
 * Definicion canonica. Modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* Cancela una orden: el trabajo no se hizo.
 *
 * TIENE SU PROPIO PROCEDIMIENTO PORQUE NO ES UN ESTADO MAS
 * --------------------------------------------------------
 * Los demas estados describen por donde va el trabajo. Cancelar dice que no
 * va a haber trabajo, y eso pide dos cosas que los otros no: un motivo, y que
 * no se pueda hacer sobre algo ya cobrado.
 *
 * EL MOTIVO ES OBLIGATORIO
 * ------------------------
 * Una orden cancelada sin motivo es una pregunta sin respuesta dentro de seis
 * meses: se cancelo porque el cliente se arrepintio, porque no habia refaccion,
 * o porque alguien se equivoco de orden. Son tres cosas distintas y solo una
 * es un problema del negocio.
 *
 * NO SE CANCELA LO YA COBRADO
 * ---------------------------
 * Si hay venta, el dinero ya se movio. Deshacerlo es una devolucion, con su
 * autorizacion presencial y su registro, no un cambio de estado aqui.
 */
CREATE OR ALTER PROCEDURE dbo.sp_service_order_cancel
    @id      INT,
    @reason  NVARCHAR(400),
    @user_id INT = NULL,
    @rowver  BINARY(8) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    DECLARE @actual BINARY(8), @antes NVARCHAR(20), @sale_id INT;
    SELECT @actual = rowver, @antes = status, @sale_id = sale_id
      FROM dbo.service_orders WHERE id = @id;

    IF @antes IS NULL
    BEGIN
        RAISERROR('Esa orden no existe.', 16, 1);
        RETURN;
    END

    IF @rowver IS NOT NULL AND @rowver <> @actual
    BEGIN
        RAISERROR('CONFLICTO_DE_VERSION', 16, 1);
        RETURN;
    END

    IF @antes = 'CANCELADA'
    BEGIN
        RAISERROR('Esta orden ya estaba cancelada.', 16, 1);
        RETURN;
    END

    IF @sale_id IS NOT NULL
    BEGIN
        RAISERROR('Esta orden ya se cobro. Para deshacerlo hay que hacer una devolucion sobre la venta.', 16, 1);
        RETURN;
    END

    IF @reason IS NULL OR LTRIM(RTRIM(@reason)) = ''
    BEGIN
        RAISERROR('Anota por que se cancela.', 16, 1);
        RETURN;
    END

    BEGIN TRAN;

    UPDATE dbo.service_orders
       SET status = 'CANCELADA',
           closed_at = SYSDATETIME(),
           closed_by = @user_id
     WHERE id = @id;

    /* Las lineas pendientes se cancelan con ella: dejarlas en PENDIENTE las
       mantendria contando como trabajo por hacer en la carga de cada persona. */
    UPDATE dbo.service_order_lines
       SET status = 'CANCELADA'
     WHERE order_id = @id AND status IN ('PENDIENTE', 'EN_PROCESO');

    /* Las citas que llevaban a esta orden dejan de tener sentido. */
    UPDATE dbo.appointments
       SET status = 'CANCELADA', updated_at = SYSDATETIME()
     WHERE service_order_id = @id AND status IN ('AGENDADA', 'CONFIRMADA');

    INSERT INTO dbo.service_order_events
        (order_id, event_type, from_status, to_status, detail, user_id)
    VALUES
        (@id, 'CANCELADA', @antes, 'CANCELADA', @reason, @user_id);

    COMMIT TRAN;

    EXEC dbo.sp_service_order_get @id = @id;
END
GO

/* ---------- sp_service_order_charge_preview (SQL_STORED_PROCEDURE) ---------- */
/* sp_service_order_charge_preview
 * Definicion canonica. Modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* Lo que hay que cobrar de una orden, y si se puede cobrar.
 *
 * POR QUE COBRAR NO SE HACE ENTERO AQUI
 * -------------------------------------
 * Porque vender ya existe, y funciona. `sp_register_sale` valida el turno,
 * renueva el arriendo de la caja en MultiCaja, mueve el inventario, resuelve
 * recetas, aplica fidelizacion y deja el movimiento de efectivo. Reimplementar
 * media venta dentro del modulo de Servicios habria creado una segunda forma
 * de vender que se separa de la primera en la siguiente entrega.
 *
 * Asi que el reparto es: este procedimiento dice QUE cobrar y comprueba que se
 * pueda; la venta la registra el camino de siempre; y despues
 * `sp_service_order_link_sale` ata las dos cosas y calcula las comisiones.
 *
 * Tambien evita meter `sp_register_sale` dentro de un INSERT...EXEC: esa
 * construccion es fragil justo donde no puede serlo, porque el procedimiento
 * de venta lleva su propia transaccion.
 *
 * LAS VALIDACIONES SE DEVUELVEN, NO SE LANZAN
 * -------------------------------------------
 * Esto lo llama la pantalla ANTES de cobrar, para pintar el boton. Un error
 * que corta no sirve: lo que hace falta es "puedes, pero ojo con esto".
 */
CREATE OR ALTER PROCEDURE dbo.sp_service_order_charge_preview
    @order_id INT
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @status NVARCHAR(20), @sale_id INT, @version INT, @autorizada INT, @customer_id INT;
    SELECT @status = status, @sale_id = sale_id, @version = quote_version,
           @autorizada = authorized_version, @customer_id = customer_id
      FROM dbo.service_orders WHERE id = @order_id;

    IF @status IS NULL
    BEGIN
        RAISERROR('Esa orden no existe.', 16, 1);
        RETURN;
    END

    DECLARE @lineas INT = (SELECT COUNT(*) FROM dbo.service_order_lines
                            WHERE order_id = @order_id AND status <> 'CANCELADA');
    DECLARE @total DECIMAL(14, 2) = ISNULL(
        (SELECT SUM(line_total) FROM dbo.service_order_lines
          WHERE order_id = @order_id AND status <> 'CANCELADA'), 0);

    /* Lo que IMPIDE cobrar, y lo que solo hay que advertir. La diferencia
       importa: la primera lista apaga el boton y la segunda pide confirmar. */
    DECLARE @impedimento NVARCHAR(300) = NULL;

    IF @sale_id IS NOT NULL
        SET @impedimento = 'Esta orden ya se cobro con la venta ' + CONVERT(NVARCHAR(12), @sale_id) + '.';
    ELSE IF @status = 'CANCELADA'
        SET @impedimento = 'Esta orden esta cancelada.';
    ELSE IF @lineas = 0
        SET @impedimento = 'La orden no tiene nada que cobrar.';

    SELECT @order_id AS order_id,
           @customer_id AS customer_id,
           @status AS status,
           @sale_id AS sale_id,
           @total AS total,
           @lineas AS lines_count,
           @impedimento AS blocked_reason,
           CONVERT(BIT, CASE WHEN @impedimento IS NULL THEN 1 ELSE 0 END) AS can_charge,

           /* Cobrar algo que el cliente no aprobo es la forma mas rapida de
              tener una discusion en el mostrador. No se impide -hay negocios
              donde el cliente esta delante y aprueba de viva voz-, se avisa. */
           CONVERT(BIT, CASE WHEN @autorizada IS NULL OR @version > @autorizada
                             THEN 1 ELSE 0 END) AS needs_reauthorization,

           /* Cobrar con trabajo a medias pasa: el cliente paga y se lleva el
              coche manana. Se avisa igualmente. */
           (SELECT COUNT(*) FROM dbo.service_order_lines
             WHERE order_id = @order_id AND status IN ('PENDIENTE', 'EN_PROCESO')) AS lines_pending;

    /* Las partidas, con la forma que espera la venta: `line_no`, producto,
       cantidad y el precio CONGELADO. El precio de hoy no interviene: se cobra
       lo que se acordo. */
    SELECT ROW_NUMBER() OVER (ORDER BY l.line_no, l.id) AS line_no,
           l.product_id,
           l.quantity,
           l.unit_price_snapshot AS unit_price,
           LEFT(ISNULL(l.notes, ''), 200) AS note,
           l.id AS order_line_id,
           l.line_kind,
           l.name_snapshot,
           l.professional_id,
           l.commission_pct_snapshot
      FROM dbo.service_order_lines l
     WHERE l.order_id = @order_id AND l.status <> 'CANCELADA'
     ORDER BY l.line_no, l.id;
END
GO

/* ---------- sp_service_order_create (SQL_STORED_PROCEDURE) ---------- */
/* sp_service_order_create
 * Definicion canonica. Modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* Abre una orden de servicio: entra el trabajo.
 *
 * LO MINIMO PARA ABRIR ES EL CLIENTE
 * ----------------------------------
 * Ni el activo, ni el diagnostico, ni una sola linea. Cuando el coche entra al
 * taller nadie sabe todavia que hay que hacerle, y una pantalla que exija
 * cotizarlo antes de abrirlo obliga a inventarse la cotizacion o a apuntar el
 * trabajo en un papel. El papel siempre gana esa pelea.
 *
 * NACE EN 'ABIERTA', NO EN 'BORRADOR'
 * -----------------------------------
 * Un borrador es algo que puede no llegar a existir. Esto ya existe: el coche
 * esta dentro. `BORRADOR` se reserva para las que nacen de una cotizacion sin
 * trabajo detras.
 *
 * `quote_version` empieza en 1 y `authorized_version` en NULL: nada
 * autorizado todavia, que es la verdad.
 */
CREATE OR ALTER PROCEDURE dbo.sp_service_order_create
    @customer_id       INT,
    @customer_asset_id INT = NULL,
    @reported_issue    NVARCHAR(1000) = NULL,
    @promised_at       DATETIME2(0) = NULL,
    @notes             NVARCHAR(1000) = NULL,
    @user_id           INT = NULL,
    @register_id       INT = NULL,
    @status            NVARCHAR(20) = 'ABIERTA'
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    IF NOT EXISTS (SELECT 1 FROM dbo.customers WHERE id = @customer_id)
    BEGIN
        RAISERROR('El cliente no existe.', 16, 1);
        RETURN;
    END

    /* Un activo de OTRO cliente en esta orden es casi siempre un clic mal
       dado, y el historial que deja es peor que el error: el coche de alguien
       aparece en el expediente de otro. */
    IF @customer_asset_id IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM dbo.customer_assets
                        WHERE id = @customer_asset_id AND customer_id = @customer_id)
    BEGIN
        RAISERROR('Ese activo no es de este cliente.', 16, 1);
        RETURN;
    END

    IF @status NOT IN ('BORRADOR', 'ABIERTA')
    BEGIN
        RAISERROR('Una orden nueva solo puede nacer como BORRADOR o ABIERTA.', 16, 1);
        RETURN;
    END

    BEGIN TRAN;

    INSERT INTO dbo.service_orders
        (customer_id, customer_asset_id, status, reported_issue,
         promised_at, notes, opened_by, register_id)
    VALUES
        (@customer_id, @customer_asset_id, @status, @reported_issue,
         @promised_at, @notes, @user_id, @register_id);

    DECLARE @id INT = SCOPE_IDENTITY();

    INSERT INTO dbo.service_order_events
        (order_id, event_type, to_status, quote_version, detail, user_id)
    VALUES
        (@id, 'ABIERTA', @status, 1, @reported_issue, @user_id);

    COMMIT TRAN;

    EXEC dbo.sp_service_order_get @id = @id;
END
GO

/* ---------- sp_service_order_get (SQL_STORED_PROCEDURE) ---------- */
/* sp_service_order_get
 * Definicion canonica. Modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* Una orden entera: cabecera, lineas e historial.
 *
 * TRES CONJUNTOS, UNA SOLA IDA
 * ----------------------------
 * La pantalla de detalle necesita las tres cosas a la vez. Tres llamadas
 * separadas darian tres fotos de tres instantes, y con dos personas editando
 * la misma orden eso significa ver lineas que ya no estan junto a un total que
 * ya las descontó.
 *
 * EL ESTADO ECONOMICO SE CALCULA AQUI, NO SE GUARDA
 * -------------------------------------------------
 * `economic_status` sale de la venta enlazada y de su saldo:
 *
 *   SIN_COBRAR   no hay venta todavia
 *   PAGADA       hay venta y no debe nada
 *   POR_COBRAR   hay venta a credito con saldo
 *
 * Si esto viviera en una columna, un abono registrado en otra caja la dejaria
 * mintiendo hasta que alguien la refrescara, y el mostrador le cobraria dos
 * veces al cliente. El dinero esta en `sales`; aqui solo se mira.
 *
 * REAUTORIZACION
 * --------------
 * `needs_reauthorization` es 1 cuando el presupuesto cambio despues de que el
 * cliente autorizara: `quote_version > authorized_version`. No es un estado
 * guardado, es una comparacion, y por eso no puede quedarse desfasada.
 */
CREATE OR ALTER PROCEDURE dbo.sp_service_order_get
    @id INT
AS
BEGIN
    SET NOCOUNT ON;

    IF NOT EXISTS (SELECT 1 FROM dbo.service_orders WHERE id = @id)
    BEGIN
        RAISERROR('Esa orden no existe.', 16, 1);
        RETURN;
    END

    -- ------------------------------------------------------------ cabecera
    SELECT o.id, o.folio, o.status,
           o.customer_id, c.customerName AS customer_name,
           c.phone AS customer_phone, c.mobile AS customer_mobile,
           o.customer_asset_id,
           a.label AS asset_label, a.kind AS asset_kind,
           a.identifier AS asset_identifier, a.brand AS asset_brand,
           a.model AS asset_model, a.year_or_age AS asset_year_or_age,
           a.color AS asset_color,
           o.reported_issue, o.diagnosis, o.notes,
           o.quote_version, o.authorized_version, o.authorized_at,
           o.authorized_by_name, o.authorized_channel, o.authorized_by_user,
           CONVERT(BIT, CASE WHEN o.authorized_version IS NULL
                              OR o.quote_version > o.authorized_version
                             THEN 1 ELSE 0 END) AS needs_reauthorization,
           o.promised_at, o.opened_at, o.opened_by, uo.usuario AS opened_by_name,
           o.closed_at, o.closed_by, uc.usuario AS closed_by_name,
           o.sale_id, o.register_id,

           /* EL TESTIGO VIAJA COMO TEXTO, y no como los ocho bytes crudos.
              Un ROWVERSION es un `binary(8)`; al cruzar el puente de contextos
              de Electron deja de ser un Buffer y llega como una lista de
              numeros. El proceso principal no sabia reconstruirlo, lo mandaba
              NULL, y la comprobacion de concurrencia no se hacia NUNCA: los dos
              guardaban y el ultimo ganaba, que es justo lo que el testigo
              existe para impedir. En hexadecimal cruza intacto y ademas se lee
              en un registro.

              Y la conversion es DOBLE a proposito: `rowversion` no es
              `binary(8)` para CONVERT, y con un solo paso el estilo 1 se
              ignora en silencio -devuelve los ocho bytes como caracteres, no
              el hexadecimal-. Eso fue justo lo que dejo el testigo inservible
              la primera vez. */
           CONVERT(VARCHAR(18), CONVERT(BINARY(8), o.rowver), 1) AS rowver,

           /* El importe vivo: las lineas canceladas no cuentan. */
           ISNULL((SELECT SUM(l.line_total)
                     FROM dbo.service_order_lines l
                    WHERE l.order_id = o.id AND l.status <> 'CANCELADA'), 0) AS total,
           ISNULL((SELECT SUM(l.line_total)
                     FROM dbo.service_order_lines l
                    WHERE l.order_id = o.id AND l.status <> 'CANCELADA'
                      AND l.line_kind = 'SERVICIO'), 0) AS total_servicios,
           ISNULL((SELECT SUM(l.line_total)
                     FROM dbo.service_order_lines l
                    WHERE l.order_id = o.id AND l.status <> 'CANCELADA'
                      AND l.line_kind = 'PRODUCTO'), 0) AS total_productos,

           CASE WHEN o.sale_id IS NULL THEN 'SIN_COBRAR'
                WHEN ISNULL(s.balance, 0) > 0 THEN 'POR_COBRAR'
                ELSE 'PAGADA' END AS economic_status,
           s.total AS sale_total,
           s.balance AS sale_balance,
           s.payment_method AS sale_payment_method,
           s.datee AS sale_date
      FROM dbo.service_orders o
      JOIN dbo.customers c ON c.id = o.customer_id
      LEFT JOIN dbo.customer_assets a ON a.id = o.customer_asset_id
      LEFT JOIN dbo.sales s ON s.id = o.sale_id
      LEFT JOIN dbo.users uo ON uo.id = o.opened_by
      LEFT JOIN dbo.users uc ON uc.id = o.closed_by
     WHERE o.id = @id;

    -- -------------------------------------------------------------- lineas
    SELECT l.id, l.order_id, l.line_no, l.line_kind, l.product_id,
           l.name_snapshot, l.unit_price_snapshot, l.unit_cost_snapshot,
           l.tasa_iva_snapshot, l.quantity, l.line_total,
           l.professional_id, pr.full_name AS professional_name, pr.color AS professional_color,
           l.commission_pct_snapshot,
           l.status, l.notes, l.added_at, l.added_by,
           /* El precio de HOY, solo para que la pantalla pueda avisar de que
              cambio. Lo que se cobra sigue siendo la copia. */
           p.price AS current_price,
           p.nombre AS current_name
      FROM dbo.service_order_lines l
      JOIN dbo.products p ON p.id = l.product_id
      LEFT JOIN dbo.professionals pr ON pr.id = l.professional_id
     WHERE l.order_id = @id
     ORDER BY l.line_no, l.id;

    -- ----------------------------------------------------------- historial
    SELECT e.id, e.order_id, e.happened_at, e.event_type,
           e.from_status, e.to_status, e.quote_version, e.amount, e.detail,
           e.user_id, u.usuario AS user_name
      FROM dbo.service_order_events e
      LEFT JOIN dbo.users u ON u.id = e.user_id
     WHERE e.order_id = @id
     ORDER BY e.happened_at DESC, e.id DESC;
END
GO

/* ---------- sp_service_order_link_sale (SQL_STORED_PROCEDURE) ---------- */
/* sp_service_order_link_sale
 * Definicion canonica. Modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* Ata una orden a la venta que la cobro, y devenga las comisiones.
 *
 * ES EL SEGUNDO PASO DEL COBRO
 * ----------------------------
 * El primero es la venta de siempre. Este ata las dos cosas y hace lo unico
 * que el camino de venta no sabe hacer: repartir comisiones por linea.
 *
 * ES IDEMPOTENTE, Y ESO NO ES UN ADORNO
 * -------------------------------------
 * Entre la venta y este enlace puede caerse la red. Si se reintenta con la
 * misma venta, no pasa nada: la orden ya esta atada a ella y las comisiones ya
 * estan. Si se reintenta con OTRA venta, se rechaza: eso significaria que la
 * orden se cobro dos veces, y lo que hay que hacer entonces es devolver una de
 * las dos, no elegir cual gana.
 *
 * LA COMISION SE CONGELA AQUI Y NO SE VUELVE A CALCULAR
 * -----------------------------------------------------
 * Se guarda el importe, la base y el porcentaje con el que salio. Derivarla al
 * vuelo de las lineas significaria que cambiarle el porcentaje a alguien
 * reescribiria lo que ya gano el mes pasado, y eso es dinero que una persona
 * ya contaba.
 *
 * El indice unico sobre `order_line_id` es el que de verdad impide pagar dos
 * veces la misma linea: aqui se comprueba, pero la comprobacion tiene una
 * ventana y el indice no.
 */
CREATE OR ALTER PROCEDURE dbo.sp_service_order_link_sale
    @order_id INT,
    @sale_id  INT,
    @user_id  INT = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    DECLARE @status NVARCHAR(20), @ya INT, @customer_id INT;
    SELECT @status = status, @ya = sale_id, @customer_id = customer_id
      FROM dbo.service_orders WHERE id = @order_id;

    IF @status IS NULL
    BEGIN
        RAISERROR('Esa orden no existe.', 16, 1);
        RETURN;
    END

    IF NOT EXISTS (SELECT 1 FROM dbo.sales WHERE id = @sale_id)
    BEGIN
        RAISERROR('Esa venta no existe.', 16, 1);
        RETURN;
    END

    IF @ya IS NOT NULL AND @ya <> @sale_id
    BEGIN
        DECLARE @msg NVARCHAR(200) =
            'Esta orden ya estaba cobrada con la venta ' + CONVERT(NVARCHAR(12), @ya) + '.';
        RAISERROR(@msg, 16, 1);
        RETURN;
    END

    /* Una venta cobra UNA orden. Si esta venta ya cobro otra, atarla aqui
       repartiria el mismo dinero entre dos trabajos. */
    IF EXISTS (SELECT 1 FROM dbo.service_orders
                WHERE sale_id = @sale_id AND id <> @order_id)
    BEGIN
        RAISERROR('Esa venta ya cobro otra orden.', 16, 1);
        RETURN;
    END

    BEGIN TRAN;

    UPDATE dbo.service_orders
       SET sale_id = @sale_id,
           /* Cobrada es, como minimo, terminada. Entregarla es otro momento y
              otra decision: el cliente paga hoy y recoge manana. */
           status = CASE WHEN status IN ('BORRADOR', 'ABIERTA', 'EN_PROCESO')
                         THEN 'TERMINADA' ELSE status END
     WHERE id = @order_id;

    /* Las comisiones de las lineas que tienen a alguien detras y porcentaje.
       Las que no, no generan nada: no es un error, es que ese trabajo no
       comisiona. `NOT EXISTS` deja la operacion repetible. */
    INSERT INTO dbo.service_commissions
        (order_id, order_line_id, sale_id, professional_id, base_amount, pct, amount)
    SELECT l.order_id, l.id, @sale_id, l.professional_id,
           l.line_total,
           l.commission_pct_snapshot,
           CONVERT(DECIMAL(14, 2), l.line_total * l.commission_pct_snapshot / 100.0)
      FROM dbo.service_order_lines l
     WHERE l.order_id = @order_id
       AND l.status <> 'CANCELADA'
       AND l.professional_id IS NOT NULL
       AND ISNULL(l.commission_pct_snapshot, 0) > 0
       AND NOT EXISTS (SELECT 1 FROM dbo.service_commissions c WHERE c.order_line_id = l.id);

    DECLARE @comisiones DECIMAL(14, 2) = ISNULL(
        (SELECT SUM(amount) FROM dbo.service_commissions WHERE order_id = @order_id), 0);
    DECLARE @total DECIMAL(14, 2) = ISNULL(
        (SELECT total FROM dbo.sales WHERE id = @sale_id), 0);

    /* Solo la primera vez deja evento: reintentar un enlace no es un hecho
       nuevo del negocio, y el historial no puede contarlo como si lo fuera. */
    IF @ya IS NULL
        INSERT INTO dbo.service_order_events
            (order_id, event_type, from_status, to_status, amount, detail, user_id)
        VALUES
            (@order_id, 'COBRADA', @status,
             (SELECT status FROM dbo.service_orders WHERE id = @order_id),
             @total,
             'Venta ' + CONVERT(NVARCHAR(12), @sale_id)
               + CASE WHEN @comisiones > 0
                      THEN ' · comisiones ' + CONVERT(NVARCHAR(20), @comisiones)
                      ELSE '' END,
             @user_id);

    COMMIT TRAN;

    EXEC dbo.sp_service_order_get @id = @order_id;
END
GO

/* ---------- sp_service_order_list (SQL_STORED_PROCEDURE) ---------- */
/* sp_service_order_list
 * Definicion canonica. Modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* El tablero de ordenes: lo que hay y como va.
 *
 * `@estados` es una lista separada por comas -'ABIERTA,EN_PROCESO'- y no un
 * solo valor, porque la pregunta real del mostrador es "que tengo dentro", y
 * eso son varios estados a la vez. Un parametro por estado habria sido cinco
 * parametros booleanos que nadie recuerda en que orden van.
 *
 * Trae los totales y el estado economico calculados por fila. Pedirselos
 * despues, uno a uno, convertiria una lista de treinta ordenes en treinta
 * consultas.
 */
CREATE OR ALTER PROCEDURE dbo.sp_service_order_list
    @estados         NVARCHAR(200) = NULL,
    @customer_id     INT = NULL,
    @professional_id INT = NULL,
    @desde           DATE = NULL,
    @hasta           DATE = NULL,
    @busqueda        NVARCHAR(100) = NULL,
    @top             INT = 200
AS
BEGIN
    SET NOCOUNT ON;

    SET @busqueda = NULLIF(LTRIM(RTRIM(@busqueda)), '');
    SET @top = CASE WHEN @top IS NULL OR @top <= 0 THEN 200 ELSE @top END;

    DECLARE @filtro TABLE (estado NVARCHAR(20) PRIMARY KEY);
    IF @estados IS NOT NULL AND LTRIM(RTRIM(@estados)) <> ''
        INSERT INTO @filtro (estado)
        SELECT DISTINCT LTRIM(RTRIM(value)) FROM STRING_SPLIT(@estados, ',')
         WHERE LTRIM(RTRIM(value)) <> '';

    SELECT TOP (@top)
           o.id, o.folio, o.status,
           o.customer_id, c.customerName AS customer_name,
           o.customer_asset_id, a.label AS asset_label, a.identifier AS asset_identifier,
           o.opened_at, o.promised_at, o.closed_at,
           o.quote_version, o.authorized_version,
           CONVERT(BIT, CASE WHEN o.authorized_version IS NULL
                              OR o.quote_version > o.authorized_version
                             THEN 1 ELSE 0 END) AS needs_reauthorization,
           o.sale_id,
           ISNULL(t.total, 0) AS total,
           CASE WHEN o.sale_id IS NULL THEN 'SIN_COBRAR'
                WHEN ISNULL(s.balance, 0) > 0 THEN 'POR_COBRAR'
                ELSE 'PAGADA' END AS economic_status,
           ISNULL(t.lineas, 0) AS lines_count,
           ISNULL(t.hechas, 0) AS lines_done,
           /* En hexadecimal: los ocho bytes crudos no cruzan intactos el puente
              de contextos de Electron. Ver `sp_service_order_get`. */
           CONVERT(VARCHAR(18), CONVERT(BINARY(8), o.rowver), 1) AS rowver
      FROM dbo.service_orders o
      JOIN dbo.customers c ON c.id = o.customer_id
      LEFT JOIN dbo.customer_assets a ON a.id = o.customer_asset_id
      LEFT JOIN dbo.sales s ON s.id = o.sale_id
      OUTER APPLY (
            SELECT SUM(l.line_total) AS total,
                   COUNT(*) AS lineas,
                   SUM(CASE WHEN l.status = 'HECHA' THEN 1 ELSE 0 END) AS hechas
              FROM dbo.service_order_lines l
             WHERE l.order_id = o.id AND l.status <> 'CANCELADA') t
     WHERE (NOT EXISTS (SELECT 1 FROM @filtro) OR o.status IN (SELECT estado FROM @filtro))
       AND (@customer_id IS NULL OR o.customer_id = @customer_id)
       AND (@desde IS NULL OR o.opened_at >= @desde)
       AND (@hasta IS NULL OR o.opened_at < DATEADD(DAY, 1, @hasta))
       AND (@professional_id IS NULL
            OR EXISTS (SELECT 1 FROM dbo.service_order_lines l
                        WHERE l.order_id = o.id AND l.professional_id = @professional_id))
       AND (@busqueda IS NULL
            OR o.folio LIKE '%' + @busqueda + '%'
            OR c.customerName LIKE '%' + @busqueda + '%'
            OR a.label LIKE '%' + @busqueda + '%'
            OR a.identifier LIKE '%' + @busqueda + '%')
     ORDER BY o.opened_at DESC, o.id DESC;
END
GO

/* ---------- sp_service_order_set_status (SQL_STORED_PROCEDURE) ---------- */
/* sp_service_order_set_status
 * Definicion canonica. Modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* Mueve la orden por sus estados operativos.
 *
 * LOS CINCO ESTADOS, Y POR QUE SON CINCO
 * --------------------------------------
 *   BORRADOR    una cotizacion sin trabajo detras. Puede no llegar a existir.
 *   ABIERTA     el trabajo entro. El coche esta dentro.
 *   EN_PROCESO  alguien esta trabajando en el.
 *   TERMINADA   el trabajo esta hecho y falta cobrar y entregar.
 *   ENTREGADA   se fue. Se cierra.
 *   CANCELADA   no se hizo. Tiene su propio procedimiento.
 *
 * No hay un estado "pagada" ni "autorizada": el dinero se deduce de la venta
 * enlazada y la autorizacion de las versiones. Un estado que diga lo mismo que
 * ya dicen otros dos datos acaba contradiciendolos.
 *
 * LAS TRANSICIONES SE VALIDAN AQUI
 * --------------------------------
 * Y no en la pantalla. Una pantalla que esconde el boton es cortesia; lo que
 * impide que una orden pase de ENTREGADA a EN_PROCESO por una llamada suelta
 * es esto.
 *
 * TERMINAR EXIGE QUE HAYA ALGO HECHO
 * ----------------------------------
 * Una orden sin una sola linea hecha no esta terminada: esta vacia. Marcarla
 * como terminada solo la sacaria de la lista de trabajo pendiente sin que
 * nadie hubiera trabajado.
 */
CREATE OR ALTER PROCEDURE dbo.sp_service_order_set_status
    @id      INT,
    @status  NVARCHAR(20),
    @user_id INT = NULL,
    @rowver  BINARY(8) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    DECLARE @actual BINARY(8), @antes NVARCHAR(20), @sale_id INT;
    SELECT @actual = rowver, @antes = status, @sale_id = sale_id
      FROM dbo.service_orders WHERE id = @id;

    IF @antes IS NULL
    BEGIN
        RAISERROR('Esa orden no existe.', 16, 1);
        RETURN;
    END

    IF @rowver IS NOT NULL AND @rowver <> @actual
    BEGIN
        RAISERROR('CONFLICTO_DE_VERSION', 16, 1);
        RETURN;
    END

    IF @status NOT IN ('BORRADOR', 'ABIERTA', 'EN_PROCESO', 'TERMINADA', 'ENTREGADA')
    BEGIN
        RAISERROR('Estado desconocido. Para cancelar hay un procedimiento aparte.', 16, 1);
        RETURN;
    END

    IF @antes = 'CANCELADA'
    BEGIN
        RAISERROR('Esta orden esta cancelada.', 16, 1);
        RETURN;
    END

    IF @antes = 'ENTREGADA'
    BEGIN
        RAISERROR('Esta orden ya se entrego.', 16, 1);
        RETURN;
    END

    /* Una orden vuelve atras mientras no se haya entregado: el taller descubre
       algo mas y hay que seguir. Lo que no hace es retroceder a BORRADOR, que
       es un estado anterior a que el trabajo existiera. */
    IF @status = 'BORRADOR' AND @antes <> 'BORRADOR'
    BEGIN
        RAISERROR('Una orden con trabajo no vuelve a ser un borrador.', 16, 1);
        RETURN;
    END

    IF @status = 'TERMINADA'
       AND NOT EXISTS (SELECT 1 FROM dbo.service_order_lines
                        WHERE order_id = @id AND status = 'HECHA')
    BEGIN
        RAISERROR('No hay ninguna linea marcada como hecha.', 16, 1);
        RETURN;
    END

    /* Entregar sin cobrar deja el trabajo fuera y el dinero dentro. Si el
       negocio quiere fiar, se cobra a credito: eso SI es una venta, con su
       saldo y su vencimiento. Lo que no puede es no existir. */
    IF @status = 'ENTREGADA' AND @sale_id IS NULL
    BEGIN
        RAISERROR('Cobra la orden antes de entregarla. Si es a credito, registra la venta a credito.', 16, 1);
        RETURN;
    END

    IF @antes = @status
    BEGIN
        EXEC dbo.sp_service_order_get @id = @id;
        RETURN;
    END

    BEGIN TRAN;

    UPDATE dbo.service_orders
       SET status = @status,
           closed_at = CASE WHEN @status = 'ENTREGADA' THEN SYSDATETIME() ELSE closed_at END,
           closed_by = CASE WHEN @status = 'ENTREGADA' THEN @user_id ELSE closed_by END
     WHERE id = @id;

    INSERT INTO dbo.service_order_events
        (order_id, event_type, from_status, to_status, user_id)
    VALUES
        (@id, 'ESTADO', @antes, @status, @user_id);

    COMMIT TRAN;

    EXEC dbo.sp_service_order_get @id = @id;
END
GO

/* ---------- sp_service_order_update (SQL_STORED_PROCEDURE) ---------- */
/* sp_service_order_update
 * Definicion canonica. Modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* Cambia la cabecera: diagnostico, activo, fecha prometida, notas.
 *
 * DOS PERSONAS EN LA MISMA ORDEN ES LO NORMAL
 * -------------------------------------------
 * El mostrador anota lo que dijo el cliente mientras el taller escribe el
 * diagnostico. Sin testigo de version, la ultima en guardar se lleva por
 * delante lo que escribio la otra y ninguna de las dos se entera: el
 * diagnostico simplemente desaparece.
 *
 * `@rowver` es el testigo. Se manda el que se leyo al abrir la pantalla; si la
 * fila cambio desde entonces, esto no guarda nada y devuelve el estado actual
 * para que la pantalla pueda decir "esto cambio mientras lo editabas".
 *
 * Es OPCIONAL a proposito: hay llamadas internas -cerrar, cobrar- que ya
 * saben que estan trabajando sobre la version buena. Lo que no puede pasar es
 * que la pantalla no lo mande, y de eso se encarga una prueba.
 *
 * CAMBIAR LA CABECERA NO INVALIDA LA AUTORIZACION
 * -----------------------------------------------
 * Escribir el diagnostico no cambia lo que el cliente va a pagar. Lo que sube
 * el presupuesto son las lineas, y eso vive en los procedimientos de linea.
 */
CREATE OR ALTER PROCEDURE dbo.sp_service_order_update
    @id                INT,
    @customer_asset_id INT = NULL,
    @reported_issue    NVARCHAR(1000) = NULL,
    @diagnosis         NVARCHAR(1000) = NULL,
    @promised_at       DATETIME2(0) = NULL,
    @notes             NVARCHAR(1000) = NULL,
    @rowver            BINARY(8) = NULL,
    @user_id           INT = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    DECLARE @actual BINARY(8), @customer_id INT, @status NVARCHAR(20), @sale_id INT;
    SELECT @actual = rowver, @customer_id = customer_id, @status = status, @sale_id = sale_id
      FROM dbo.service_orders WHERE id = @id;

    IF @customer_id IS NULL
    BEGIN
        RAISERROR('Esa orden no existe.', 16, 1);
        RETURN;
    END

    IF @rowver IS NOT NULL AND @rowver <> @actual
    BEGIN
        /* 50409 es el numero que el proceso principal traduce a "alguien mas
           la cambio". Un mensaje distinto por cada sitio acabaria en un
           "Error" generico en pantalla. */
        RAISERROR('CONFLICTO_DE_VERSION', 16, 1);
        RETURN;
    END

    IF @status = 'CANCELADA'
    BEGIN
        RAISERROR('Esta orden esta cancelada.', 16, 1);
        RETURN;
    END

    IF @customer_asset_id IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM dbo.customer_assets
                        WHERE id = @customer_asset_id AND customer_id = @customer_id)
    BEGIN
        RAISERROR('Ese activo no es de este cliente.', 16, 1);
        RETURN;
    END

    BEGIN TRAN;

    DECLARE @diag_antes NVARCHAR(1000) = (SELECT diagnosis FROM dbo.service_orders WHERE id = @id);

    UPDATE dbo.service_orders
       SET customer_asset_id = ISNULL(@customer_asset_id, customer_asset_id),
           reported_issue = ISNULL(@reported_issue, reported_issue),
           diagnosis = ISNULL(@diagnosis, diagnosis),
           promised_at = ISNULL(@promised_at, promised_at),
           notes = ISNULL(@notes, notes)
     WHERE id = @id;

    /* El diagnostico deja huella propia: es el momento en que se pasa de "lo
       que conto el cliente" a "lo que encontramos", y es lo primero que se
       busca cuando alguien pregunta por que se cotizo lo que se cotizo. */
    IF @diagnosis IS NOT NULL AND ISNULL(@diag_antes, '') <> @diagnosis
        INSERT INTO dbo.service_order_events (order_id, event_type, detail, user_id)
        VALUES (@id, 'DIAGNOSTICO', LEFT(@diagnosis, 400), @user_id);

    COMMIT TRAN;

    EXEC dbo.sp_service_order_get @id = @id;
END
GO

/* ---------- sp_service_order_update_line (SQL_STORED_PROCEDURE) ---------- */
/* sp_service_order_update_line
 * Definicion canonica. Modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* Cambia una linea: cantidad, precio, quien la hace, en que va, o la cancela.
 *
 * CANCELAR NO ES BORRAR
 * ---------------------
 * Una linea cancelada se queda en la orden con `status = 'CANCELADA'` y deja
 * de sumar. Borrarla escondería que se cotizo y se quito, que es justo la
 * conversacion que acaba habiendo en el mostrador: "yo nunca pedi eso".
 *
 * SOLO SUBE EL PRESUPUESTO SI CAMBIA EL DINERO
 * --------------------------------------------
 * Poner la linea en EN_PROCESO o asignarle a otra persona no cambia lo que el
 * cliente va a pagar, asi que no invalida su autorizacion. Cambiar la cantidad
 * o el precio, si. Subir la version por todo convertiria la reautorizacion en
 * un aviso que aparece siempre, y un aviso que aparece siempre no se lee.
 *
 * Los parametros en NULL no se tocan: esta pantalla se usa para cambiar UNA
 * cosa a la vez, y mandar el resto obligaria al renderer a reenviar un estado
 * que puede haber cambiado por debajo.
 */
CREATE OR ALTER PROCEDURE dbo.sp_service_order_update_line
    @line_id         INT,
    @quantity        DECIMAL(12, 2) = NULL,
    @unit_price      DECIMAL(12, 2) = NULL,
    @professional_id INT = NULL,
    @commission_pct  DECIMAL(5, 2) = NULL,
    @status          NVARCHAR(12) = NULL,
    @notes           NVARCHAR(400) = NULL,
    @user_id         INT = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    DECLARE @order_id INT, @kind NVARCHAR(10), @product_id INT,
            @nombre NVARCHAR(120), @estado_actual NVARCHAR(12),
            @cant_actual DECIMAL(12, 2), @precio_actual DECIMAL(12, 2);

    SELECT @order_id = l.order_id, @kind = l.line_kind, @product_id = l.product_id,
           @nombre = l.name_snapshot, @estado_actual = l.status,
           @cant_actual = l.quantity, @precio_actual = l.unit_price_snapshot
      FROM dbo.service_order_lines l WHERE l.id = @line_id;

    IF @order_id IS NULL
    BEGIN
        RAISERROR('Esa linea ya no existe.', 16, 1);
        RETURN;
    END

    DECLARE @orden_status NVARCHAR(20), @sale_id INT;
    SELECT @orden_status = status, @sale_id = sale_id FROM dbo.service_orders WHERE id = @order_id;

    IF @sale_id IS NOT NULL
    BEGIN
        RAISERROR('Esta orden ya se cobro y sus lineas no se pueden cambiar.', 16, 1);
        RETURN;
    END

    IF @orden_status = 'CANCELADA'
    BEGIN
        RAISERROR('Esta orden esta cancelada.', 16, 1);
        RETURN;
    END

    IF @quantity IS NOT NULL AND @quantity <= 0
    BEGIN
        RAISERROR('La cantidad tiene que ser mayor que cero.', 16, 1);
        RETURN;
    END

    IF @unit_price IS NOT NULL AND @unit_price < 0
    BEGIN
        RAISERROR('El precio no puede ser negativo.', 16, 1);
        RETURN;
    END

    IF @status IS NOT NULL AND @status NOT IN ('PENDIENTE', 'EN_PROCESO', 'HECHA', 'CANCELADA')
    BEGIN
        RAISERROR('Estado de linea desconocido.', 16, 1);
        RETURN;
    END

    IF @professional_id IS NOT NULL
    BEGIN
        IF NOT EXISTS (SELECT 1 FROM dbo.professionals WHERE id = @professional_id AND active = 1)
        BEGIN
            RAISERROR('Ese profesional no existe o esta dado de baja.', 16, 1);
            RETURN;
        END
        IF @kind = 'SERVICIO'
           AND EXISTS (SELECT 1 FROM dbo.service_professionals WHERE service_product_id = @product_id)
           AND NOT EXISTS (SELECT 1 FROM dbo.service_professionals
                            WHERE service_product_id = @product_id
                              AND professional_id = @professional_id)
        BEGIN
            RAISERROR('Esa persona no tiene asignado este servicio.', 16, 1);
            RETURN;
        END
    END

    /* Lo que de verdad mueve el dinero. Cancelar tambien: la linea deja de
       sumar y el total baja. */
    DECLARE @cambia_importe BIT =
        CASE WHEN (@quantity IS NOT NULL AND @quantity <> @cant_actual)
                OR (@unit_price IS NOT NULL AND @unit_price <> @precio_actual)
                OR (@status = 'CANCELADA' AND @estado_actual <> 'CANCELADA')
                OR (@estado_actual = 'CANCELADA' AND @status IS NOT NULL AND @status <> 'CANCELADA')
             THEN 1 ELSE 0 END;

    BEGIN TRAN;

    UPDATE dbo.service_order_lines
       SET quantity = ISNULL(@quantity, quantity),
           unit_price_snapshot = ISNULL(@unit_price, unit_price_snapshot),
           professional_id = ISNULL(@professional_id, professional_id),
           commission_pct_snapshot = ISNULL(@commission_pct, commission_pct_snapshot),
           status = ISNULL(@status, status),
           notes = ISNULL(@notes, notes)
     WHERE id = @line_id;

    IF @cambia_importe = 1
        UPDATE dbo.service_orders SET quote_version = quote_version + 1 WHERE id = @order_id;

    DECLARE @version INT = (SELECT quote_version FROM dbo.service_orders WHERE id = @order_id);

    INSERT INTO dbo.service_order_events
        (order_id, event_type, quote_version, amount, detail, user_id)
    SELECT @order_id,
           CASE WHEN @status = 'CANCELADA' AND @estado_actual <> 'CANCELADA' THEN 'LINEA_QUITADA'
                WHEN @status = 'HECHA' AND @estado_actual <> 'HECHA' THEN 'LINEA_HECHA'
                WHEN @cambia_importe = 1 THEN 'LINEA_CAMBIADA'
                ELSE 'LINEA_NOTA' END,
           @version,
           CASE WHEN @cambia_importe = 1 THEN l.line_total END,
           @nombre + CASE WHEN @status IS NOT NULL THEN ' -> ' + @status ELSE '' END,
           @user_id
      FROM dbo.service_order_lines l WHERE l.id = @line_id;

    COMMIT TRAN;

    EXEC dbo.sp_service_order_get @id = @order_id;
END
GO

/* ---------- sp_service_save (SQL_STORED_PROCEDURE) ---------- */
/* sp_service_save
 * Definicion canonica. Modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* Da de alta un servicio, o convierte en servicio un producto que ya existe.
 *
 * UN SERVICIO ES UN PRODUCTO
 * --------------------------
 * No hay un catalogo paralelo. Este procedimiento escribe en `products` lo
 * que todo lo vendible tiene -nombre, precio, impuestos, clave del SAT- y en
 * `services` lo que solo un servicio tiene: cuanto dura, si necesita a alguien
 * que lo haga y cuanto comisiona.
 *
 * ENLAZAR UN PRODUCTO QUE YA ESTABA
 * ---------------------------------
 * Con `@product_id`, el producto no se recrea: se le anade la ficha de
 * servicio. Es el caso del taller que llevaba anos cobrando "Mano de obra"
 * como un producto mas y ahora quiere agendarlo y comisionarlo. Su historial
 * de ventas sigue siendo el suyo, que es justamente lo que se gana al no
 * inventar una tabla nueva.
 *
 * `inventory_mode = 'NONE'` NO SE NEGOCIA
 * ---------------------------------------
 * Un servicio no tiene existencias. Si el producto enlazado descontaba
 * inventario, deja de hacerlo: cobrar una hora de trabajo no puede restar
 * piezas de un almacen.
 */
CREATE OR ALTER PROCEDURE dbo.sp_service_save
    @product_id             INT = NULL,
    @nombre                 NVARCHAR(100),
    @price                  DECIMAL(10, 2),
    @part_number            NVARCHAR(100) = NULL,
    @category_id            INT = NULL,
    @clave_prod_serv        NVARCHAR(8) = NULL,
    @clave_unidad           NVARCHAR(5) = NULL,
    @tasa_iva               DECIMAL(5, 4) = NULL,
    @duration_minutes       INT = 30,
    @requires_professional  BIT = 1,
    @default_commission_pct DECIMAL(5, 2) = NULL,
    @schedulable            BIT = 1,
    @notes                  NVARCHAR(400) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    IF @nombre IS NULL OR LTRIM(RTRIM(@nombre)) = ''
    BEGIN
        RAISERROR('El servicio necesita un nombre.', 16, 1);
        RETURN;
    END

    IF @price IS NULL OR @price < 0
    BEGIN
        RAISERROR('El precio no puede ser negativo.', 16, 1);
        RETURN;
    END

    BEGIN TRAN;

    /* ------------------------------------------- CATEGORIA Y MARCA, SIEMPRE
     *
     * `sp_get_active_products` -el catalogo de la pantalla de venta- une
     * products con CAT_categories y CAT_brands con INNER JOIN. Un servicio sin
     * categoria o sin marca queda FUERA de esa consulta: existe en la base, se
     * ve en el catalogo de Servicios y no se puede vender. Un servicio que no
     * se puede cobrar no sirve de nada, y el fallo es silencioso.
     *
     * Asi que se le dan las dos. 'Servicios' como categoria es ademas lo que
     * el negocio querria: los agrupa en la pantalla de venta sin que nadie
     * tenga que crearla a mano el primer dia.
     */
    DECLARE @cat_servicios INT, @marca_general INT;

    IF NOT EXISTS (SELECT 1 FROM dbo.CAT_categories WHERE namee = N'Servicios')
        INSERT INTO dbo.CAT_categories (namee) VALUES (N'Servicios');
    SELECT @cat_servicios = id FROM dbo.CAT_categories WHERE namee = N'Servicios';

    IF NOT EXISTS (SELECT 1 FROM dbo.CAT_brands WHERE namee = N'General')
        INSERT INTO dbo.CAT_brands (namee) VALUES (N'General');
    SELECT @marca_general = id FROM dbo.CAT_brands WHERE namee = N'General';

    IF @product_id IS NULL
    BEGIN
        /* Sin clave, se genera una estable y legible. Un servicio rara vez
           tiene codigo de barras, y exigirselo al alta seria pedir un dato que
           el negocio no tiene.

           Se inserta con un valor provisional y se renombra con el identificador
           ya asignado: asi la clave es 'SRV-12' y no un contador aparte que dos
           cajas tendrian que repartirse. */
        DECLARE @generar BIT = CASE WHEN @part_number IS NULL OR LTRIM(RTRIM(@part_number)) = '' THEN 1 ELSE 0 END;
        IF @generar = 1 SET @part_number = 'SRV-TMP-' + CONVERT(NVARCHAR(36), NEWID());

        INSERT INTO dbo.products
            (part_number, nombre, price, stock, active, category_id, brand_id, cost,
             clave_prod_serv, clave_unidad, objeto_impuesto, tasa_iva,
             inventory_mode, sellable, base_uom, allow_decimal_qty)
        VALUES
            (@part_number, @nombre, @price, 0, 1,
             ISNULL(@category_id, @cat_servicios), @marca_general, 0,
             ISNULL(@clave_prod_serv, '80111600'),   -- servicios, clave generica del SAT
             ISNULL(@clave_unidad, 'E48'),           -- unidad de servicio
             '02', ISNULL(@tasa_iva, 0.16),
             'NONE', 1, 'pza', 0);

        SET @product_id = SCOPE_IDENTITY();

        IF @generar = 1
        BEGIN
            DECLARE @clave NVARCHAR(100) = 'SRV-' + CONVERT(NVARCHAR(12), @product_id);
            /* Solo si nadie la usa ya: el mostrador puede haber escrito 'SRV-12'
               a mano hace un ano, y perder el alta por eso seria absurdo. */
            IF NOT EXISTS (SELECT 1 FROM dbo.products WHERE part_number = @clave)
                UPDATE dbo.products SET part_number = @clave WHERE id = @product_id;
        END
    END
    ELSE
    BEGIN
        IF NOT EXISTS (SELECT 1 FROM dbo.products WHERE id = @product_id)
        BEGIN
            ROLLBACK TRAN;
            RAISERROR('El producto no existe.', 16, 1);
            RETURN;
        END

        UPDATE dbo.products
           SET nombre = @nombre,
               price = @price,
               /* Si el producto enlazado no tenia categoria o marca, se le dan:
                  sin ellas desaparece del catalogo de venta. */
               category_id = ISNULL(@category_id, ISNULL(category_id, @cat_servicios)),
               brand_id = ISNULL(brand_id, @marca_general),
               clave_prod_serv = ISNULL(@clave_prod_serv, clave_prod_serv),
               clave_unidad = ISNULL(@clave_unidad, clave_unidad),
               tasa_iva = ISNULL(@tasa_iva, tasa_iva),
               part_number = ISNULL(NULLIF(LTRIM(RTRIM(@part_number)), ''), part_number),
               /* Un servicio no descuenta existencias, venga de donde venga. */
               inventory_mode = 'NONE',
               sellable = 1
         WHERE id = @product_id;
    END

    MERGE dbo.services AS d
    USING (SELECT @product_id AS product_id) AS s ON d.product_id = s.product_id
    WHEN MATCHED THEN UPDATE SET
        duration_minutes = @duration_minutes,
        requires_professional = @requires_professional,
        default_commission_pct = @default_commission_pct,
        schedulable = @schedulable,
        notes = @notes,
        updated_at = SYSDATETIME()
    WHEN NOT MATCHED THEN INSERT
        (product_id, duration_minutes, requires_professional,
         default_commission_pct, schedulable, notes)
        VALUES (@product_id, @duration_minutes, @requires_professional,
                @default_commission_pct, @schedulable, @notes);

    COMMIT TRAN;

    SELECT p.id AS product_id, p.part_number, p.nombre, p.price, p.active,
           s.duration_minutes, s.requires_professional,
           s.default_commission_pct, s.schedulable, s.notes
      FROM dbo.products p
      JOIN dbo.services s ON s.product_id = p.id
     WHERE p.id = @product_id;
END
GO

/* ---------- sp_service_set_active (SQL_STORED_PROCEDURE) ---------- */
/* sp_service_set_active
 * Definicion canonica. Modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* Retira un servicio del catalogo, o lo devuelve.
 *
 * NO BORRA
 * --------
 * La ficha de `services` se queda y el producto se marca inactivo. Un servicio
 * borrado se llevaria por delante las lineas de ordenes cerradas que lo
 * mencionan, y con ellas el historial de lo que se le cobro a un cliente. Lo
 * que se quiere es que deje de ofrecerse, no que deje de haber existido.
 */
CREATE OR ALTER PROCEDURE dbo.sp_service_set_active
    @product_id INT,
    @active     BIT
AS
BEGIN
    SET NOCOUNT ON;

    IF NOT EXISTS (SELECT 1 FROM dbo.services WHERE product_id = @product_id)
    BEGIN
        RAISERROR('Ese producto no es un servicio.', 16, 1);
        RETURN;
    END

    UPDATE dbo.products SET active = @active WHERE id = @product_id;

    /* Al retirarlo, deja de poder agendarse. Sin esto, la Agenda seguiria
       ofreciendo citas de algo que ya no se vende. */
    IF @active = 0
        UPDATE dbo.services SET schedulable = 0, updated_at = SYSDATETIME()
         WHERE product_id = @product_id;

    SELECT @product_id AS product_id, @active AS active;
END
GO

/* ---------- sp_set_professional_schedule (SQL_STORED_PROCEDURE) ---------- */
/* sp_set_professional_schedule
 * Definicion canonica. Modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* El horario semanal de una persona, completo.
 *
 * Mismo criterio que la matriz de servicios: la pantalla es una semana y el
 * usuario piensa en la semana entera, no en franjas sueltas.
 *
 * Se permiten VARIAS franjas por dia -manana y tarde, con la comida en medio-
 * porque es como trabaja media Mexico, y un solo rango obligaria a decir que
 * el taller abre a las nueve y cierra a las siete sin parar.
 *
 * `weekday` va de 1 a 7 con 1 = domingo, igual que DATEPART(WEEKDAY). Usar la
 * misma numeracion que el motor evita una conversion en cada consulta de la
 * Agenda, y esa conversion es donde se cuelan los errores de un dia entero.
 */
CREATE OR ALTER PROCEDURE dbo.sp_set_professional_schedule
    @professional_id INT,
    @franjas_json    NVARCHAR(MAX)
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    IF NOT EXISTS (SELECT 1 FROM dbo.professionals WHERE id = @professional_id)
    BEGIN
        RAISERROR('Ese profesional no existe.', 16, 1);
        RETURN;
    END

    DECLARE @entrada TABLE (weekday TINYINT, starts_at TIME(0), ends_at TIME(0));

    INSERT INTO @entrada (weekday, starts_at, ends_at)
    SELECT j.weekday, j.starts_at, j.ends_at
      FROM OPENJSON(ISNULL(@franjas_json, '[]'))
           WITH (weekday TINYINT '$.weekday',
                 starts_at TIME(0) '$.startsAt',
                 ends_at TIME(0) '$.endsAt') j
     WHERE j.weekday IS NOT NULL AND j.starts_at IS NOT NULL AND j.ends_at IS NOT NULL;

    IF EXISTS (SELECT 1 FROM @entrada WHERE weekday < 1 OR weekday > 7)
    BEGIN
        RAISERROR('El dia de la semana va de 1 (domingo) a 7 (sabado).', 16, 1);
        RETURN;
    END

    IF EXISTS (SELECT 1 FROM @entrada WHERE ends_at <= starts_at)
    BEGIN
        RAISERROR('Una franja tiene que terminar despues de empezar.', 16, 1);
        RETURN;
    END

    /* Dos franjas del mismo dia que se pisan describen un horario que nadie
       puede cumplir, y la disponibilidad las contaria dos veces. */
    IF EXISTS (SELECT 1
                 FROM @entrada a
                 JOIN @entrada b ON a.weekday = b.weekday
                                AND a.starts_at < b.ends_at
                                AND b.starts_at < a.ends_at
                                AND (a.starts_at <> b.starts_at OR a.ends_at <> b.ends_at))
    BEGIN
        RAISERROR('Hay franjas del mismo dia que se enciman.', 16, 1);
        RETURN;
    END

    BEGIN TRAN;

    DELETE FROM dbo.professional_schedules WHERE professional_id = @professional_id;

    INSERT INTO dbo.professional_schedules (professional_id, weekday, starts_at, ends_at, active)
    SELECT @professional_id, weekday, starts_at, ends_at, 1 FROM @entrada;

    COMMIT TRAN;

    SELECT id, professional_id, weekday, starts_at, ends_at, active
      FROM dbo.professional_schedules
     WHERE professional_id = @professional_id
     ORDER BY weekday, starts_at;
END
GO

/* ---------- sp_set_service_professionals (SQL_STORED_PROCEDURE) ---------- */
/* sp_set_service_professionals
 * Definicion canonica. Modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* Quien puede hacer este servicio. La lista completa, no altas sueltas.
 *
 * POR QUE LA LISTA ENTERA
 * -----------------------
 * La pantalla es una lista de casillas: el usuario marca y desmarca, y al
 * guardar lo que tiene en la cabeza es "estos cuatro". Mandar altas y bajas
 * por separado obligaria a la pantalla a llevar la cuenta de lo que cambio, y
 * esa cuenta es exactamente donde aparecen los estados imposibles.
 *
 * Una lista VACIA no es un error: significa "lo hace cualquiera". Es el estado
 * por omision y el que quiere un negocio pequeno, que no va a mantener una
 * matriz de quince servicios por ocho personas.
 *
 * Se recibe JSON y no una tabla de parametros por seguir lo que ya hace
 * `sp_set_product_modifier_groups`: un patron conocido vale mas que un tipo
 * nuevo para lo mismo.
 */
CREATE OR ALTER PROCEDURE dbo.sp_set_service_professionals
    @service_product_id INT,
    @asignaciones_json  NVARCHAR(MAX)
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    IF NOT EXISTS (SELECT 1 FROM dbo.services WHERE product_id = @service_product_id)
    BEGIN
        RAISERROR('Ese producto no es un servicio.', 16, 1);
        RETURN;
    END

    DECLARE @entrada TABLE (professional_id INT PRIMARY KEY, commission_pct DECIMAL(5, 2) NULL);

    INSERT INTO @entrada (professional_id, commission_pct)
    SELECT DISTINCT j.professional_id, j.commission_pct
      FROM OPENJSON(ISNULL(@asignaciones_json, '[]'))
           WITH (professional_id INT '$.professionalId',
                 commission_pct DECIMAL(5, 2) '$.commissionPct') j
     WHERE j.professional_id IS NOT NULL;

    IF EXISTS (SELECT 1 FROM @entrada e
                WHERE NOT EXISTS (SELECT 1 FROM dbo.professionals p WHERE p.id = e.professional_id))
    BEGIN
        RAISERROR('La lista incluye a alguien que ya no existe.', 16, 1);
        RETURN;
    END

    IF EXISTS (SELECT 1 FROM @entrada WHERE commission_pct < 0 OR commission_pct > 100)
    BEGIN
        RAISERROR('La comision va de 0 a 100.', 16, 1);
        RETURN;
    END

    BEGIN TRAN;

    MERGE dbo.service_professionals AS d
    USING (SELECT @service_product_id AS service_product_id, professional_id, commission_pct
             FROM @entrada) AS s
       ON d.service_product_id = s.service_product_id
      AND d.professional_id = s.professional_id
    WHEN MATCHED THEN UPDATE SET commission_pct = s.commission_pct
    WHEN NOT MATCHED BY TARGET THEN
        INSERT (service_product_id, professional_id, commission_pct)
        VALUES (s.service_product_id, s.professional_id, s.commission_pct)
    WHEN NOT MATCHED BY SOURCE AND d.service_product_id = @service_product_id THEN DELETE;

    COMMIT TRAN;

    SELECT sp.service_product_id, sp.professional_id, p.full_name, sp.commission_pct
      FROM dbo.service_professionals sp
      JOIN dbo.professionals p ON p.id = sp.professional_id
     WHERE sp.service_product_id = @service_product_id
     ORDER BY p.full_name;
END
GO
