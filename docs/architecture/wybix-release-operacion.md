# Wybix — Operación, respaldo y recuperación

Cómo se reparte el trabajo entre las computadoras de una sucursal, qué se
respalda, qué no viaja en el respaldo y qué hace falta para levantar el negocio
en una máquina nueva.

Escrito para soporte, no para el compilador.

---

## 1. La forma de una sucursal

**Una base SQL Server por sucursal. N cajas en la misma red.**

```
        ┌──────────────────────────── HOST ────────────────────────────┐
        │  SQL Server Express local                                    │
        │  Hidromec_DataBase  (la base de la sucursal)                 │
        │  Wybix POS                                                   │
        └───────────────┬──────────────────────────────────────────────┘
                        │  LAN
          ┌─────────────┴─────────────┐
          │                           │
   ┌──────┴──────┐            ┌───────┴─────┐
   │ SECUNDARIA  │            │ SECUNDARIA  │
   │ Wybix POS   │            │ Wybix POS   │
   │ (sin SQL)   │            │ (sin SQL)   │
   └─────────────┘            └─────────────┘
```

El SQL Server local sigue siendo la autoridad transaccional. No hay una base
por caja, ni servicios intermedios, ni dependencia de internet para vender.

### Cómo sabe una caja qué es

Por el servidor que tiene configurado en `db-config.json`:

| `server` | Es |
|---|---|
| `localhost`, `127.0.0.1`, `.`, `(local)`, el nombre del propio equipo | **HOST** |
| una IP o el nombre de otra computadora | **SECUNDARIA** |

La regla vive en `electron/lib/host.js`, aparte y sin dependencias, y tiene su
propia prueba (`scripts/pruebas/host-secundaria.mjs`): acierta con instancias
con nombre (`EQUIPO\SQLEXPRESS`), con puerto (`localhost,1433`) y con
mayúsculas.

### Quién hace qué

| | HOST | SECUNDARIA |
|---|---|---|
| SQL Server | sí | no |
| Restaurar el template al instalar | sí | **no** |
| Aplicar migraciones | sí | no |
| Respaldo automático | sí | **no** |
| Exportar la base | sí | **no** |
| Provisionar el login de red | sí | no |
| Vender (Retail o Touch) | sí | sí |
| Periféricos propios (impresora, cajón, lector) | sí | sí |
| Pantalla de cliente propia | sí | sí |

Una caja de mostrador no tiene por qué poder respaldar ni restaurar la base de
toda la sucursal. Dárselo obligaría a concederle privilegios administrativos
sobre SQL Server sin ninguna ganancia.

---

## 1.b El motor SQL Server

Wybix instala **SQL Server 2019 Express** y, en toda instalacion nueva, le aplica
la actualizacion de seguridad aprobada antes de crear la base: el medio de
Microsoft es RTM de 2019 y dejarlo asi entregaria un motor sin parches a un
servicio que acepta conexiones de toda la LAN.

El contrato -medio base, parche aprobado y politica de builds- vive en
`installer/sql-servicing.json`. El detalle esta en
[wybix-sql-servicing.md](wybix-sql-servicing.md).

Solo el HOST instala o parchea el motor. Una caja secundaria nunca.

---

## 2. Respaldo

### Quién lo ordena y con qué permisos

`BACKUP DATABASE` exige `db_backupoperator`, `db_owner` o `sysadmin`. El login
de la aplicación (`ocus_app`) **no los tiene ni debe tenerlos**: solo hace
operaciones de negocio.

En el host, el respaldo se ordena con la **conexión de Windows** del usuario
que ejecuta Wybix, que en una instalación normal ya administra su SQL Express
local. Es el mismo mecanismo que `setupServer.js` usa para instalar y
restaurar. Nadie gana permisos nuevos.

En una caja secundaria el respaldo ni siquiera se intenta: se explica que lo
hace la computadora principal.

> Este era el origen del error **«BACKUP DATABASE is terminating abnormally»**:
> la aplicación pedía el respaldo con el login de negocio, que no puede
> respaldar. La solución no fue dar permisos de backup a todas las cajas.

