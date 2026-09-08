# Wybix Core — Architecture Decision Log

Decisiones tomadas durante la implementación de **Wybix Core / Touch /
Hospitality**. Solo decisiones que cambian la forma del producto; el detalle
de cada cambio está en el código y en `sql/`.

Formato: **Problema · Alternativas · Decisión · Motivo · Consecuencia**.

---

## ADR-001 · Lazy loading por experiencia (Gate 0)

**Problema.** Las 19 rutas se importaban de forma estática en `app.routes.ts`
y los 19 paneles de Configuración se referenciaban directamente desde
`config-tiles.ts`. Resultado: `main.js` de 3.49 MB, bundle inicial de 3.94 MB,
cero `loadComponent`. No había sitio para una segunda experiencia (Touch) sin
empeorar el arranque de todas las cajas.

**Alternativas.**
1. `loadChildren` con un módulo de rutas por área.
2. `loadComponent` por ruta, manteniendo standalone.
3. Dejarlo y subir el budget.

**Decisión.** `loadComponent` por ruta (2). Solo `Login` viaja en el bundle
inicial. Los paneles de Configuración pasan de `component: Type` a
`load: () => import(...)` y `ConfigShell` los resuelve al abrir el mosaico.
Las pantallas de licencia y el asistente inicial se envuelven en `@defer`.
`ReportService` importa `xlsx-js-style` y `jspdf` dentro del método que los usa.

**Motivo.** Es el cambio con mejor relación reducción/riesgo: no cambia
framework ni estructura de componentes, y separa de forma natural las
experiencias (Retail = `venta`, Backoffice = inventario/compras/estadísticas,
Touch = su propio chunk cuando exista). Una caja Retail nunca descarga Touch.

**Consecuencia.** Bundle inicial 3.94 MB → **784 kB** (raw). `main.js`
3.49 MB → 14.8 kB. Cada pantalla es un chunk (venta 113 kB, inventario 78 kB…).
Budget de `angular.json` bajado a 1 MB warning / 1.5 MB error para que una
regresión no pase desapercibida. Nuevas rutas **deben** usar `loadComponent`.

---

## ADR-002 · PDF con el Chromium de Electron, no con Puppeteer (Gate 0)

**Problema.** Ticket 80 mm, venta A4 y reporte de ventas generaban el PDF con
Puppeteer, es decir, un **segundo Chromium**. En la máquina de desarrollo
ocupa 1.2 GB en `~/.cache/puppeteer`; en una caja de cliente ese navegador no
existe (Puppeteer no lo descarga en tiempo de ejecución), así que la función
dependía de que alguien lo instalara a mano. `printToPdfElectron.js` existía
pero estaba vacío.

**Alternativas.**
1. Mantener Puppeteer y empaquetar Chromium en el instalador.
2. `webContents.printToPDF` en una `BrowserWindow` oculta.
3. Generar PDF sin navegador (pdfkit): reescribir las tres plantillas.

**Decisión.** (2). `electron/pdf/printToPdfElectron.js` implementa
`htmlToPdf(html, { outPath, pageSize, marginsMm, ... })`: ventana invisible,
sandbox, sin preload, carga el HTML desde un archivo temporal, espera fuentes
e imágenes, imprime y se destruye. Los tres generadores lo consumen. Puppeteer
sale de `package.json`.

**Motivo.** Mismo motor de render → misma salida; cero dependencias externas;
funciona offline; menos memoria (no hay proceso extra); el instalador no carga
`node_modules/puppeteer*`. El ticket conserva el tamaño anterior
(80 mm × alto carta, que era el alto implícito de Puppeteer).

**Consecuencia.** Probado bajo el binario de Electron con un script que usa
la plantilla real del ticket: ticket 80 mm, A4 con márgenes y seis documentos
seguidos generan `%PDF` válidos en 160–700 ms cada uno. Dos hallazgos en la
prueba: `loadFile` deja barras invertidas en la URL en Windows (se usa
`pathToFileURL`), y una app sin otra ventana abierta se cierra al destruir la
ventana oculta (`window-all-closed`); Wybix siempre tiene `mainWindow`, así
que no aplica, pero el script de prueba lo documenta. `pdfkit` (solo un
`require` muerto en `preload.js`), `chart.js` y `ng2-charts` (sin ningún
import en `src/` ni `electron/`) también se retiran tras verificar uso real
con `grep`.

