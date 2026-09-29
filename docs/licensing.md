# Licencias, suscripciones y entitlements

Cómo decide Wybix qué puede hacer un negocio, en qué estado queda cuando deja
de pagar y cómo se valida la licencia sin Internet. Es el documento de
referencia; [`licencia-y-demo.md`](licencia-y-demo.md) sigue explicando el
`machineId`, la huella y el aislamiento de la Demo, que no cambiaron.

Tres repositorios participan:

| Dónde | Qué hace |
| --- | --- |
| **wybix-owner** (Supabase) | Fuente de verdad: catálogo, licencias, giros, suscripciones, compras, eventos. **Firma** los certificados. |
| **wybix-landing** (web) | Vende (checkout), emite la licencia inicial, publica precios y la página `/licencia` para descargar el archivo offline. |
| **Este repo** (POS) | Verifica el certificado con la clave pública, calcula el estado sin red y **aplica** los entitlements en el proceso principal y en el Local Host. |

---

## 1. El modelo comercial

Una licencia es la suma de piezas independientes:

```
licencia = edición (MonoCaja | MultiCaja)
         + 1..3 giros (COMMERCE, HOSPITALITY, SERVICES)
         + cuota de Pantallas Operativas por giro (3 | 10 | ilimitadas)
         + suscripción (primer año incluido; después MONTHLY o ANNUAL)
         + soporte (BASIC el primer año; PRIORITY opcional)
         + complementos (MULTIBRANCH, preparado; no disponible)
```

| Código | Nombre comercial | Qué incluye |
| --- | --- | --- |
| `EDITION_MONO` | MonoCaja | 1 caja que vende y cobra. **$2,499** compra inicial, sin IVA. |
| `EDITION_MULTI` | MultiCaja | Cajas **ilimitadas** en el mismo negocio (`registers_max = NULL`, nunca 9999). **$3,999**. |
| `VERTICAL_COMMERCE` | Para Comercios | Venta con código, inventario, compras, proveedores. |
| `VERTICAL_HOSPITALITY` | Para Restaurantes y Cafeterías | Mesas, cuentas, comandas, cocina, recetas, modificadores. |
| `VERTICAL_SERVICES` | Para Negocios de Servicios | Agenda, citas, profesionales, órdenes, técnicos. **Un solo precio** para todos los servicios. |
| `SCREENS_BASE` / `_EXTENDED` / `_UNLIMITED` | Pantallas Operativas | 3 (incluidas), 10 o ilimitadas **por giro**. |
| `SUBSCRIPTION_MONTHLY` / `_ANNUAL` | Suscripción | Mismas funciones; la anual cuesta menos. |
| `SUPPORT_BASIC` / `_PRIORITY` | Soporte | BASIC incluido el primer año; PRIORITY $690. |
| `ADDON_MULTIBRANCH` | MultiSucursal | Complemento futuro. Solo existe en el catálogo. |

**Fuente única: `license_catalog` en Supabase.** Código de producto, edición,
giro, periodo de cobro, precio de lista, activo/inactivo y entitlements viven
solo ahí.

- **Cobro:** `license_quote()` valida el cobro en el servidor.
- **Checkout:** cotiza con `/api/license/quote` **antes** de pagar y cobra
  en PayPal ese total. Si el catálogo no responde, no ofrece pagar.
- **Web:** genera su copia de lectura al compilar
  (`scripts/catalogo.mjs` → `catalogo.generado.json`, ignorado por git).
  Con ella llena también los precios de `index.html` (meta y schema.org).
- **Asistente:** lo lee en vivo; sin catálogo no da cifras.

**Cambiar un precio no es una migración.** Es un dato comercial:

- se hace con `license_catalog_update(código, cambios, motivo, autor)`, solo
  desde el backend privilegiado;
- queda en `license_catalog_price_history` (precio anterior y nuevo,
  moneda, desde cuándo, quién y por qué), escrito por un trigger al que
  ningún cambio se escapa;
- `license_catalog_price_periods` dice qué precio tuvo cada producto y
  entre qué fechas;
- las compras pasadas no cambian: cada `license_purchases` guarda su precio
  de lista, su descuento, lo pagado y la moneda.

Las migraciones quedan para el esquema, los seeds iniciales y los cambios
estructurales.

Detalle en `wybix-owner/docs/licenciamiento-despliegue.md`.

