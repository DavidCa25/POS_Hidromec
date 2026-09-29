# Wybix · Pantallas Operativas

> Conecta una tablet a Wybix y conviértela en la pantalla de trabajo que
> necesitas: Cocina, Barra, Mesero, Mi jornada, Técnico, Inventario o Estado de
> pedidos. Con o sin Internet, mientras exista la red local.

Se construye sobre **Wybix Local Host** ([local-host.md](local-host.md)): el mismo
servidor, el mismo puerto (7427), el mismo emparejamiento, el mismo tiempo real
(SSE) y la misma regla de seguridad. Nada se duplicó: el KDS pasó a ser la
primera superficie registrada.

## Tres cosas separadas

| Concepto | Qué es | Dónde vive |
| --- | --- | --- |
| **Dispositivo** | La tablet, laptop o TV emparejada. Tiene su credencial y su **función actual**. No es una persona. | `dispositivos_locales` (`superficie`, `config`) |
| **Superficie** | Qué es esa función: qué ve, qué hace, qué eventos le importan, cuándo suena. | `electron/local-host/superficies/*` + registro |
| **Trabajador** | Quién la usa ahora, por QR o PIN. La identidad que ya existe (`users` o `professionals`). | `trabajadores_acceso`, `trabajador_sesiones` |

Una tablet compartida: **Mi jornada** → entra Sofía (su agenda) → sale → entra
Ana (la suya). Sin volver a emparejar.

## Registro de superficies

`electron/local-host/superficies/registro.js`. Cada módulo registra las suyas;
nadie más decide «si es hospitality, KDS».

| Superficie | Familia | Capacidad | Identidad | Ve | Hace | Sin conexión | Sonido |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `PREPARATION` (Preparación) | Estación | `comandas` | Ninguna (la estación) | Comandas de su estación: mesa, líneas, opciones, notas, tiempos | `AVANZAR` (Empezar → Lista → Entregada) | ONLINE_REQUIRED | Comanda nueva |
| `WAITER` (Mesero) | Trabajador | `mesas` | Usuario con `VENTAS_OPERAR` | Mesas de sus áreas, cuentas, estado en cocina, menú sin costos | `ABRIR_MESA`, `ENVIAR` | ONLINE_REQUIRED | Algo de sus mesas quedó listo |
| `STAFF_DAY` (Mi jornada) | Trabajador | `servicios` + giro con agenda | Profesional (con o sin usuario) | Sus citas de hoy: hora, clienta, servicio, estado, nota | `LLEGO`, `EMPEZAR`, `TERMINAR`, `NOTA`, `CONSUMO` | OFFLINE_SAFE | Llegó su clienta / cita nueva |
| `TECHNICIAN` (Técnico) | Trabajador | `servicios` + giro de órdenes | Profesional (con o sin usuario) | Sus trabajos: activo, cliente (nombre), reporte, promesa, materiales, notas | `EMPEZAR`, `PAUSAR`, `REANUDAR`, `TERMINAR`, `NOTA`, `MATERIAL` | OFFLINE_SAFE | Trabajo nuevo asignado |
| `INVENTORY_FLOOR` (Inventario) | Trabajador | siempre | Usuario con `VENTAS_OPERAR` o `INVENTARIO_OPERAR` | Buscar, existencia, precio, unidad | `CONTAR`, `FALTANTE` | OFFLINE_SAFE (el conteo diferido se reporta) | Sin sonido |
| `CUSTOMER_STATUS` (Estado de pedidos) | Pública | `comandas` | Ninguna (TV con credencial; teléfono en `/pedidos`) | Número de pedido del día, PREPARANDO / LISTO y primer nombre (las mesas solo si se eligen, por su nombre) | Nada (solo lectura) | Solo lectura | Opcional al pasar a Listo |