---

## ADR-003 · Wybix Core: un carrito, un camino de venta (Gate 1)

**Problema.** `venta.ts` (2 026 líneas) era a la vez UI, carrito, cálculo de
totales, registro de venta, turno, catálogo y pantalla de cliente, con 40
llamadas directas a `electronAPI`. Construir Touch sobre eso obligaba a copiar
la pantalla o a bifurcar en `retailRegisterSale()` / `touchRegisterSale()`.

**Alternativas.**
1. Refactor total de los 53 archivos que usan `electronAPI` (fachada completa).
2. Strangler: extraer solo la ruta compartida Retail ↔ Touch y dejar el resto
   (corte, tabla de ventas, backoffice) tocando `electronAPI` como hoy.
3. Duplicar la pantalla para Touch.

**Decisión.** (2). `src/core/` con `CartService`, `SaleService`,
`CatalogService`, `ShiftService`, `CapabilityService`,
`CustomerDisplayService` y `ElectronBridge`. Retail se migró **antes** de
escribir Touch; Touch consumirá exactamente los mismos servicios.

- `CartService` es el único propietario del carrito: líneas, cantidades,
  opciones (vacías en Retail), totales, cuentas en espera (aparcar/recuperar)
  y un carrito *transitorio* para la venta cargada por folio. Vive en memoria
  en la raíz: las cuentas sobreviven a la navegación dentro de la sesión y no
  se persisten a disco (V1).
- `SaleService.checkout()` es el único punto que registra una venta. Valida,
  traduce el carrito a `SaleIntent` (que ya transporta `options` y
  `serviceMode` para el contrato V2), llama al IPC actual y **después** del
  COMMIT ejecuta cajón, pantalla de cliente e impresión. Ningún dispositivo
  participa antes de que SQL confirme.
- `CustomerDisplayService` observa el carrito y empuja el estado; `venta.ts`
  ya no conoce esa ventana. Ráfagas de escaneo se coalescen en un IPC.
- `ShiftService` concentra turno abierto, apertura y salidas de efectivo.
- `CatalogService` cachea `sp_get_active_products`, busca por código/parte y
  se invalida al vender.

**Motivo.** Es la única forma de cumplir "Retail y Touch comparten la misma
transacción de venta" sin reescribir Backoffice. La pantalla Retail conserva
sus nombres de miembros (`items`, `totalVenta`, `saleTabs`…) como *getters*
sobre el Core, así que la plantilla apenas cambió.

**Consecuencia.** Verificado con un `electronAPI` simulado en el navegador:
efectivo (contrato `registerSale(1,'EFECTIVO',[…],null,null,3)` idéntico al
anterior, cajón, `checkout` en pantalla de cliente con pagado/cambio, ticket
silencioso, carrito limpio, conceptos para factura), crédito (cliente,
vencimiento, sin cajón ni ticket), cuentas en espera, scanner, atajo `+`,
carga por folio en carrito transitorio y restauración de la cuenta activa.
Tres correcciones colaterales, deliberadas: el cobro con terminal Mercado
Pago ahora envía `register_id` (antes iba sin caja y caía en la primera); el
listener del scanner se libera al salir de Ventas (antes se apilaba uno por
visita); y el locale `es-MX` se registra en `main.ts` (antes dependía de que
Compras se hubiera cargado, lo que el lazy loading rompía).

---

## ADR-004 · Business Profile en SQL, Device Profile local (Gate 2)

**Problema.** Hacía falta decidir qué es "un negocio Hospitality" y qué es
"una caja Touch" sin mezclar ambas cosas ni crear dos fuentes redundantes
(`business_profile = HOSPITALITY` + `hospitality_enabled = 0`).