**Precios.** Solo los que la web ya cobraba: $2,499, $3,999, soporte
prioritario $690, app adicional, timbres y capacitación. Siguen en `NULL`,
«por anunciar» y **no se pueden cobrar**: giro adicional, 10 pantallas o
pantallas ilimitadas, y suscripción mensual o anual. No se inventó ningún
precio.

**Híbridos.** Un negocio puede tener varios giros (`license_verticals`). Agregar
uno (`license_add_vertical`) o pasar de MonoCaja a MultiCaja
(`license_upgrade_to_multi`) registra una compra por la **diferencia**; la
fecha del primer año no se mueve.

**El primer año** empieza en la **primera activación**, no en la compra
(`licenses.first_activated_at`, fijada una sola vez por `license_activate`). La
suscripción `INCLUDED` es única por licencia (índice parcial).

---

## 2. Estados de la licencia

Los calcula [`electron/licencia/estado.js`](../electron/licencia/estado.js) a
partir **solo** del certificado firmado y del reloj. No hay eventos: el mismo
cálculo da lo mismo en línea y sin red.

| Estado | Cuándo | Qué funciona |
| --- | --- | --- |
| `TRIAL` | Prueba de 30 días vigente | MonoCaja + **el giro elegido en el alta** + 3 Pantallas Operativas de ese giro. Antes de elegirlo, solo lo de la edición. Nunca los tres. |
| `EXPIRED` | Terminó la **prueba** sin compra | Pide activar una licencia (el comportamiento de siempre). |
| `ACTIVE` | `ahora ≤ paid_until` | Todo lo contratado. |
| `GRACE` | `paid_until < ahora ≤ grace_until` (45 días) | Todo lo contratado, con aviso de renovación. |
| `SALE_ONLY` | Pasó la gracia, **o** el certificado lleva más de 45 días sin validarse | **Modo Venta Esencial.** |
| `DEMO` | Instancia del gestor de demos | Todo. |
| `TAMPER` | Firma inválida, otro equipo, clave desconocida o revocada, **o licencia sin firma** (formato anterior, motivo `sin-firma`) | Bloquea con un mensaje claro. Con `sin-firma`: «Esta licencia necesita actualizarse.», con «Actualizar licencia» (refresco en línea), «Importar archivo» o activar la clave. Se puede refrescar: decide el servidor. |

**Certificado firmado obligatorio.** El runtime razona sobre `TRIAL`,
`ACTIVE`, `GRACE` y `SALE_ONLY`, más los administrativos `EXPIRED`,
`TAMPER`, `NONE` y `DEMO`. No existe un estado ni una gracia para el
formato sin firma: ese formato se podía fabricar, y solo lo usaban pruebas
internas, que se reemiten firmadas. `sp-register-sale` exige el
entitlement `sales` **en el backend**, así que una licencia rechazada no
vende aunque se llame el canal a mano.

`DEMO` es solo la instancia del **gestor de demos**: interna, aislada
(`userData-demo`, base con `is_demo`) y fuera del instalador público. No
es la prueba pública ni una licencia QA, y no usa licencias comerciales.

**Origen de cada licencia** (backend, `licenses.origin`):

- `PRODUCTION`: venta real;
- `INTERNAL`: uso de Wybix;
- `QA`: equipos de pruebas en uso, con permisos explícitos por
  `license_qa_grant`, que rechaza una licencia comercial;
- `TEST`: sandbox o pruebas, candidatas a cancelar.

Solo `PRODUCTION` entra en métricas comerciales
(`license_commercial_*`). El certificado lleva `origin` y el panel dice
«licencia de pruebas».

### La prueba gratuita es de UN giro

1. El License Gate inicia la prueba (`trial-license start`). Llega un
   certificado `TRIAL` sin giro.
2. En el alta del negocio (`setup-inicial`), el tipo de negocio elegido se
   **pide** como giro de evaluación: `license:trial-vertical` →
   `trial-license select_vertical`.
3. El servidor responde el certificado con ese giro: 30 días de MonoCaja y
   3 pantallas de ese giro.
4. Sin red, el giro queda pendiente y se manda en el siguiente refresco.

`business_profile` no otorga nada: lo que vale es el certificado. Cambiar el
giro de evaluación queda preparado en el servidor (uno a la vez, sin mover
fechas, con historial).

### Validación periódica: 45 días

Wybix **no requiere Internet permanente**, pero la licencia **sí se valida
periódicamente**. Ejemplo: suscripción anual pagada hasta 2027-10-01, última
validación 2026-10-01 a las 12:00 y sin Internet desde entonces.

