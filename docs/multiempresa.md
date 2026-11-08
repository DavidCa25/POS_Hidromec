# MultiEmpresa

Un dueño con varias empresas las maneja desde la misma caja: un selector en la barra
superior cambia de empresa, y **Mis empresas** muestra las de su grupo lado a lado.

No es MultiSucursal. MultiSucursal son sucursales de **una** empresa que comparten
catálogo. MultiEmpresa son **empresas distintas** —otro RFC, otro efectivo, otros
productos— del mismo dueño.

| Caso | Ejemplo | Cómo se ve otra empresa |
|---|---|---|
| Misma computadora | B&J Super y Los Pachoncitos, en el mismo mostrador | **Local**: se cambia de base al instante, sin Internet |
| Computadoras distintas | I Do Nut y Birrialtlan, en otras sucursales | **Remota**: se consulta por la nube y los cambios llegan por bandeja |

## Decisión de arquitectura: una base por empresa

Cada empresa es su propia base de SQL Server. Se descartó una sola base con
`empresa_id` (el modelo de Odoo):

- Wybix tiene 147 tablas y 344 procedimientos escritos para una empresa por base.
  Filtrar todos por empresa es reescribirlos, y un solo `WHERE` olvidado mezcla el
  efectivo o las ventas de dos empresas. Con bases separadas eso es imposible.
- La identidad en la nube ya es **una base = una ubicación** (`instance_uuid` en
  `database_metadata`): cada empresa tiene su RFC, su facturación, su app del dueño y
  su menú en línea sin cambiar nada.
- SQL Server Express limita a 10 GB **por base**: cada empresa tiene los suyos. La
  memoria (1.4 GB del motor) se comparte, y una base que no se usa casi no la ocupa.
- Se respalda, restaura o entrega una empresa sin tocar las demás.

El costo: migraciones, respaldos y el usuario de red de las secundarias deben recorrer
todas las bases del grupo. Este documento dice dónde se hace.

## Fase 1 · Empresas en la misma computadora

### El grupo vive en las bases

Cada base del grupo guarda `database_metadata('empresas_grupo') = <uuid>` y la
lista completa de los miembros en `dbo.empresas_grupo_bases`. No hay archivo de
configuración aparte:

- Las cajas secundarias, que se conectan al mismo servidor, ven el mismo grupo.
- Restaurar el respaldo de una base conserva su pertenencia.

`sp_empresas_locales` lee **solo** las bases de esa lista y comprueba en cada
una que siga en el mismo grupo. Nunca recorre todas las bases del servidor: en
SQL Express cada base cerrada tarda en abrirse (AUTO_CLOSE), y una base ajena
con bloqueos colgaba el selector. Medido: recorrer veinte bases tardaba cuatro
segundos y a veces no terminaba. Una base que salió del grupo, se borró o no
responde en `LOCK_TIMEOUT` se salta. La lista la escribe un solo sitio
(`locales.escribirGrupo`) en todos los miembros, y las bases del grupo quedan
con AUTO_CLOSE apagado.

### Qué es de la empresa y qué es del equipo

| De la empresa (`userData/empresas/<base>/`) | Del equipo (`userData/`) |
|---|---|
| `device-config.json`: caja, cajón (con su pin), impresora, perfil | `db-config.json`: servidor y empresa activa |
| `cloud-config.json`: credencial de la nube | `install-config.json`: principal o secundaria |
| `payments-config.json`, `services-config.json`, `mp-config.json` | `license.json`: la licencia es del equipo |
| `backup-config.json`, documentos de compras, miniaturas | registros, red MultiCaja |

La base **de la instalación** (la primera, `Wybix_POS`) conserva sus archivos donde
siempre estuvieron: una instalación que no usa MultiEmpresa no mueve nada.
`electron/empresas/ambito.js` es el único que decide la ruta.

Así cada empresa abre **su** cajón: casi todas las impresoras de tickets tienen dos
salidas (pin 2 y pin 5), y cada empresa guarda el suyo.

### Cambiar de empresa: un ciclo de vida, no un parche

Un cambio de empresa es parar todo lo que pertenece a la empresa anterior y arrancarlo
con la nueva, **como unidad** (`electron/empresas/ciclo.js`):

1. **Parar** los servicios de la empresa, en orden inverso: nube, menú en línea,
   Club, avisos de WhatsApp, Local Host, respaldos, arriendo de la caja.
2. **Apuntar** la conexión a la otra base (`db.setConnectionConfig`).
3. **Preparar** la base: migraciones y objetos críticos, igual que al arrancar.
4. **Olvidar** lo memorizado de la anterior: configuración del negocio, módulos,
   política de aprobaciones, revisión de seguridad, licencia leída.
5. **Abrir sesión** en la nueva con el mismo usuario (ver abajo).
6. **Arrancar** los servicios y **volver a cargar la interfaz** desde su
   entrada (`cargarInterfaz`): el renderer empieza limpio. No es `reload()`:
   el router usa rutas con path sobre `file://` y recargar la ruta pide un
   archivo que no existe. Al cargar, el login ve que la ventana ya tiene
   sesión en el proceso principal y sigue al panel sin pedir la contraseña;
   una ventana nueva o una sesión cerrada no tienen sesión y la piden.