**Alternativas.**
1. `RETAIL | HOSPITALITY | HYBRID` (propuesta del discovery).
2. `RETAIL | HOSPITALITY`, donde HOSPITALITY ya vende DIRECT, RECIPE y NONE.
3. Un flag booleano por capacidad.

**Decisión.** (2). `business_config.business_profile NVARCHAR(20) NOT NULL
DEFAULT 'RETAIL'` con CHECK (`RETAIL` | `HOSPITALITY`). Es la única fuente
de la capacidad; `CapabilityService` deriva `hospitality = profile ===
'HOSPITALITY'`. El perfil del dispositivo (`BACKOFFICE | RETAIL_POS |
TOUCH_POS`) vive en `device-config.json` bajo `deviceProfile`; cambiarlo es
una escritura local y la experiencia cargada, sin reinstalar ni tocar la
base. La pantalla de cliente sigue siendo una capacidad del dispositivo
(`customerDisplay.enabled`), no un perfil.

**Motivo.** HYBRID no aporta ninguna capacidad distinta: un negocio
HOSPITALITY que también vende refrescos simplemente tiene productos DIRECT.
Un booleano por capacidad multiplicaría combinaciones sin sentido. Y el
perfil del dispositivo tiene que ser local porque dos cajas de la misma
sucursal pueden ser una Retail y otra Touch sobre la misma base.

**Consecuencia.** Migración `0001_business-profile.sql` (primera productiva
sobre Baseline V1): añade `business_profile`, `ticket_footer` (la app lo
enviaba y `sp_update_business_config` lo rechazaba: "Datos del negocio" no
guardaba) y el CHECK; actualiza el SP. Probada con `db:test-migration`,
`db:test-rebuild` + `db:compare-schema` (0 tablas distintas entre migrar y
reconstruir desde canónico) y ejecución directa del SP (acepta HOSPITALITY,
rechaza HYBRID, NULL conserva). Nuevo `npm run db:apply -- --base X --si`
para llevar la base de referencia al mismo punto que dejaría la app. UI:
"Tipo de negocio" en Datos del negocio y mosaico "Experiencia de esta caja"
en Configuración › Sistema. Clientes existentes: RETAIL + RETAIL_POS, es
decir, sin cambio observable.

---

## ADR-005 · Modelo de dominio Hospitality V1 (Gate 3)

**Problema.** Recetas, ingredientes, modificadores y presentaciones de compra
sin crear otro inventario, otra tabla de menú ni otro camino de venta.

**Alternativas.** (a) Tablas `ingredients` / `menu_items` separadas de
`products` (el src viejo). (b) Extender `products` con `inventory_mode` y
colgar recetas y modificadores de él. (c) Recetas multinivel con versiones.

**Decisión.** (b), migración `0002_hospitality-domain.sql`:
- `products.inventory_mode` (`DIRECT | RECIPE | NONE`, default DIRECT),
  `sellable` (default 1), `base_uom` (default `pza`), `allow_decimal_qty`,
  `image_version`; `cost` pasa a `DECIMAL(14,4)` porque el costo por gramo o
  mililitro no cabe en dos decimales. Un ingrediente ES un product con
  `sellable = 0`. Retail existente queda DIRECT/vendible/pza: equivalente.
- `recipes` (product_id, `variant_option_id` NULL = base, única por
  producto+variante) y `recipe_lines` (ingrediente DIRECT, `qty_base` en la
  unidad base del ingrediente, `input_qty`/`input_uom` para la captura,
  `waste_pct`). **Un solo nivel, sin ciclos, por construcción**: el
  ingrediente debe ser DIRECT (`sp_save_recipe`), un producto usado como
  ingrediente no puede volverse RECIPE y una RECIPE con recetas no cambia de
  tipo (`sp_update_product`).