| Momento | Estado | Qué ve | Qué puede hacer |
| --- | --- | --- | --- |
| Día 1 a 35 | `ACTIVE` | Nada especial | Todo |
| Día 36 a 44 | `ACTIVE` + `refrescarEnDias` | «Valida tu licencia pronto» (día 44: «en el próximo día») e importar archivo | Todo |
| Día 45 (hasta las 12:00) | `ACTIVE` | Igual | Todo |
| Día 46 | `SALE_ONLY` · `SIN_VALIDAR` | «Tu licencia necesita validarse. Wybix sigue vendiendo» + importar archivo | Vender, cobrar, ticket, turno, reportes, exportar, respaldar. Inventario, compras, mesas, cocina, servicios y pantallas esperan. `paid_until` sigue siendo 2027-10-01. |

**Refrescar con archivo.** En otro equipo, en `/licencia`, se descarga el
`.wybix-license` y se importa en Configuración → Licencia.

- El archivo lo firma el servidor en ese momento. Renueva la validación
  (`issued_at`, `valid_until` = descarga + 45 días) y **no** cambia
  `paid_until`, que viene firmado del servidor. Editarlo rompe la firma.
- El POS nunca calcula `paid_until`.
- Descargar el archivo no modifica periodos en el servidor, solo registra
  `CERTIFICATE_DOWNLOADED`.
- Los 45 días cuentan desde la **descarga**: un archivo bajado el día 40 e
  importado el 50 vale hasta el día 85.
- Al volver de `SALE_ONLY` queda el aviso de revisar el inventario.

Todo esto está probado con estas fechas en `test:licencia-v2`, bloque
«Validación periódica».

### Modo Venta Esencial

Quien pagó y dejó de pagar **nunca** queda bloqueado. Sigue funcionando:
vender, cobrar, imprimir ticket, abrir y cerrar turno, consultar clientes y
reportes, exportar, respaldar, facturar y renovar
(`EN_VENTA_ESENCIAL` en `entitlements.js`).

Espera a la renovación: inventario operativo, compras, proveedores, lealtad,
sincronización con la nube, módulos de giro (mesas, cocina, servicios) y las
Pantallas Operativas.

La venta en este modo:

- **No modifica productos**: no se crean ni se editan desde la caja.
- **No descuenta ni bloquea por stock**. `sp_register_sale` recibe
  `@venta_esencial = 1`, que pone **el proceso principal** a partir de la
  licencia; el renderer no puede mandarlo. La venta queda marcada en
  `sales.venta_esencial`.
- **Solo vende lo comercialmente vendible.** En Venta Esencial,
  `sp_register_sale` rechaza un producto con `sellable = 0` aunque se llame el
  canal a mano. Fuera de este modo no cambia nada: una orden de servicio puede
  cobrar una refacción que no se vende en mostrador, y en Venta Esencial
  Servicios está en pausa.
- Al renovar, el POS muestra un aviso con el periodo sin control de
  inventario. `sp_venta_esencial_resumen` lista lo vendido en ese periodo para
  revisar existencias. **No** se ajusta nada automáticamente, y en particular
  nunca `UPDATE productos SET vendible = 1`.

**Matriz probada** (`test:licencia-integracion`, bloque M, contra SQL Server
real):

| Modo de inventario | Vendible | Existencia | En Venta Esencial |
| --- | --- | --- | --- |
| DIRECT | sí | 5 / 0 | Se vende; no descuenta; sin movimientos |
| DIRECT | no | 5 / 0 | No se vende; no aparece en el menú |
| RECIPE | sí | ingrediente 5 / 0 | Se vende; no descuenta el ingrediente; sin movimientos |
| RECIPE | no | ingrediente 5 / 0 | No se vende |
| NONE | sí | 5 / 0 | Se vende; sin movimientos |
| NONE | no | 5 / 0 | No se vende |

Después de las 12 combinaciones:

- no cambia ni `inventory_mode`, ni `sellable`, ni recetas, ni existencias;
- al volver a `ACTIVE`, DIRECT descuenta su existencia, RECIPE descuenta el
  ingrediente y NONE no lleva inventario;
- sin existencia vuelve a no venderse.

---

## 3. El certificado firmado

Antes la licencia era un JSON con HMAC cuya clave estaba en el propio POS:
cualquiera podía fabricar una. Ahora el servidor **firma** y el POS solo
**verifica**.