Cada servicio con estado se registra en el ciclo con `detener`/`iniciar`, y cada
caché con `olvidar`. Un servicio nuevo que guarda algo de la base se registra ahí;
la prueba `empresas-ciclo` falla si falta uno conocido.

Si el paso 3 falla, se vuelve a la empresa anterior: nunca queda la caja a medias.

### Quién cambia y con qué usuario

- Permiso **`EMPRESAS_CAMBIAR`**: por omisión solo administradores; se puede otorgar
  a un cajero (B&J Super, donde un mismo cajero cobra para las dos).
- Se entra con el **mismo usuario** (mismo nombre, activo) en la otra empresa, con los
  permisos que tiene **ahí**. Si no existe ahí, o ahí no puede cambiar de empresa
  (no podría volver), esa empresa no aparece en su selector y el canal la rechaza.
- Pedir cambios a una empresa de otra computadora exige administrar el negocio,
  aunque a un cajero se le haya otorgado cambiar de empresa.
- El turno de cada empresa es suyo: cambiar no cierra ni mezcla turnos.

### Alta de una empresa en esta computadora

Solo en la computadora que tiene SQL Server y por un administrador
(`electron/empresas/alta.js`):

1. Restaura la plantilla en una base nueva (`Wybix_POS_<Nombre>`) y la migra.
   La plantilla se copia antes a la carpeta de respaldos: RESTORE lo ejecuta
   el servicio de SQL Server con su propia cuenta, que no lee cualquier
   carpeta (falla con «RESTORE FILELIST is terminating abnormally»).
2. Da acceso a los mismos logins que operan la empresa actual: las cajas
   secundarias entran con el suyo.
3. `sp_setup_inicial` con el nombre, giro y RFC, y el **mismo usuario
   administrador**: su contraseña se copia como hash, nunca viaja en claro.
4. Escribe el grupo en todas las bases (la nueva primero) y les apaga AUTO_CLOSE.
5. Copia la configuración del equipo (impresora, cajón) y el horario de
   respaldo a la empresa nueva; nunca la caja, la nube ni Mercado Pago.

Si algo falla después de restaurar, la base a medias se borra.

### Respaldos y red

- El programador de respaldos respalda **todas** las empresas de esta
  computadora, cada una con su configuración, no solo la activa.
- Al encender MultiCaja, la cuenta de red de las secundarias recibe permiso en
  todas las empresas de esta computadora.

### Mis empresas

Ventas, tickets, utilidad bruta, efectivo en caja y turnos abiertos de cada empresa
lado a lado, con el total del grupo. Cada base responde su parte
(`sp_empresas_resumen`); las remotas, la nube.

## Fase 2 · Empresas en otra computadora (consulta)

Una empresa remota no se abre: se **consulta** por la nube con lo que su caja ya sube
(ventas, turnos, movimientos de efectivo, catálogo publicado).

- **Grupo en la nube** (`company_groups`, `company_group_members`): la caja principal
  de Birrialtlan genera un **código de enlace**; la de I Do Nut lo escribe y las dos
  empresas quedan en el mismo grupo. Igual que unir una sucursal con su código.
- `pos-sync` responde solo sobre empresas del grupo del equipo que pregunta.
- La pantalla dice **«Datos al 14:32»**: es la última sincronización, no el segundo.

## Fase 3 · Empresas en otra computadora (cambios)

Los cambios a una empresa remota no se escriben en su base: se dejan en una
**bandeja** en la nube (`company_group_commands`). La caja principal de destino los
aplica al sincronizar, con sus propios procedimientos y reglas, y responde si se
aplicaron o por qué no.

- Tipos permitidos: **alta de producto** y **cambio de precio**. Nada de dinero,
  existencias ni usuarios a distancia.
- Cada comando queda en la bitácora de la empresa de destino con quién y desde qué
  empresa lo pidió.
- Sin Internet en el destino, el cambio queda **pendiente** y se ve así en el origen.

## Pruebas

| Prueba | Qué asegura |
|---|---|
| `npm run test:empresas` (`scripts/pruebas/empresas.test.mjs`) | ámbito de archivos, ciclo (orden, detener aunque uno falle, registro completo en main.js), cambio con vuelta atrás, alta (nombre, borrado si falla, membresía), locales, remotas sin duplicar, bandeja, canales |
| `npm run db:test-empresas` (`scripts/db/pruebas/empresas.mjs`) | cuatro bases reales: grupo de 2, 3 y 4 visto desde cada una, usuarios activos e inactivos, resumen idéntico leído desde otra base, listas desactualizadas, pedidos de otra empresa (precio, alta, una sola vez, candados de MultiSucursal, bitácora) |
| `npm run e2e:empresas` (`e2e/empresas.spec.js`) | alta desde la pantalla, cambio con la pastilla, turno y cajón por empresa, Mis empresas, cambios recibidos, permisos del cajero |
| `wybix-owner`: `npm run test:grupos` (`scripts/probar-grupos.mjs`) | migración dos veces y sin permisos para anon, código de un uso, grupos aislados, resumen de hechos, catálogo, bandeja idempotente con reentrega, salir cancela lo pendiente |