- `modifier_groups` (globales, `role`: SIZE | ADDON | SUBSTITUTION | NOTE)
  ligados a productos por `product_modifier_groups` (un grupo "Tamaño" sirve a
  20 bebidas) y `modifier_options` con `effect` explícito: NONE, ADD
  (ingrediente + qty_base), REMOVE (replaces), SUBSTITUTE (replaces →
  ingrediente, misma cantidad), SCALE (qty_factor sobre la receta base). Un
  CHECK garantiza que cada efecto trae sus datos. Un SIZE puede tener receta
  propia por variante; si no la tiene, SCALE o la base.
- `product_presentations` (nombre + `factor_to_base`) y `PurchaseDetailType2`
  con `presentation_id`; `sp_register_purchase` acepta v1 y v2 a la vez,
  convierte a unidad base y guarda `cost` por unidad base (último costo).
- `product_images` (ver ADR-006), `sale_detail.unit_cost` / `line_cost` /
  `inventory_mode` / `note`, `sale_detail_modifiers`, `sales.service_mode`,
  `inventory_movements.source` / `sale_detail_id` / `unit_cost` (el CHECK de
  `typee` entrada/salida se conserva).
- Sin `menu_items`, sin `menu_category` (CAT_categories basta), sin
  `recipe_versions`, sin escandallo multinivel.

**Motivo.** Un solo inventario y una sola tabla de productos es lo que
permite que Compras, Conteo, Alertas y Reportes sigan funcionando sin
enterarse de Hospitality. Las guardas de nivel viven en SQL, no en la UI.

**Consecuencia.** Probado con `scripts/db/pruebas/dominio-hospitality.mjs`
sobre la base temporal: conversión 0.2 L → 200 ml, costo de receta, variante
con fallback, rechazo de receta como ingrediente y de dimensión incorrecta,
compra de 5 bolsas × 1 kg → +5 000 g a 0.20 $/g, caja de 24 → precio por
pieza, mezcla de tipos v1/v2, límite de 64 KB en miniaturas.

---

## ADR-006 · Imágenes: miniatura en SQL + caché local por caja

**Problema.** El discovery proponía `photo_path → userData/product-images`,
pero Wybix es multicaja: una imagen guardada en la Caja 1 no existe en la
Caja 2, no viaja en el respaldo y no sobrevive a una reinstalación.

**Alternativas.** A. miniatura optimizada en SQL. B. assets en un host de
la sucursal + caché. C. carpeta compartida. D. híbrida.

**Decisión.** A + caché (una forma de D sin infraestructura): `product_images`
guarda **solo la miniatura** (JPEG ≤ 64 KB por CHECK, ~160–192 px, que es lo
que Touch muestra en un mosaico) con `version`; `products.image_version` sube
en cada cambio. Cada caja pide con `sp_get_product_thumbs` únicamente los ids
cuya versión local difiere y los guarda en `userData/thumbs/`. Nunca base64
gigante en SQL ni en el catálogo: el catálogo lleva solo `image_version`.

**Motivo.** Con 3 000 productos a ~8 KB son ~24 MB: cabe de sobra en los
10 GB de Express, viaja en el `.bak`, funciona offline en todas las cajas, y
la caché evita traer blobs en cada carga. B y C dependen de recursos
compartidos y permisos que en una tienda pequeña fallan más que SQL.

**Consecuencia.** La imagen a tamaño completo no se conserva en V1 (no se
necesita en mostrador). Reducción y codificación en el proceso principal con
`nativeImage` de Electron (sin dependencias nuevas).

---

## ADR-007 · Unidades de medida

**Problema.** Ferreterías venden por metro y cafeterías por gramo; el src
viejo solo conocía g/ml/pza.

**Decisión.** Tabla `uoms` con `dimension` (COUNT, WEIGHT, VOLUME, LENGTH),
una **unidad base por dimensión** (pza, g, ml, cm) y presentaciones con
`factor_to_base` (kg = 1000, L = 1000, m = 100, in = 2.54…). `products.base_uom`
debe ser una unidad base. La conversión ocurre al configurar la receta y al
comprar, nunca en `sp_register_sale`: `recipe_lines.qty_base` ya está en la
unidad del ingrediente. Precisión: `qty_base DECIMAL(14,4)`,
`cost DECIMAL(14,4)`, `stock DECIMAL(12,2)` (se conserva: 0.01 g es más fino
que cualquier báscula de mostrador). "Caja", "bolsa" y "paquete" no son
unidades sino presentaciones de compra con su factor.