Ninguna superficie cobra, cambia precios, administra usuarios ni toca la
configuración: esas acciones **no existen** en el registro, así que cualquier
intento (`PAY`, `COBRAR`, `CAMBIAR_PRECIO`) recibe 403 y queda auditado. Cuando
se quiera cobrar desde el mesero, será una acción nueva con su propio paquete,
no un botón escondido.

## Capacidades

`electron/local-host/capacidades.js` lee la misma fuente que `CapabilityService`:
módulos (`sp_get_business_modules`) y, para Servicios, el giro
(`services_config.preset` + `presets.json`). Nunca `business_profile` como
interruptor. Una superficie que no aplica no se ofrece ni se puede emparejar, y
si se apaga el módulo, el dispositivo dice «Asígnale otra función».

| Giro | Superficies |
| --- | --- |
| Hospitality (mesas + comandas) | Preparación, Mesero, Estado de pedidos |
| Servicios · Belleza (agenda) | Mi jornada |
| Servicios · Taller / Reparación (órdenes) | Técnico |
| Servicios · Mantenimiento / Otro (ambos) | Mi jornada y Técnico |
| Cualquiera | Inventario |

## Autenticación

1. **Dispositivo**: el QR de emparejar (un uso, 10 min) → credencial propia en
   cookie `HttpOnly; SameSite=Strict`. Sin ella: 401 en todo.
2. **Trabajador** (solo superficies de trabajador): QR personal o PIN → sesión
   en cookie `wx_trab` (`HttpOnly; SameSite=Strict`), **ligada a ese
   dispositivo y a su función**. La credencial del dispositivo NO es Sofía.

Cada petición: credencial → función (registro) → capacidad del negocio →
sesión de trabajador → permisos de la persona → acción declarada. Todo en el
servidor. No se confía por IP.

### Identidad: sin duplicar

- `users`: identidad con rol → paquetes (`permisos.js`).
- `professionals`: el prestador (estilista, mecánico). Si tiene `user_id`, **la
  persona es el usuario** (una identidad); si no, el acceso es del profesional.
- `trabajadores_acceso`: una fila por persona (usuario XOR profesional) con su
  QR (hash) y su PIN (scrypt + sal). No hay `operational_users`.

### QR personal: amenaza y decisión

El QR es `http://IP_LAN:7427/w/TOKEN`: 256 bits aleatorios, en la base solo el
SHA-256. La cámara de una tablet ya emparejada abre la URL y entra; un lector
de códigos puede teclear el token o la URL en el campo.

| Amenaza | Mitigación |
| --- | --- |
| Alguien fotografía el QR | Solo sirve en un dispositivo **ya emparejado** con este Host y en la red local. «QR nuevo» invalida el anterior y cierra sus sesiones al momento; «Quitar acceso» también. Cada acción queda auditada con persona y dispositivo. |
| Usarlo desde fuera | El Host no está en Internet (sin UPnP, sin redirección, firewall solo subred local). |
| Robar la sesión | Cookie HttpOnly/SameSite, sesión ligada a un dispositivo y a su función, corta (ver abajo). |
| Datos en el QR | Ninguno: ni nombre, ni contraseña, ni nada reutilizable. |

Si hace falta más, V2: exigir QR + PIN en funciones sensibles.

### PIN

4 a 8 dígitos; se rechazan series (1234) y repetidos (7777). scrypt con sal
propia. Se entra eligiendo el nombre y tecleando el PIN (la tablet ve nombres,
nada más). 5 fallos seguidos bloquean ese PIN 5 minutos; además hay límite de
intentos por dispositivo.

### Política de sesión

- Una sesión por dispositivo: si entra otra persona, la anterior sale.
- Cierre por inactividad según la función: Mesero 60 min, Inventario 45 min,
  Mi jornada / Técnico 120 min.
- Tope absoluto: **fin del día local**. Una tablet del salón nunca amanece
  siendo «Carlos».
