# Manual de Wybix POS

Guía completa del punto de venta **Wybix POS**: qué es, cómo funciona y cómo se usa cada módulo.
Este documento es la base para generar los PDF/manuales del sitio (sección *Recursos*).

> Cada sección con `##` puede convertirse en un PDF independiente.

---

## 1. ¿Qué es Wybix POS?

Wybix POS es un **punto de venta para negocios en México**. Se instala en una computadora con **Windows** y funciona **sin internet** (offline-first): guarda todo en una base local y respalda en la nube cuando hay conexión. Si se cae el internet, sigues vendiendo.

**Cómo funciona por dentro (resumen técnico):**

- Aplicación de escritorio (Electron) con una base de datos **SQL Server Express** instalada localmente.
- Respaldo y funciones en la nube opcionales (respaldos, app del dueño, facturación).
- Modelo de **licencia anual** con actualizaciones y soporte incluidos por 12 meses.
- Planes: **MonoCaja** (1 caja) y **MultiCaja** (varias cajas/sucursales en red).

---

## 2. Requisitos e instalación

**Necesitas:** una PC con Windows. **Opcional:** impresora de tickets térmica (58mm), lector de código de barras (USB), cajón de dinero y un segundo monitor (para la pantalla de cliente).

**Instalación:**

1. Descarga el instalador `Wybix-Setup.exe` desde el sitio (o el enlace que te enviamos).
2. Ejecútalo. Si Windows muestra un aviso de "editor desconocido", da clic en **Más información → Ejecutar de todos modos** (es seguro).
3. El instalador prepara todo automáticamente: instala el motor **SQL Server Express** y crea la base de datos. Este paso tarda unos minutos.
4. Al terminar, la aplicación se abre en el **asistente de configuración inicial**.

**Cómo funciona:** el instalador es autónomo; no necesitas instalar SQL por separado ni saber de bases de datos. Todo queda listo en un solo paso.

---

## 3. Primer arranque (configuración inicial)

Al abrir por primera vez, el asistente te da dos caminos:

- **Iniciar prueba gratis (30 días):** instala el sistema sin necesidad de licencia. Ideal para evaluar.
- **Ya tengo una licencia:** activa tu clave si ya compraste.

Después, el sistema te guía para:

1. **Crear el usuario administrador** (usuario y contraseña).
2. **Capturar los datos del negocio** (nombre, RFC opcional, dirección, teléfono).
3. **Cargar un catálogo inicial por giro** (Abarrotes, Ferretería, Refaccionaria, Farmacia): agrega productos base con marcas reales para arrancar rápido. También puedes importar tu propio catálogo desde Excel.

Al terminar, entras al sistema listo para vender.

---

## 4. Licencia y prueba gratis

**Prueba gratis:** 30 días con todas las funciones, sin tarjeta. Verás un aviso con los **días restantes** y recordatorios a los **15, 7, 3 y 1 día**. Al terminar, el sistema se bloquea hasta activar una licencia.

**Activar tu licencia (en cualquier momento):**

1. Ve a **Configuración → Licencia**.
2. Escribe la **clave** que recibiste por correo/WhatsApp al comprar.
3. Da clic en **Activar**. El módulo se desbloquea y aparece tu plan (MonoCaja o MultiCaja).

**Liberar el equipo:** si vas a mover la licencia a otra computadora, usa **Liberar esta computadora** en el mismo panel.

**Cómo funciona:** la licencia se valida contra la nube al activarla y queda guardada de forma cifrada en el equipo. Funciona sin internet después de la primera validación.

---

## 5. Punto de venta (módulo Venta)

Es la pantalla principal para **cobrar**.

**Cómo se usa:**

1. Agrega productos: **escanea** el código de barras (lector USB) o búscalos por nombre/número de parte.
2. Ajusta cantidades y quita renglones si es necesario.
3. Da clic en **Cobrar** y elige la forma de pago: **Efectivo, Tarjeta, Transferencia, Crédito (fiado)** o **Terminal Mercado Pago**.
4. En efectivo, captura el dinero recibido y el sistema calcula el **cambio**.
5. Al confirmar: se **imprime el ticket** y se **abre el cajón** automáticamente (si están configurados).

**Funciones útiles:**

- **Cuentas en espera:** abre varias ventas a la vez para atender a varios clientes sin perder el avance de cada uno.
- **Salida de efectivo:** registra retiros de caja (por ejemplo, pago a proveedor) con nota.
- Solo aparecen las **formas de pago que activaste** en Configuración.