---

## ADR-008 · Contrato de venta V2 aditivo (Gate 4)

**Problema.** `SaleDetailType` solo lleva `(product_id, quantity,
unit_price)`. Touch necesita declarar modificadores y modo de servicio, y SQL
Server **no permite `ALTER TYPE`**: cambiar el tipo rompería a todo consumidor
en el momento del despliegue.

**Decisión.** Transición **aditiva**, sin ventana de rotura:
- Tipos nuevos `SaleDetailType2` (con `line_no` y `note`) y
  `SaleModifierType` (`line_no`, `modifier_option_id`, `quantity`).
- `sp_register_sale` recibe `@SaleDetails` (v1) **y** `@SaleDetails2` /
  `@SaleModifiers` / `@service_mode`. Un TVP omitido llega como tabla vacía,
  así que **la llamada de Retail de hoy sigue funcionando sin tocarla**. Las
  líneas v1 reciben `line_no >= 100000` para no chocar con las v2.
- El IPC acepta la forma posicional antigua y la nueva por objeto;
  `SaleService` usa `registerSaleV2` si existe y si no se degrada.

La APP declara qué se vendió y qué opciones se eligieron. **La APP no calcula
inventario**: el procedure resuelve DIRECT / RECIPE (con variante o SCALE) /
NONE, aplica ADD, REMOVE y SUBSTITUTE, agrupa requerimientos, valida, bloquea,
escribe venta, detalle, modificadores, movimientos y caja, y hace COMMIT.

**Consecuencia.** `sale_detail.unit_cost` congela el costo de una unidad
vendida (`line_cost = quantity × unit_cost`). Los movimientos quedan ligados a
la línea, al producto vendido y a las unidades que cubren. Un límite real:
`sp_update_sale` recalcula stock por producto, así que **rechaza** ventas con
recetas o modificadores y remite a Reembolso / Cambio, que sí sabe qué
reponer. Documentado, no silencioso.

---

## ADR-009 · Concurrencia: orden de bloqueo demostrado, retry solo ante 1205

**Problema.** Varias bebidas comparten café, leche, vasos y tapas. Dos cajas
vendiendo a la vez pueden bloquearse mutuamente. "Poner `ORDER BY product_id`"
no basta como respuesta: SQL Server puede elegir otro plan.

**Decisión.** Los requerimientos se agrupan en `#need` (clave primaria
`product_id`) y el bloqueo se toma con
`INNER LOOP JOIN dbo.products WITH (UPDLOCK, HOLDLOCK) OPTION (FORCE ORDER)`:
el plan recorre `#need` por su clave y adquiere los bloqueos **siempre en
orden ascendente de id**, sin depender del optimizador. La transacción es
corta y **ningún dispositivo externo entra en ella**: cajón, pantalla de
cliente e impresión ocurren después del COMMIT, en `SaleService`.

Reintento **solo ante deadlock (1205)**, hasta 3 intentos con espera
creciente, en el IPC. Es seguro porque un 1205 aborta la transacción entera:
no quedó venta, ni inventario, ni caja, así que reenviar la misma intención no
puede duplicar nada. Cualquier otro error se devuelve tal cual. El cobro en
terminal queda fuera: nunca se reintenta a ciegas.

**Consecuencia.** Probado con procesos simultáneos reales
(`scripts/db/pruebas/concurrencia.mjs`): 4 procesos × 25 ventas con las líneas
en orden opuesto → 100 éxitos, **0 deadlocks**, inventario cuadrado al gramo.
Con un solo vaso y 4 ventas a la vez, gana exactamente una, 3 veces de 3, y el
stock nunca queda negativo. Sin vasos, 20 ventas simultáneas se rechazan sin
dejar venta, movimiento ni caja.