- Al salir: se borra la sesión, la caché personal de la tablet y todo dato
  privado en pantalla; se conserva el emparejamiento y la función.

### Cambiar la función de un dispositivo

- Desde la tablet: Ajustes → Cambiar función → elegir (solo las disponibles) →
  PIN de un **administrador** (`CONFIGURACION_ADMINISTRAR`). Un encargado o un
  trabajador no puede.
- Desde Wybix: Configuración → Dispositivos locales → Cambiar función.
- En ambos casos: la pantalla recibe el aviso al momento, las sesiones se
  cierran y queda en la auditoría.

## Tiempo real y eventos

SSE, sin cambio de tecnología: el tiempo real sigue yendo en una dirección y las
acciones son POST. `eventos.js` tiene **fuentes** (comandas, cuentas, citas,
líneas de orden, reportes de inventario), cada una con su ROWVERSION. Una fuente
se consulta **una vez por vuelta sin importar cuántas tablets haya**, y solo si
hay alguien conectado que la necesite: 10 tablets no son 10 consultas.

Cada superficie traduce el cambio crudo a un evento semántico:
`PREPARATION_TICKET_CREATED`, `PREPARATION_UPDATED`, `ORDER_UPDATED`,
`ORDER_READY`, `TABLE_UPDATED`, `APPOINTMENT_ASSIGNED`, `APPOINTMENT_UPDATED`,
`CLIENT_ARRIVED`, `WORK_ASSIGNED`, `WORK_UPDATED`, `INVENTORY_TASK_UPDATED`,
`CUSTOMER_ORDER_STATUS_UPDATED`. Los eventos llevan solo identificadores (salvo
Preparación, que ya llevaba la comanda de su estación); la pantalla vuelve a
pedir su estado, que el servidor arma con los campos permitidos.

## Menos privilegio: el servidor no manda lo que no toca

| Superficie | No viaja nunca |
| --- | --- |
| Mi jornada | Teléfono, correo, historial, saldo, datos fiscales, citas de otras personas |
| Técnico | Precios, totales, teléfono, crédito, trabajos no asignados |
| Mesero | Costos, mesas fuera de sus áreas, nombres de otros meseros |
| Inventario | Costo, proveedor |
| Estado de pedidos | Nombres (la etiqueta de un «para llevar» suele ser el nombre), totales, productos, mesa si no se eligió |

## Sin conexión, con criterio

| Modo | Qué pasa sin red |
| --- | --- |
| `OFFLINE_SAFE` | Se guarda en la cola de la tablet con su clave de idempotencia y se envía al volver. |
| `OFFLINE_READONLY` | Se muestra lo último que se vio («Mostrando lo que había a las 10:42»). |
| `ONLINE_REQUIRED` | Se dice que hace falta conexión y **no** se guarda. |

Cola (`localStorage` de la tablet): `clave` (= Idempotency-Key), acción, datos,
función, persona, `creado` local. Al volver: validar dispositivo y sesión →
enviar en orden con `X-Wx-Diferida: 1` → aplicar → confirmar → quitar.

- La clave se **reclama** en `superficie_auditoria` (índice único) antes de
  actuar: un reenvío devuelve el resultado guardado, no repite.
- Conflictos: las transiciones dicen desde qué estado se vio. Si cambió
  mientras tanto → «Esta información cambió mientras estabas sin conexión» y
  no se sobrescribe.
- Un conteo que llega diferido **no** ajusta: se reporta (una hora de ventas no
  se pisa a ciegas).
- Lo pendiente de una persona no se envía con la sesión de otra: al salir sin
  red se pregunta; si se descarta, se descarta.
- Enviar a preparación (mesero) y avanzar comandas (cocina) piden conexión: una
  comanda encolada llegaría tarde y sin que nadie lo supiera.

Límite de HTTP en la LAN: sin contexto seguro no hay `crypto.subtle` para cifrar
la caché. Por eso se guarda lo mínimo y se borra al salir.