---

## 6. Inventario

Controla tus productos, precios y existencias.

**Cómo se usa:**

- **Agregar producto:** captura marca, categoría, número de parte, nombre, precio, stock y **código de barras**. Para facturar, agrega las **claves SAT** (producto/servicio y unidad) y la tasa de IVA.
- **Crear marcas y categorías** nuevas desde sus botones.
- **Proveedores por producto:** registra costo y proveedor por defecto (sirve para calcular utilidad).
- **Buscar** por nombre, número de parte, marca, categoría o proveedor.
- Puedes elegir el **color de la tabla** desde el encabezado del sistema.

**Cómo funciona:** cada venta descuenta el stock; cada compra lo suma. El código de barras permite escanear en la venta.

---

## 7. Conteo físico de inventario

Sirve para **cuadrar** el stock real contra el del sistema.

**Cómo se usa:**

1. Entra a **Inventario → Conteo físico**.
2. Captura la cantidad **real** contada de cada producto.
3. El sistema muestra el **descuadre** (diferencia) y te permite **aplicar el ajuste** para que el stock quede correcto.

---

## 8. Compras (reabastecer inventario)

Registra la mercancía que te llega.

**Cómo se usa:**

1. Ve a **Compra → Registrar compra**.
2. Elige el proveedor y agrega los productos con su **cantidad** y **precio de compra (sin IVA)**.
3. Indica el **% de ganancia**; el sistema calcula el **nuevo precio sugerido** (compra + IVA + ganancia).
4. Al registrar, **sube el stock** y **actualiza el precio** de venta.

También hay una **Tabla de compras** para consultar el historial.

---

## 9. Clientes y crédito (fiado)

**Cómo se usa:**

- Da de alta clientes con sus datos y, si vendes a crédito, su **límite de crédito**.
- En la venta, elige **Crédito (fiado)** y asigna el cliente.
- Registra **abonos** cuando el cliente pague.
- El sistema lleva el **saldo** y avisa de **crédito vencido** en Alertas.

---

## 10. Proveedores

Administra a quién le compras: datos de contacto y su relación con los productos (costos por proveedor). Se usa en Compras y en el cálculo de utilidad.

---

## 11. Corte de caja y turnos

Cada caja lleva su **turno**, sus ventas y su **corte**.

**Cómo se usa:**

1. Ve a **Venta → Corte del día**.
2. Revisa el resumen del turno: ventas por forma de pago, entradas y salidas de efectivo.
3. Captura el efectivo **contado** para ver el **descuadre** (sobrante o faltante).
4. Cierra el turno.

---

## 12. Estadísticas y dashboard

Panel con la salud del negocio (solo administrador).

**Incluye:** ventas del día/semana/mes, ticket promedio, clientes (activos, nuevos, top), productos más vendidos y sin rotación, y **utilidad** (calculada con el costo del proveedor).

**Extras:** botón de **modo oscuro** y selector de **color** del inventario.

---

## 13. Alertas inteligentes (protección del dinero)

Detecta problemas antes de que te cuesten dinero. Aparece un **globo con el número de alertas** en el menú.

**Tipos de alerta:**

- **Reorden inteligente / stock mínimo:** productos por agotarse según su rotación.
- **Agotados** y **sin rotación** (productos estancados).
- **Ventas en $0.00** y **devoluciones irregulares** por cajero (robo hormiga).
- **Descuadre de caja** y **crédito vencido** (cobranza).

**Cómo funciona:** el sistema analiza tus ventas, cortes y movimientos, y resalta lo que necesita tu atención. Puedes exportar los reportes.

---

## 14. Facturación CFDI 4.0

Emite facturas válidas para el SAT directo desde la venta.

**Cómo se usa:**

1. Ve a **Configuración → Facturación** y captura tu **RFC, régimen fiscal y código postal**.
2. Sube tus **certificados CSD** (.cer y .key) con su contraseña.
3. Desde una venta, factúrala con un clic (elige uso de CFDI y datos del cliente).
4. Puedes **cancelar** una factura desde el listado.

**Timbres:** cada factura consume un **timbre**. Los timbres se compran por paquete según tu volumen.

**Cómo funciona:** el timbrado se realiza a través de un proveedor autorizado (PAC); tus certificados se resguardan de forma segura.

---

## 15. Pantalla de cliente (segundo monitor)

Muestra la venta en tiempo real de cara al cliente, en un segundo monitor.

**Cómo se usa:**