```jsonc
// archivo .wybix-license / respuesta de license-check
{
  "format": "wybix-license",
  "v": 1,
  "kid": "wybix-lic-1",          // qué clave pública la verifica
  "payload": "<base64url(JSON)>",
  "sig": "<base64url(ES256, ieee-p1363)>"   // firma de la cadena payload
}
```

El payload lleva: `license_id`, `machine_id`, `kind` (TRIAL | PAID), `edition`,
`registers_max`, `verticals`, `screens` por giro, `entitlements` ya resueltos
desde el catálogo, `addons`, `first_activated_at`, `paid_until`, `grace_until`,
`trial_ends_at`, `issued_at`, `valid_until` y la política usada.

- **Algoritmo:** ES256 (ECDSA P-256).
- **Clave privada de producción:** solo en el gestor de secretos de Supabase
  (`LICENSE_SIGNING_KEY`), con respaldo en el gestor de contraseñas de la
  empresa. Nunca en un repositorio, Electron, Angular, el asar ni la web.
  Se genera en una ceremonia fuera del repo.
- **Claves públicas:** [`electron/licencia/llaves-publicas.js`](../electron/licencia/llaves-publicas.js).
  - `PRODUCCION` es lo único en lo que confía el instalador.
  - `PRODUCCION` está **vacío hasta la ceremonia**.
  - `npm run dist`, `pack` y `publish` se detienen sin una clave de
    producción (`scripts/verificar-llaves-licencia.mjs`).
  - `DESARROLLO` (`wybix-dev-1`, la clave de `.secrets/`) solo se usa sin
    empaquetar.
- **KID:** `LICENSE_SIGNING_KID` es obligatorio. El servidor se autocomprueba
  (su privada contra `LICENSE_PUBLIC_KEYS[KID]`) antes de firmar.
- **Rotación:** KID 1 y KID 2 conviven. Los certificados existentes siguen
  verificando y los nuevos se firman con 2.
- **Revocación:** `LICENSE_REVOKED_KIDS` viaja como `revoked_kids` en cada
  certificado nuevo.
  - El POS lo guarda en `licencia-kids-revocados.json`, **aparte de la
    licencia** (`electron/licencia/revocaciones.js`), y la lista solo
    crece.
  - Ni liberar el equipo ni importar un archivo viejo «des-revocan».
  - Una versión puede traer KIDs revocados de fábrica (`REVOCADAS`).
- **Cómo conoce el POS un KID nuevo: solo actualizándose.** Las públicas son
  las de su versión. Por eso, antes de firmar con KID 2:
  1. publicar un POS que confíe en KID 1 + KID 2;
  2. esperar la adopción;
  3. cambiar el firmante a KID 2;
  4. seguir aceptando KID 1;
  5. retirarlo después.

  Un keyset firmado por una raíz Wybix (KIDs dinámicos sin actualizar el
  POS) queda documentado como mejora futura, sin implementar.

  El procedimiento completo (generación, respaldo, rotación, compromiso y
  retiro) está en `wybix-owner/docs/licenciamiento-despliegue.md`.
- **Política única:** `wybix-owner/supabase/functions/_shared/politica.ts`
  (30 días de prueba, 45 de gracia, 45 sin validar). El servidor la escribe en
  cada certificado; el POS no tiene esos números.

### Reloj

Se usa `max(reloj, última hora vista, issued_at)`. Atrasar Windows no devuelve
días. Adelantarlo solo adelanta avisos. Si el reloj va muy por detrás se marca
`relojAtrasado`, pero no se bloquea la venta.

### Sin Internet

La venta nunca espera a la red. El certificado se refresca en segundo plano
(`validate`). Si una caja no tiene Internet:

1. En otro dispositivo, en `https://wybix-landing.vercel.app/licencia`, se
   escriben la clave y el código del equipo (Configuración → Licencia).
2. Se descarga `mi-negocio.wybix-license` y se lleva por USB.
3. En Configuración → Licencia → **Importar archivo de licencia**.

`importar()` rechaza un archivo editado, de otro equipo o más viejo que el
actual. La licencia vigente queda intacta.

### Cambio de computadora

Es ilimitado. `license_release` exige prueba (el certificado de esa máquina o
la clave de licencia); antes bastaba conocer el `machineId`. Cada cambio queda
en `license_events`.

---

## 4. Entitlements en el POS

[`electron/licencia/entitlements.js`](../electron/licencia/entitlements.js)
separa tres preguntas:

| | Pregunta | Dónde |
| --- | --- | --- |
| **Capability** | ¿Wybix tiene la función y está encendida? | `CapabilityService`, `sp_get_business_modules` |
| **Entitlement** | ¿El cliente tiene derecho a usarla? | certificado + `entitlements.js` |
| **Permission** | ¿Esta persona puede usarla? | `seguridad/canales.js`, `AuthService.puede` |

```
disponible = capability && entitlement && estado de la licencia && permiso
```

**El cumplimiento está en el backend, no en la UI:**

- `sesion.comprobar` (canal IPC) consulta `permiteCanal(canal, paquete, modulo)`
  antes del permiso. Una función oculta en la interfaz sigue protegida si se
  invoca a mano.
- El **Local Host** valida la licencia al emparejar y al atender cada Pantalla
  Operativa ([`local-host/licencia-pantallas.js`](../electron/local-host/licencia-pantallas.js)).
- `sp_register_sale` aplica la Venta Esencial en SQL.

En Angular, `LicenseService` expone el estado. `CapabilityService` y
`NavegacionService.areas()` ocultan lo que el entitlement no cubre. Esto es
solo presentación.

### Pantallas Operativas

| Pantalla | Entitlement | Giro cuya cuota consume |
| --- | --- | --- |
| Preparación / KDS | `operational.preparation` | HOSPITALITY |
| Mesero | `operational.waiter` | HOSPITALITY |
| Estado de pedidos | `operational.customer_status` | HOSPITALITY |
| Jornada del personal | `operational.staff_day` | SERVICES |
| Técnico | `operational.technician` | SERVICES |
| Inventario de piso | `operational.inventory_floor` | COMMERCE, o el primer giro de la licencia |

La cuota cuenta dispositivos vivos **más** códigos QR pendientes. Reasignar
una pantalla a otro tipo mueve su consumo de cuota. Al llegar al límite se
rechaza lo nuevo; nunca se desconecta un dispositivo que ya trabajaba. En
Venta Esencial las pantallas emparejadas conservan su emparejamiento pero
dejan de atender (el servidor responde 409 «vuelven al renovar»).

---

## 5. Backend (wybix-owner)

Migraciones, en orden (expandir → contraer):

1. `20260926120000_licenciamiento_v2.sql`: **PARTE A**, la transición.
   - Tablas nuevas: `license_catalog`, `license_verticals`,
     `license_purchases`, `license_subscriptions`, `license_code_changes`,
     `license_events`.
   - Evoluciona `licenses`: `first_activated_at`, `support_tier`, `addons` y
     `origin` (PRODUCTION / INTERNAL / TEST; NULL = sin clasificar).
   - **No toca `max_registers`**: la web y el `license-check` anteriores siguen
     funcionando. Las cajas salen de la edición (`license_registers_max`).
   - No reparte giros a las licencias existentes: quedan en
     `license_review_queue`.
   - Funciones `security definer`, ejecutables solo por `service_role`:
     `license_activate` (atómica con `FOR UPDATE`), `license_release`,
     `license_for_machine`, `license_runtime`, `license_renew`,
     `license_add_vertical`, `license_upgrade_to_multi`,
     `license_set_screen_tier`, `license_register_code_change`,
     `license_quote`, `license_create_from_order`, `license_trial_grants` y
     `license_trial_select_vertical`.
   - RLS activado y `revoke` a `anon` y `authenticated` en todas.
   - `revoke all` a `anon`/`authenticated` en las tablas de licencias (tenían
     `TRUNCATE`, que RLS no detiene).
   - Excepción deliberada: el catálogo **activo** se puede leer en público
     (precios de lista y descripciones), solo lectura.
2. `20260926130000_pos_sync_sin_service_role.sql`
   - Token de sincronización por sucursal; solo se guarda su hash.
3. `20260927120000_licenciamiento_v2_final.sql`: **PARTE B**.
   - MultiCaja = NULL y restricciones edición/cajas.
   - Solo después de desplegar y verificar las funciones y la web nuevas.

Edge Functions:

| Función | Acciones |
| --- | --- |
| `license-check` | `activate`, `validate`, `release`, `certificate` |
| `trial-license` | Prueba de 30 días con certificado |
| `pos-sync` | Sincronización del POS con token por sucursal, sin service role |

**Soporte y adaptaciones.** El primer año incluye soporte BASIC y hasta 3
adaptaciones. `license_code_changes` tiene tres tipos:

| Tipo | Qué es | ¿Consume adaptación? |
| --- | --- | --- |
| `CUSTOMIZATION` | Adaptación a la medida | Sí |
| `BUG_FIX` | Error de Wybix | Nunca: un bug no es soporte |
| `IMPLEMENTATION` | Puesta en marcha | No. Si exige código a la medida, ese cambio se registra aparte como `CUSTOMIZATION` |

`included_code_changes`, `used_code_changes` y `remaining_code_changes` viven
solo en `licenses` y en `license_support_summary`, que no son públicas. **No**
están en `license_runtime` ni en el certificado. Lo prueban las pruebas A08 y
P03 (SQL) y `probar-certificado`.

**Descuentos.** `license_purchases` guarda precio de lista, descuento, motivo
y quién lo autorizó. No hay precios sueltos en código.

---

## 6. Despliegue

El orden completo, con cómo volver atrás, está en
`wybix-owner/docs/licenciamiento-despliegue.md`. En resumen:

1. Ceremonia de la clave de producción. Secretos en Supabase. La pública se
   pega en `PRODUCCION`.
2. **PARTE A.**
3. Desplegar `license-check`, `trial-license` y `pos-sync`.
4. Web nueva. Vercel necesita `SUPABASE_URL` y `SUPABASE_ANON_KEY` al compilar.
   Verificarla.
5. POS nuevo.
6. **PARTE B**, cuando ya no quedan emisiones de la web anterior.
7. Rotar el JWT secret del proyecto cuando todos los POS estén actualizados.
8. Clasificar y reemitir las 7 licencias existentes con el script revisado
   `supabase/data/2026-09-26_clasificar-licencias-existentes.sql`:
   - 2 QA con permisos explícitos, que reciben V2 firmado al refrescar;
   - 1 INTERNAL;
   - 4 TEST candidatas a cancelar.

   No borra nada. Va antes de publicar el POS, que ya no acepta licencias
   sin firma.

**Antes de producción: QA manual en staging.** Ver
[`licensing-staging-qa.md`](licensing-staging-qa.md): pasos A–T, **STAGING
REQUIRED**.

---

## 7. Pruebas

| Comando | Qué cubre |
| --- | --- |
| `npm run test:licencia-v2` | Firma, estados, reloj, entitlements, canales, cuota de pantallas, importación, validación periódica de 45 días (fechas exactas), rotación y revocación monotónica de KID, licencia sin firma rechazada, producción/QA/desarrollo, prueba de un giro. |
| `npm run test:licencia-integracion` | Electron + SQL: Venta Esencial en `sp_register_sale`, matriz DIRECT/RECIPE/NONE × vendible × existencia, SALE_ONLY → ACTIVE, Local Host. |
| `npm run test:licencia` | Huella, almacén y aislamiento de la Demo (sin cambios). `test:trial` se eliminó con el sellado del formato sin firma. |
| `wybix-owner`: `node scripts/probar-licenciamiento.mjs` | PARTE A y B sobre copia de producción, catálogo, historial de precios, compras que no cambian, cotización, emisión desde la orden, licencias QA, prueba de un giro, soporte, RLS, el **rollout por HTTP** (web anterior y nueva, cotización antes de pagar) y la clasificación y reemisión de las 7. |
| `wybix-owner`: `node scripts/probar-certificado.mjs` | Firma en Deno y verificación en Node, KID obligatorio, autocomprobación, rotación y revocación. |

---

## 8. Pendiente

- **Precios** de giro adicional, pantallas extendidas o ilimitadas y
  suscripción mensual o anual. Cuando se decidan:
  - se ponen con `license_catalog_update`, con motivo y autor;
  - el cobro los toma de inmediato;
  - la página y el SEO, en la siguiente compilación de la web.
- **Panel de administración de precios:** la función existe; falta la
  pantalla, con su propia autenticación.
- **Versión del POS al refrescar:** hoy no se reporta; serviría para medir la
  adopción antes de rotar un KID.
- **QA manual en staging** (`licensing-staging-qa.md`).
- **Clave de producción**: la ceremonia (sin ella no se construye el
  instalador).
- **Flujo de compra de renovación** (mensual o anual) y **cobro automático**.
  Hoy la renovación es por WhatsApp y `license_renew` la registra.
- **Portal del cliente**: ver licencia, equipos y desvincular.
- **MultiSucursal**: está en el catálogo y en el modelo (`addons`), sin
  funcionalidad.
- **Manual PDF 11 «Multicaja y sucursales»**: todavía dice que MultiCaja
  incluye sucursales.