## Lo que el dominio no tiene (no se inventó)

| Pedido | Decisión |
| --- | --- |
| «Pausar» un trabajo | La línea sigue EN_PROCESO; PAUSA / REANUDA quedan en el historial de la orden (`sp_service_order_add_event`). |
| Consumo interno no cobrado | No existe. El material entra a la orden como línea PRODUCTO a precio de catálogo y sale del inventario al cobrarse. |
| Checklist del técnico | No existe en las órdenes → deuda. |
| Fotos de la orden | No hay adjuntos de orden; la cámara no está disponible por HTTP en la LAN → deuda. |
| Ubicación / stock piso–almacén / reposición | Wybix no los maneja → la V1 es buscar, existencia, precio, conteo y faltante. |
| Conteo sin permiso | Se **reporta** (`inventario_reportes`); quien tiene `INVENTARIO_OPERAR` lo aplica con `sp_inventory_count_apply` (el mismo ajuste de la pantalla Conteo, ahora atómico) o lo descarta. |

## Número de pedido, cliente y las tres pantallas del pedido

La TV del local mostraba el id interno de la cuenta, que nadie le daba al
cliente. Ahora (migraciones `0046` y `0047`):

- **Número del día.** Una cuenta **sin mesa** (mostrador, para llevar, barra)
  recibe al abrirse `hosp_cuentas.numero_dia`: 1, 2, 3… y vuelve a empezar
  cada día. Lo asigna `sp_hosp_cuenta_abrir` con `UPDLOCK` y un índice único
  `(abierta_dia, numero_dia)`: dos cajas a la vez no lo repiten. Una mesa no
  lleva número.
- **El mismo número en todas partes:** el ticket lo imprime en grande («Tu
  pedido 23»); la caja lo dice al enviar y al cobrar (Touch y Venta); la
  cocina lo canta (`destino` = «Pedido 23 · Para llevar»); la pantalla de
  cobro lo muestra junto al total; el tablero de pedidos lo muestra siempre.

### Tres cosas distintas

| | Qué es | Dónde | Qué muestra |
| --- | --- | --- | --- |
| **Customer Display** | La pantalla de **cobro**, frente a quien paga (segundo monitor de la caja). | `electron/customer-display/customer.html` | Número del pedido, **nombre completo** del cliente si la venta tiene (`customerDisplayName`), total, cambio y un **QR general**. |
| **Order Board / Estado de pedidos** (`CUSTOMER_STATUS`) | El **tablero público** de pedidos. | TV o tablet del negocio (superficie con credencial) y **teléfono del cliente** (`/pedidos`, sin credencial). | Número, estado y **primer nombre** (`publicCustomerName`). |
| **Seguimiento individual** | El pedido de **una** persona. | `/p/<código>` | Conservado para el futuro; hoy ningún QR lleva ahí. |

**El QR de la pantalla de cobro lleva al tablero general**:
`http://IP-del-Host:7427/pedidos`. Lo decide `local-host/qr-pantalla-cliente.js`
(`SEGUIMIENTO_INDIVIDUAL = false`); con `true` llevaría a `/p/<código>` sin
tocar nada más. Nunca se muestran dos QR. La pantalla de cobro no consulta
nada: la caja manda número y nombre por el flujo de siempre, y el proceso
principal agrega el QR ya hecho imagen. Sin Local Host vigente
(`local_host_lease`), muestra número y cliente, sin QR, y el cobro sigue igual.

### Una sola fuente: `pedidosPublicos()`

`local-host/superficies/pedidos-dia.js`. La usan la TV (superficie
`CUSTOMER_STATUS`), el teléfono (`GET /api/pedidos`) y el seguimiento
individual. El teléfono carga **la misma superficie** que la TV
(`s-cliente.js`) con un arranque mínimo (`tablero.html` + `tablero.js`, que
relee cada 5 s). Cambia el CSS, no los datos (prueba K12: el teléfono recibe
exactamente lo mismo que la TV).