1. Conecta un segundo monitor.
2. Ve a **Configuración → Pantalla de cliente** y actívala; elige en qué **monitor** se muestra.
3. Se **abre sola** cada vez que inicias el punto de venta.

**Estados:** en **espera** muestra el nombre del negocio, bienvenida y hora; durante la **venta** muestra el ticket en vivo (productos, subtotal, IVA, total); al **cobrar** muestra total, pago recibido, cambio y "¡Gracias por su compra!", y regresa sola a espera.

---

## 16. Pago de servicios y recargas (módulo opcional)

Ofrece **recargas de tiempo aire** y **pago de servicios** (luz, agua, gas, etc.) a tus clientes.

**Cómo se usa:**

1. Ve a **Configuración → Pago de servicios**.
2. Elige el proveedor (TAECEL), captura tus credenciales y **conecta** tu cuenta.
3. Al activarse, aparece **"Pago de servicios" en el menú lateral** y puedes empezar a operar.
4. Si lo desconectas, el módulo desaparece del menú.

**Cómo funciona:** es un módulo que se activa solo cuando lo configuras (el menú muestra únicamente lo que tienes disponible). Las operaciones consumen el **saldo** de tu cuenta con el proveedor y generan una comisión.

---

## 17. MultiCaja y sucursales

Con el plan **MultiCaja** operas varias cajas o sucursales conectadas en la **red local**.

**Cómo funciona:**

- Una computadora es el **Servidor Principal**: tiene la base de datos.
- Las demás son **Cajas Secundarias**: se conectan al principal por su **dirección IP**.
- Todas comparten inventario, ventas y clientes **en tiempo real**; cada caja lleva su propio turno y corte.

**Cómo se configura:** al instalar una caja secundaria, en el asistente eliges "Caja Secundaria" e ingresas la IP del principal y la clave de red. Cada máquina elige cuál caja es desde **Configuración → Cajas**.

---

## 18. App móvil del dueño y nube

Monitorea tu negocio desde el celular (ventas, inventario), incluso a distancia.

**Cómo se usa:** en **Configuración**, usa el **QR de emparejamiento** para vincular la app móvil con tu negocio. La primera app viene incluida en tu plan.

---

## 19. Configuración (resumen de paneles)

Todo se ajusta desde **Configuración**, organizado en secciones:

- **Cobros:** Terminal Mercado Pago, Formas de pago.
- **Servicios:** Pago de servicios (recargas).
- **Dispositivos:** Impresora de tickets, Lector de códigos, Cajón de dinero, Báscula, Pantalla de cliente, Emparejamiento QR, App móvil.
- **Personalización:** Ticket (logo, pie de página, datos fiscales), Datos del negocio.
- **Datos y respaldos:** Respaldos (exportar/importar, respaldo automático).
- **Sistema:** Licencia, Usuarios y permisos, Actualizaciones, Diagnóstico, Cajas.
- **Facturación:** configuración fiscal (RFC, CSD).

---

## 20. Usuarios y permisos

**Cómo se usa:** en **Configuración → Usuarios y permisos** puedes **crear usuarios**, asignar **rol** (Administrador, Supervisor, Cajero), **restablecer contraseña** y **activar/desactivar** usuarios. El rol define a qué secciones tiene acceso cada quien.

---

## 21. Respaldos

Protege tu información.

**Cómo se usa:**

- **Exportar** un respaldo manual (archivo `.bak`) e **importar/restaurar** uno previo.
- Activa el **respaldo automático diario** a la hora que elijas.
- Opcional: guarda una **copia fuera de la máquina** (OneDrive/Google Drive) para que, si se daña el disco, tu información siga a salvo.

---

## 22. Actualizaciones

El sistema **busca actualizaciones** y te avisa con una notificación cuando hay una nueva versión. Puedes **descargarla e instalarla** con un clic; se aplica al reiniciar. Revisa la versión actual en **Configuración → Actualizaciones**.

---

## 23. Dispositivos (impresora, lector, cajón)

**Impresora de tickets:** selecciona tu impresora del sistema; el ticket sale en formato **58mm**.
**Lector de código de barras:** conéctalo por **USB** y escanea directo en la venta (no requiere configuración especial).
**Cajón de dinero:** normalmente se conecta a la impresora; puedes activar que **se abra automáticamente al cobrar**.

---

## Soporte

¿Dudas? Contáctanos por **WhatsApp (+52 477 408 4887)** o al correo **ventas@wybix.mx**.