Hallazgo documentado: el procedure **no puede invocarse dentro de
`INSERT ... EXEC`** porque hace ROLLBACK; SQL Server sustituiría el error real
por "Cannot use the ROLLBACK statement within an INSERT-EXEC statement". Se
llama directamente, como hace el IPC.

---

## ADR-010 · Devolución por consumo real, no por receta actual

**Problema.** Devolver un Latte no es devolver "un Latte": hay que reponer
café, leche, vaso y tapa. Y la receta puede haber cambiado desde la venta.

**Decisión.** `sp_refund_sale` lee los `inventory_movements` de **esa** venta
(`source SALE|RECIPE`, `sold_product_id` = producto devuelto) y repone
`quantity / units` por unidad devuelta. No recalcula la receta de hoy. Para
ventas anteriores a Wybix Core (sin movimientos ligados) repone el propio
producto, que es el comportamiento previo.

**Consecuencia.** Probado cambiando la receta a 999 g de café *después* de
vender: la devolución repone los 18 g originales. Requirió dos columnas
(`sold_product_id`, `units`) porque `sale_detail_id` puede quedar en NULL
cuando `apply_net_update` borra la línea.

---

## ADR-011 · Disponibilidad derivada: estimada en la UI, decidida en SQL

**Problema.** Un Latte puede estar agotado porque faltan vasos. Consultar la
disponibilidad real por toque sería N+1 sobre una caja i5.

**Decisión.** `sp_get_menu_catalog` calcula `available_units` por producto en
la misma consulta que trae el menú: para RECIPE es el mínimo entre
`stock / cantidad` de cada ingrediente. La rejilla la usa para pintar
"Agotado" y "Quedan 3", y la descuenta localmente al agregar al carrito.

**Nunca se confía en ella para cobrar**: `sp_register_sale` revalida con
bloqueo. Entre pintar la rejilla y cobrar puede vender otra caja, y es SQL
quien decide.

---

## ADR-012 · Touch: presentación nueva, Core compartido, un solo design system

**Problema.** Construir Touch sin duplicar la venta ni el design system.

**Decisión.** `src/touch/` es **solo capa de presentación**: el carrito es
`CartService`, la venta es `SaleService.checkout()`, el turno `ShiftService`,
el catálogo `MenuCatalogService`, y la pantalla de cliente se alimenta sola
del carrito. No hay una sola regla de venta en el componente.

La densidad táctil se declara en el scope de la pantalla
(`.tp { --wx-control-h: 56px }`), no en el design system: Retail conserva sus
38 px y no hay dos escalas que mantener. Mismos tokens, misma tipografía,
mismo navy/cyan; distinta ergonomía.

Ergonomía verificada: objetivos de 44 px mínimo y 56 px en acciones
principales, teclado numérico propio, búsqueda bajo demanda, scanner global,
sin hover, sin clic derecho, sin diálogos del sistema (los avisos son de la
propia pantalla). Un producto sin opciones obligatorias entra **de un toque**.

**Consecuencia.** La ruta `/touch` vive fuera del Dashboard (pantalla
completa, sin rail) y el login decide el destino por `deviceProfile`, no por
rol: una caja Touch abre Touch aunque entre un administrador.

---

## Cómo correr las pruebas

```bash
npm run db:test-hospitality   # migraciones + dominio + venta + concurrencia
npm run db:verify             # ¿la base coincide con Git?
npm run build                 # bundle de producción
```

`db:test-hospitality` levanta una base temporal desde `template.bak`, aplica
las migraciones y ejecuta las tres suites (118 comprobaciones). No toca
ninguna base de trabajo: `lib/temporal.mjs` rechaza cualquier nombre que no
sea temporal.

Para llevar la base de referencia del desarrollador al mismo punto que dejaría
la aplicación al arrancar:

```bash
npm run db:apply -- --base Wybix_Production --si
```

---

## Deuda conocida

- **`inventory_movements.reference`** guarda el id como texto y no dice de qué
  documento viene: la compra #1 y la venta #1 comparten `'1'`. Hoy se
  distingue por `source` y `sold_product_id`, que solo escriben los procedures
  de venta, y `sp_refund_sale` filtra por ambos. Un `reference_type` lo
  cerraría del todo.