- **Pantalla grande (B2):** hero «Acaba de estar listo» en verde sólido
  durante 45 s (`RECIENTE_SEG`), luego pasa al muro de listos; franja «En
  preparación» abajo. El verde fuerte significa «recién listo», nada más.
- **Teléfono (≤ 700 px):** lista vertical: número grande a la izquierda,
  primer nombre, «Listo»; en preparación, «24 · Carlos».

### El DTO público es cerrado

`{ numeroPedido, estado, nombrePublico, reciente?, mesa? }` y nada más
(`mesa` solo en una TV configurada para incluir mesas). `nombrePublico` sale
de `dbo.fn_nombre_publico_cliente` **en SQL**: el nombre completo no sale de
la base por esta consulta; no se oculta con CSS.

| customerName | Pantalla de cobro | Tablero |
| --- | --- | --- |
| David Casillas | David Casillas | David |
| (sin cliente) | (nada) | (solo el número) |
| Público en General | Público en General | (nada) |
| juan@correo.mx / 5512345678 | tal cual | (nada: parece un contacto) |

Nunca teléfono, correo, RFC, dirección, saldo ni datos fiscales (pruebas
K01, K11 y K12).

### El cliente del pedido

- En la caja, el cliente vive en el carrito (`cart.customer`, el de siempre
  de Venta) y termina en `sales.customer_id`. Touch y Venta lo eligen con el
  mismo contrato: `ClientesVentaService` + `MesaService.fijarCliente`.
- Con una cuenta de Hospitality, la cuenta es la fuente mientras no se cobra:
  `hosp_cuentas.customer_id` (FK a `customers`; el nombre no se copia a
  ninguna tabla). `fijarCliente` la guarda (`sp_hosp_cuenta_cliente`) y el
  carrito la refleja; al cobrar, `sp_hosp_cuenta_cobrar` la alinea con la
  venta, que es la que manda.
- Alta mínima desde Touch: nombre y teléfono opcional, con el mismo
  `sp_create_customer` y crédito en cero. Crédito, datos fiscales y lo demás
  siguen en Clientes.
- Después de cobrar o vaciar, el carrito queda sin cliente; cerrar la hoja
  no lo cambia.

### Cobrar sin enviar a preparación

Si una venta con cuenta, o un «para llevar» con cocina, tiene líneas **con
estación activa** que no se enviaron (`product_prep_station`: la misma regla
con la que `sp_hosp_orden_enviar` crea comandas), cobrar pregunta: «Hay
productos sin enviar a preparación», con **Enviar y cobrar** y **Volver**.
Enviar usa el envío de siempre, idempotente por `origen`: no duplica
comandas. Un producto sin estación (agua) no cuenta y no va a cocina. Touch y
Venta (cuentas de mesa) hacen lo mismo.

### Rutas públicas: amenaza y decisión

| Riesgo | Decisión |
| --- | --- |
| Ver datos de otros | Tablero: número, estado y primer nombre, lo mismo que la TV. El DTO es cerrado. |
| Escalar desde el teléfono | `/pedidos` y `/api/pedidos` no dan cookie, credencial ni sesión; la página no carga la app de trabajo; `/api/s/*` y `/api/trabajador/*` siguen en 401 (K12). Solo lectura (405). |
| Abuso | 120 consultas/min por IP en `/api/pedidos`; 60/min en `/api/p/*`. |
| Adivinar códigos individuales | 128 bits de `CRYPT_GEN_RANDOM`, uno por pedido, válidos el día del pedido. |
| Código individual en claro en la base | Se guarda tal cual (vale un día y protege poco). Nunca sale hacia una pantalla de Wybix: `sp_hosp_cuenta_get` no lo devuelve. |
| Fuera del local | Sin túnel, reenvío de puertos ni nube. El cliente tiene que estar en el **Wi-Fi del local**; con datos móviles no llega (aceptado). Una red de invitados aislada de la LAN tampoco. |