### Dónde y cada cuánto

| | |
|---|---|
| Carpeta | `C:\POS_Backups` (configurable) |
| Copia externa | carpeta sincronizada opcional (OneDrive, Drive) |
| Nombre | `<base>_AAAAMMDD_HHMMSS.bak` |
| Hora | 23:00 por omisión |
| Al arrancar | si no hay respaldo de hoy, se hace en ese momento |
| Retención | 14 días, en ambas carpetas |

El catch-up al arranque existe porque una tienda cierra: si la computadora está
apagada a las 23:00, el respaldo se hace al abrir al día siguiente.

### Cuando falla

El error de SQL se traduce a algo accionable. «Terminating abnormally» no le
dice nada a nadie; casi siempre es una de estas tres cosas:

| Causa real | Lo que se muestra |
|---|---|
| El servicio de SQL no puede escribir en la carpeta | pide elegir una carpeta a la que ese servicio tenga acceso |
| La carpeta no existe para SQL Server | pide revisar la ruta |
| El usuario de Windows no puede respaldar | pide abrir Wybix con el usuario que administra SQL, o añadirlo a `db_backupoperator` |

El resultado queda en `backup-config.json` (`lastStatus`, `lastError`,
`lastBackupAt`), que es lo primero que hay que mirar en soporte.

---

## 3. Restauración y recuperación ante desastre

### El camino completo

```
  el host muere
      ↓
  computadora nueva con Windows
      ↓
  instalador de Wybix          → SQL Server Express + template
      ↓
  restaurar el último .bak     → encima de la base recién creada
      ↓
  configurar el dispositivo    → perfil, periféricos, caja
      ↓
  migraciones pendientes       → automáticas al arrancar
      ↓
  verificación de objetos      → el arranque se detiene si falta algo crítico
      ↓
  operar
```

### Qué NO viene dentro del respaldo SQL

El `.bak` trae el negocio: productos, ventas, clientes, inventario, recetas,
modificadores, usuarios, **y las fotos de producto**. Lo demás vive en cada
computadora y hay que rehacerlo:

| Elemento | Archivo | Clasificación | En una máquina nueva |
|---|---|---|---|
| Conexión a la base | `db-config.json` | **DEVICE-SPECIFIC + SECRET** | se rehace en el asistente; contiene la contraseña del login |
| Perfil del dispositivo, periféricos, caja asignada | `device-config.json` | **DEVICE-SPECIFIC** | se vuelve a elegir; **no** copiar entre máquinas: asignaría dos cajas al mismo registro |
| Licencia | `license.json` | **NECESARIO** | se reactiva con la clave del cliente |
| Configuración de respaldo | `backup-config.json` | **REGENERABLE** | valores por omisión razonables |
| Mercado Pago | `mp-config.json` | **SECRET** | se vuelve a configurar |
| Nube / facturación | `cloud-config.json`, fiscal | **SECRET** | se vuelven a configurar |
| Instalación (rol, servidor) | `install-config.json` | **DEVICE-SPECIFIC** | lo escribe el asistente |
| Miniaturas de producto | `thumbs/` | **REGENERABLE** | se reconstruyen solas desde SQL |
| Tickets PDF generados | carpeta de tickets | **REGENERABLE** | se vuelven a generar desde la venta |

**Por qué las fotos están en SQL y no en disco**: así viajan en el respaldo, las
ven todas las cajas de la sucursal y sobreviven a un cambio de computadora. La
carpeta `thumbs/` es solo una caché local descartable — borrarla y abrir el
Touch la reconstruye.

**Por qué no se mete todo lo demás en SQL**: `device-config.json` describe *esta*
computadora. Si viajara en el respaldo, restaurarlo en una máquina nueva le
daría los periféricos y el número de caja de la vieja. La separación es
deliberada.

---

## 4. Archivos de configuración

