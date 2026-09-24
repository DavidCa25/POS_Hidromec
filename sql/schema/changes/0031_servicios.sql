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