## Auditoría

`superficie_auditoria`: momento, dispositivo, sesión, persona, superficie,
acción, entidad, detalle, clave de idempotencia y resultado. Se registran
acciones, entradas, salidas, cambios de función y rechazos (p. ej. `PAY`). No
cada pantalla que se pinta.

## Administración

Configuración → **Dispositivos locales** (diseño B aprobado, cajón amplio):

- mapa de la red: router, esta computadora (Local Host), cada dispositivo con
  su función, estación o persona y su estado; Internet aparte;
- **Conectar dispositivo**: elegir la función (solo las disponibles), estación,
  áreas del mesero u opciones de la pantalla pública → QR;
- por dispositivo: Ver (sesión, inicio, última actividad, último contacto,
  acciones sin enviar), Cambiar función, Renombrar, Revocar;
- **Personas**: QR nuevo, PIN, quitar acceso;
- firewall (solo diagnosticar; crear la regla, a petición).

Conteos y faltantes reportados: canales `inventario:reportes` y
`inventario:reporte-resolver` (paquete `INVENTARIO_OPERAR`).

## Pruebas

```
npm run test:local-host      # Preparación (KDS): las 30 pruebas de Local Host
npm run test:pantallas       # núcleo, mesero, jornada, técnico, inventario, pedidos, sin conexión, seguridad, Internet
npx playwright test e2e/dispositivos-locales.spec.js   # la pantalla de administración
```

## Laboratorios de QA manual

Preparación común: computadora Wybix (instalación principal) por Ethernet al
router; tablets por Wi-Fi al mismo router. Configuración → Dispositivos locales →
«Permitir pantallas en la red local» y, la primera vez, Revisar firewall →
Permitir. En **Personas**, genera los QR y PIN de quienes van a probar. Repite
cada laboratorio **con el WAN del router desconectado** y **conectado**: debe
comportarse igual.

### Lab A — Preparación (regresión)
Ver [local-host.md](local-host.md), laboratorio de 22 pasos.

### Lab B — Mesero
1. Conectar dispositivo → **Mesero** → escanear el QR con la tablet.
2. En la tablet: «¿Quién eres?» → Carlos escanea su QR (cámara) o usa su PIN.
3. Ver «Mis mesas y libres».
4. Tocar **Mesa 1** (se abre a su nombre).
5. Agregar **Latte** (elegir la leche: es obligatoria) y **Sandwich**.
6. **Enviar a preparación**.
7. La tablet de Barra recibe el Latte y la de Cocina el Sandwich, y suenan.
8. En la mesa, ver «En espera / Preparando / Listo»; al marcar Lista en Barra,
   suena en la tablet del mesero.
9. Buscar cómo cobrar: no hay botón. «El cobro se hace en caja».

### Lab C — Mi jornada
1. Conectar dispositivo → **Mi jornada** → «Tablet empleados».
2. Sofía escanea su QR.
3. Ve sus citas de hoy (solo las suyas) y la siguiente.
4. Tocar una cita → **Llegó**.
5. **Empezar**.
6. Nota rápida: «Pidió tono 148» → Guardar.
7. Materiales: buscar «Gel», agregar 2 → Guardar.
8. **Terminar**. En Wybix (Órdenes / Agenda) la orden aparece terminada.
9. **Salir**.
10. Ana entra con su PIN.
11. No debe ver nada de Sofía (ni en pantalla ni al volver atrás).

### Lab D — Técnico
1. Conectar dispositivo → **Técnico** (laptop del taller).
2. Carlos escanea su QR.
3. Ve sus trabajos (no los de otro técnico).
4. **Empezar**.
5. Nota: «Balatas traseras al 20%».
6. Material: «Aceite 5W30» × 4 (sin poder cambiar el precio).
7. **Pausar** → en la orden de Wybix queda la pausa en el historial.
8. **Continuar**.
9. **Terminar**. Si no queda trabajo de nadie más, la orden queda terminada.