- **`sp_get_profit_overview`** falta en `Wybix_Production` desde antes de esta
  iteración. Está en Git; no lo despliega ninguna migración todavía.
- **Órdenes aparcadas en memoria**: las cuentas de `CartService` no sobreviven
  al cierre de la aplicación. Es deliberado en V1 (un carrito de ayer al abrir
  la caja sería un error), pero si se pide "recuperar la cuenta tras un corte
  de luz" hará falta persistirlas.
- **`sp_update_sale`** no soporta recetas ni modificadores: rechaza esas
  ventas y remite a Reembolso / Cambio. Ampliarlo exigiría recalcular consumo
  por línea, que es justo lo que la devolución ya resuelve leyendo el
  histórico.

---

## ADR-013 · La aplicación necesita REFERENCES para migrarse a sí misma

**Problema.** Una instalación real (`Hidromec_DataBase`) no pudo actualizarse:
`npm run dev` fallaba con

```
RequestError: Could not create constraint or index. See previous errors.
```

La causa real estaba escondida: `mssql/msnodesqlv8` reporta el error externo
(1750) y guarda la causa en `precedingErrors`. Al desplegarla apareció un
**1088 — "Cannot find the object dbo.uoms because it does not exist or you do
not have permissions"**, aunque la tabla sí existía en la transacción.

La aplicación entra como `ocus_app`, miembro de `ocus_app_full_role`. Ese rol
tenía SELECT/INSERT/UPDATE/DELETE/EXECUTE y ALTER sobre `dbo`, más CREATE
TABLE/VIEW/PROCEDURE/FUNCTION/TYPE, pero **no REFERENCES**. Sin REFERENCES,
SQL Server rechaza cualquier clave foránea, incluso hacia una tabla que el
propio usuario acaba de crear. No se había notado porque las claves foráneas
de Wybix venían dentro de `template.bak`, creadas por un administrador:
`0002_hospitality-domain` es la primera migración productiva que añade una.

Y no lo detectó ninguna prueba porque todas migraban con la conexión de
Windows del desarrollador, que es sysadmin.

**Alternativas.**
1. Quitar las claves foráneas de las tablas nuevas.
2. Ejecutar las migraciones con una conexión privilegiada aparte.
3. Conceder REFERENCES al rol de la aplicación desde el arranque.

**Decisión.** (3). `setupServer.ensureSchemaPermissions()` concede
`REFERENCES ON SCHEMA::dbo` al rol (o al usuario, si no hay rol) usando la
conexión de Windows que el setup ya utiliza para instalar y restaurar. Es
idempotente, se ejecuta siempre en la caja principal — no solo cuando hay
`ocusPassword` — y verifica el resultado en vez de darlo por hecho. La
definición canónica del rol pasa a estar en Git
(`sql/permissions/ocus_app_full_role.sql`); antes solo existía dentro del
`.bak`.

**Motivo.** (1) sacrifica integridad referencial permanentemente por un
problema de permisos. (2) obliga a tener credenciales privilegiadas cada vez
que hay una migración. (3) concede un permiso **estrictamente menos peligroso
que el ALTER que el rol ya tenía**: REFERENCES permite apuntar a una tabla, no
modificarla.

**Consecuencia.** Ninguna fila se tocó: el fallo era de permisos, no de datos,
y el runner ya revertía el archivo completo. Dos cambios más para que esto no
se repita a ciegas:

- `migrationsRunner` despliega la cadena de errores y reporta MIGRATION /
  BATCH / STATEMENT / SQL ERROR / CAUSA, con una pista accionable para los
  fallos conocidos (permisos, duplicados, FK, SET OPTIONS).
- `npm run db:test-upgrade` prueba el camino que faltaba: base con datos +
  **la cuenta limitada de la aplicación**. Comprueba primero que sin
  REFERENCES la actualización falla, y luego que con el permiso concedida
  entra completa. Una migración que pase como sysadmin y rompa en la caja del
  cliente ya no puede colarse.