Todos viven en la carpeta de datos de la aplicación
(`%APPDATA%\<producto>\`).

| Archivo | Qué guarda | ¿Copiar entre máquinas? |
|---|---|---|
| `db-config.json` | servidor, base, usuario, contraseña cifrada | **No.** Cada caja apunta distinto y lleva su credencial |
| `device-config.json` | perfil (RETAIL_POS / TOUCH_POS / BACKOFFICE), impresora, cajón, lector, caja asignada, pantalla de cliente | **Nunca.** Dos cajas con el mismo `register.id` rompen el folio |
| `license.json` | licencia y equipo | No |
| `backup-config.json` | carpeta, hora, retención, último resultado | Da igual: se regenera |
| `install-config.json` | rol (principal/secundaria) y servidor | No |
| `mp-config.json`, `cloud-config.json` | credenciales de servicios | **No.** Son secretos |

Regla corta para soporte: **de esta carpeta no se copia nada de una computadora
a otra.** Se vuelve a configurar, que lleva menos tiempo que perseguir un folio
duplicado.

---

## 5. Módulos opcionales (preparación, sin implementar)

Hoy hay dos ejes:

- **Perfil de negocio** (`business_config.business_profile`): `RETAIL` o
  `HOSPITALITY`. Decide si existen recetas y modificadores. Vive en SQL: es del
  negocio, igual en todas las cajas.
- **Perfil de dispositivo** (`device-config.json`): `RETAIL_POS`, `TOUCH_POS`
  o `BACKOFFICE`. Vive en el equipo: dos cajas de la misma sucursal pueden
  tener perfiles distintos.

Falta un tercer eje para lo que se venda aparte —fidelización, por ejemplo—.
La forma correcta **no** es añadir una columna por módulo
(`loyalty_enabled`, `crm_enabled`, `delivery_enabled`...): cada módulo nuevo
exigiría una migración y el esquema se llenaría de banderas.

### La frontera propuesta

Una sola clave en `business_config`, con la lista de módulos activos:

```
enabled_modules   NVARCHAR(400) NULL     -- 'LOYALTY,DELIVERY'
```

`CapabilityService` ya carga el perfil de negocio y el del dispositivo al
arrancar y expone `capabilities()` como signal. Añadir un tercer campo es
natural: leer la lista, exponer `tieneModulo('LOYALTY')`, y nada más. No hace
falta un sistema de feature flags.

Con eso, un módulo futuro se comporta así:

| | Deshabilitado | Habilitado |
|---|---|---|
| Barra lateral | no aparece la entrada | aparece |
| Ruta | `canMatch` la rechaza: el chunk **no se descarga** | `loadComponent` trae el chunk |
| Lógica | no corre | corre |

El patrón ya está en uso: `/touch` y `/dashboard/recetas` se resuelven así
según los perfiles actuales. Un módulo opcional usaría el mismo mecanismo con
otra condición.

**No implementado en este release**: no hay columna `enabled_modules`, ni
tablas, ni procedimientos, ni pantallas. Esto documenta dónde encajaría para
que el día que se construya no haya que rediseñar el arranque.

---

## 6. Deuda congelada: los nombres `ocus`

`ocus_app` (login SQL), `ocus_app_full_role` (rol de base) y `ocusPassword` (la
clave que se teclea al instalar una caja secundaria) son **nombres viejos con
función vigente**: son el mecanismo multicaja actual, no restos de una
arquitectura muerta.

**Decisión: no se renombran en este release.**

El beneficio es de marca. El coste no:

- son un **login y un rol que ya existen dentro de las bases instaladas**;
- la contraseña está en el `db-config.json` de **cada caja**, incluidas las
  secundarias, a las que no siempre hay acceso remoto;
- las cajas de una sucursal no se actualizan a la vez: durante la transición
  habría cajas pidiendo `wybix_app` contra una base donde solo existe
  `ocus_app`, o al revés;
- una caja que no puede conectarse es una caja que no vende.

Cuando se haga, el camino seguro es **aditivo** y en este orden: crear
`wybix_app` junto al existente sin quitar el viejo → hacer que la aplicación
lea el nombre nuevo y caiga al viejo si no está → migrar el `db-config.json`
local al arrancar → cuando ninguna caja use el nombre viejo, retirarlo.

Hasta entonces, seguridad antes que limpieza estética.