### Lab E — Inventario
1. Conectar dispositivo → **Inventario** (teléfono).
2. Luis (Operador) entra.
3. Buscar «Coca» o escanear el código con un lector USB/Bluetooth.
4. Ver existencia y precio.
5. **Contar** 12 → «Conteo reportado para revisión» (Luis no ajusta).
6. **Reportar faltante**.
7. Una encargada (con permiso de inventario) cuenta en línea → la existencia se
   ajusta. Apagar el Wi-Fi, contar, volver: queda como reporte, no ajusta.
8. Confirmar que no hay nada administrativo en la tablet.

### Lab F — Estado de pedidos
1. Conectar dispositivo → **Estado de pedidos** en una TV o tablet del negocio.
2. No pide que nadie entre.
3. Crear un pedido (Touch o mesero) y enviarlo.
4. Aparece como **Preparando** (número y, si tiene cliente, su primer nombre).
5. Cocina lo marca **Lista** → pasa a **Listo**.
6. A los minutos configurados desaparece.
7. Desde otro equipo, abrir `http://IP:7427/api/s/estado`, `/api/kds/estado`,
   `/api/s/consulta/cuenta?id=1`: todo 401 sin credencial.
8. Con la credencial de la TV, intentar una acción: 403.
9. En Touch, «Para llevar» → **Cliente** → buscar o dar de alta «David
   Casillas» → enviar: el aviso dice «Pedido N enviado a preparación»; la
   cocina lo muestra como «Pedido N · Para llevar».
10. La TV muestra «N · David» en preparación (nunca el apellido).
11. Cobrar: el ticket dice «Tu pedido N»; la pantalla de cobro muestra #N,
    «David Casillas» y el QR durante 30 s. La venta siguiente empieza sin
    cliente.
12. Con un teléfono **en el Wi-Fi del local**, escanear el QR: abre el
    tablero general (`/pedidos`) en vertical, con lo mismo que la TV. Cocina
    lo marca Lista → TV y teléfono muestran el hero «Acaba de estar listo ·
    N · David».
13. El mismo teléfono en datos móviles: «No llegamos al local».
14. Para llevar con un producto de cocina sin enviar → Cobrar: pregunta
    «Enviar y cobrar / Volver». Solo con agua: cobra sin preguntar.

## Riesgos y deuda

- Safari iPad no se prueba de forma automática (sin WebKit en el equipo): QA manual.
- Acabado visual de las superficies nuevas pendiente de elegir entre A/B/C.
- Sin HTTPS: sin PWA completa, Wake Lock ni cifrado de la caché (se guarda lo mínimo).
- Checklist, fotos, ubicaciones y reposición: no existen en el dominio.
- Cobro desde el mesero: arquitectura preparada (acción + paquete), no implementado.
- El KDS de escritorio sigue usando `kds:estado` directo (en una carrera recibe «ya pasó por ese paso»).
- El QR de la pantalla de cobro lleva la IP del Host de ese momento: si cambia (DHCP), un QR ya escaneado deja de responder. Reservar la IP en el router.
- «Aquí» sin mesa con productos de cocina: no se puede enviar sin mesa, así que cobrar no pregunta (queda como antes).
- Venta tradicional: el modal de clientes no tiene alta rápida (Touch sí); la selección desde ese modal no tiene prueba de punta a punta propia.
- Sin HTTPS en la LAN, el navegador del teléfono puede marcar la página como «no segura». No lleva datos personales.
- QR del trabajador con la IP de ese momento: si cambia la IP (DHCP), la cámara abre una dirección vieja; el lector de códigos sigue funcionando. Solución: reservar la IP en el router o regenerar el QR.
