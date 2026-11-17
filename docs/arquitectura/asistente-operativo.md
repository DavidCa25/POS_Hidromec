# Wybix como asistente operativo — propuesta de arquitectura

> Borrador de diseño, 2026-11-14. **No es implementación** ni UI final. Se
> escribe alrededor de lo que Wybix ya tiene; cada pieza nueva dice qué
> reutiliza y por qué no la duplica.

Meta: pasar de **registrar lo que ocurre** a **entender el estado operativo,
detectar problemas y guiar para resolverlos**, sin IA generativa en la primera
versión y sin que la mascota cambie datos sensibles por su cuenta.

Patrón obligatorio de todo el sistema:

```
detectar → explicar → proponer → previsualizar → confirmar → ejecutar → auditar
```

---

## 1. Qué ya tenemos

Wybix ya tiene casi todas las piezas. Lo que falta es el **pegamento**: un lugar
donde las detecciones se registren como datos, se prioricen, se expliquen y se
conviertan en acciones.

| Pieza | Dónde | Qué aporta al asistente |
|---|---|---|
| **Alertas** | `alerts:*` en `electron/main.js` (out-of-stock, low-stock, zero-sales, cash-closures, overdue-credit, reorder, counts); pantalla `src/alertas/` | Las primeras ~8 detecciones ya existen como consultas. Hoy son listas sueltas, sin estado, sin descarte y sin acción. Son el semillero de las reglas del MVP. |
| **Sugerencias de compra** | `sp_reorder_suggestions` (velocidad de venta, días restantes, sugerido; en receta, el ingrediente que limita) | Sensor listo para «stock bajo / próximo a agotarse / qué comprar». |
| **Productos sin movimiento** | `sp_dead_products` | Sensor listo para «sin rotación / sobreinventario». |
| **Riesgo de caja** | `sp_cashier_risk`, `sp_security_by_cashier`, `alerts:refunds-by-cashier` | Sensores de caja: devoluciones, aperturas sin venta, descuadres por cajero. |
| **Utilidad** | `sp_get_profit_overview` (precio sin IVA − `sale_detail.unit_cost` congelado), `sp_income_statement`, `sp_day_close_report` | La definición única de ganancia. Las reglas de margen la **consumen**; no la recalculan con otra fórmula. |
| **Recetas y disponibilidad** | `recipes`, `recipe_lines`, `sp_resolver_receta_efectiva`, `sp_check_availability` («hay latte pero no leche de almendra») | Costo teórico por producto y faltantes por ingrediente. Base de «consumo real vs teórico». |
| **Producción y merma** | `production_formulas/_lines`, `production_batches`, `production_batch_consumption`, `production_waste`, `sp_production_plan/start/finish/waste/board` | «Qué falta para producir 150 donas», «producción mayor que ventas», «merma elevada». `sp_production_plan` ya calcula faltantes. |
| **Movimientos de inventario** | `inventory_movements` (con `unit_cost`), conteos `sp_inventory_count_apply`, traspasos | Consumo REAL y ajustes: la otra mitad del «¿por qué gasto más leche?». |
| **Compras** | `purchase`, `purchase_detail.profit_percent`, `sp_register_purchase` (reescribe costo y precio) | «Subió el costo y el precio no», «% de ganancia distinto al de la última compra». |
| **Caja** | `cash_shifts`, `cash_movements`, `cash_closures`, `expenses` | Descuadres, retiros atípicos, gastos fuera de patrón. |
| **Mascota y Guide** | `wx-mascota` (4 caras: idle, atención, éxito, error), `src/app/wx-guide/` (recorridos como **datos**, `Requisitos` por áreas/capacidades/permisos, motor que señala por `data-guide`) | La **presentación** del asistente ya existe y ya respeta capacidades y permisos. Guide puede llevar a la persona a la pantalla de la acción. |
| **Paleta Ctrl+K** | `src/app/wx-paleta/` (acciones, entidades, destinos) | El lugar natural del motor de comandos: ya busca productos, clientes y acciones. |
| **Lectura con confianza** | `electron/quickstart/` (`alias.js`, `semantica.js`, `lector.js`): `exacto` se aplica, `probable` se marca, `dudoso` **se pregunta** | **El patrón del intérprete de comandos.** Tabla de alias en vez de distancia de edición; nunca adivinar. |
| **Unidades** | `uoms`, `product_presentations` (factor a unidad base), `CatalogService.esGranel` | Extraer «18 g», «250 ml», «medio kilo», «una caja» y convertir a unidad base. |
| **Capacidades por giro** | `CapabilityService`, `business_modules`, `src/core/modulos.ts`, `quickstart/giros.js`, `servicios/presets.json` | Qué packs de reglas están activos, con la MISMA regla que la navegación. |
| **Licencia y derechos** | `electron/licencia/entitlements.js`, licencia por empresa | Una regla o acción de un módulo no contratado no se evalúa ni se ofrece. |
| **Seguridad** | `seguridad/canales.js` (EXIGE / ABIERTOS / APROBABLES), `sesion.proteger`, PIN de encargado y aprobación desde la app (`aprobaciones`), `security_events`, `superficie_auditoria` | El ejecutor **no inventa permisos**: llama los canales existentes y hereda su autorización y su bitácora. |
| **Eventos y hechos** | `sync_outbox` (event_type, aggregate, versión), hechos en la nube (`sales_facts`, `sale_line_facts`, `shift_facts`, `cash_movement_facts`, `inventory_ledger`, `production_batch_facts`, `production_waste_facts`) | Disparadores locales y la vista consolidada de nube (multi-sucursal, grupo de empresas). |
| **Avisos al dueño** | nube: `alertas` → push (`send-alert-push`), `notification_outbox/kinds/preferences/deliveries`; app Owner | Canal para hallazgos críticos fuera de la caja, con preferencias ya resueltas. |
| **Doctor técnico (piezas)** | `arranque.js` (pasos con nombre), `verificarObjetos` (objetos críticos), `network:diagnose`, `localhost:diagnostico`, `backupManager`, estado de `cloudSync`, licencia (`relojAtrasado`, gracia), `cajaArrendada`, logs | Casi todo el doctor ya se mide; solo falta reunirlo en un tablero y explicarlo. |
| **Ciclo por empresa** | `electron/empresas/ciclo.js` | Un servicio de evaluación en segundo plano se registra ahí y se reinicia al cambiar de empresa. |
| **Activos de cliente** | `customer_assets` (kind, label, identifier) | Base para un futuro pack Purificadora (envases en poder del cliente). |

**Lo que NO existe todavía**: un registro de reglas, el estado de un hallazgo
(visto, pospuesto, descartado, resuelto), la explicación con evidencia, el
plan de acción con vista previa y la bitácora del asistente.

---

## 2. Arquitectura recomendada

```
                ┌──────────────────────── Renderer (Angular) / Mobile (RN) ───────────────────────┐
                │  Mascota (presentación)   Bandeja de hallazgos   Barra de comandos (Ctrl+K)      │
                │        ▲  estado/atención        ▲ lista + explicar        ▲ texto → plan        │
                └────────┼─────────────────────────┼─────────────────────────┼─────────────────────┘
                         │ contratos compartidos (/shared/asistente: Hallazgo, Intent, Plan…)
                ┌────────┴─────────────────────────┴─────────────────────────┴─────────────────────┐
                │ Proceso principal: electron/asistente/                                            │
                │  Sensores ──hechos──▶ Motor de reglas ──▶ Hallazgos (store) ──▶ Recomendaciones   │
                │     ▲  (SQL/IPC existentes)   (puro)          │                       │           │
                │     │                                         ▼                       ▼           │
                │  Doctor técnico (mismo motor,          Intérprete de comandos ──▶ Planificador     │
                │  sensores del sistema)                 (léxico + gramática)      (preview, dry-run)│
                │                                                                        │          │
                │                                         Ejecutor ──▶ canales existentes (sesion.proteger)
                │                                                     └─▶ bitácora del asistente     │
                └───────────────────────────────────────────────────────────────────────────────────┘
```

| Componente | Responsabilidad | Límite |
|---|---|---|
| **Sensores** | Leen el estado en forma compacta: una consulta alimenta muchas reglas. La mayoría ya existen como SP (`sp_reorder_suggestions`, `sp_dead_products`, `sp_production_plan`…). | Solo leen. Nunca deciden. Los cálculos pesados se quedan en SQL; devuelven hechos, no conclusiones. |
| **Motor de reglas** | Evalúa reglas puras `hechos → hallazgos`. Deduplica, prioriza y resuelve conflictos. | No escribe nada del negocio. No conoce la UI. Sin `if (giro)`: las reglas llegan por packs. |
| **Store de hallazgos** | Estado de cada hallazgo y su historia: abierto, visto, pospuesto, descartado, resuelto. | Tabla local nueva, de la empresa activa. Aparte de las tablas de negocio. |
| **Explicador** | Arma la explicación con una **plantilla** y la evidencia numérica del hallazgo. | Plantillas como datos, por regla y versión. Nunca texto libre generado. |
| **Doctor técnico** | Las reglas del sistema (respaldo, sync, reloj, licencia, impresora, red, objetos, disco), con el **mismo motor** y otra categoría. | Mismo contrato. Ninguna acción que toque la red o el SQL Server sin confirmar. |
| **Intérprete de comandos** | Texto → `intent` + parámetros tipados + confianza. | No ejecuta. Si un parámetro queda dudoso, pregunta. |
| **Planificador** | `intent` + parámetros → **Plan**: qué canal se va a llamar, con qué datos y su vista previa (dry-run). | Reusa los previews que ya existen (cotización comercial, `sp_production_plan`, `sp_check_availability`). Si no hay preview real, lo dice. |
| **Ejecutor** | Ejecuta un plan **confirmado** llamando el canal existente, con la sesión de la persona. | Nunca SQL directo. Hereda permisos, aprobaciones y bitácora del canal. Idempotente por plan. |
| **Presentación** | La mascota cambia de cara y gesto con el hallazgo más urgente; la bandeja lista y explica; Ctrl+K recibe comandos. | La UI no decide nada: pinta lo que el proceso principal ya decidió. |

**Contratos compartidos.** Los tipos (`Hallazgo`, `ReglaManifest`, `Intent`,
`Plan`, `Resultado`) viven en `/shared/asistente/` (como `shared/pagos.ts`). Las
reglas son funciones TS puras: corren igual en Electron y en POS Mobile (sobre
su SQLite). Cada plataforma declara qué **sensores** tiene; una regla cuyo
sensor no existe en esa plataforma simplemente no se evalúa ahí.

---

## 3. Motor de reglas

### Una regla es un manifiesto más una función pura

```ts
// Conceptual
interface ReglaManifest {
  id: 'core.margen.bajo';           // estable, con namespace del pack
  version: 3;                        // cambia la lógica → nueva versión (los hallazgos guardan cuál los creó)
  pack: 'core' | 'hospitality' | 'retail' | 'servicios' | string;
  dominio: 'inventario' | 'costos' | 'caja' | 'produccion' | 'compras' | 'ventas' | 'sistema' | …;
  requiere: { capacidades?: string[]; modulos?: string[]; entitlements?: string[] };
  verPermiso?: 'VER_COSTOS' | …;     // quién puede ver el hallazgo
  sensores: ['margenes_productos'];  // qué hechos consume
  cuando: { eventos?: ['SALE', 'PURCHASE']; cadaMin?: 60; alAbrir?: ['inventario'] };
  umbrales: { margenMinimoPct: { def: 15, min: 0, max: 90 } };  // editables por negocio
  severidadBase: 'info' | 'aviso' | 'importante' | 'critico';
  supera?: ['core.stock.bajo'];      // si esta dispara, la otra se oculta para la misma entidad
  acciones: ['producto.ajustar_precio', 'producto.abrir'];       // intents que puede proponer
  explicacion: 'core.margen.bajo@3'; // plantilla
}
evaluar(hechos, umbrales, contexto) => HallazgoNuevo[]   // pura, sin I/O, testeable
```

- **Registro por packs, no por `if`.** Cada pack exporta su lista de
  manifiestos. El motor arma el conjunto activo con
  `requiere ∩ capacidades ∩ derechos de la licencia`: la misma regla que
  `NavegacionService.areas()` y Guide. Agregar una regla no toca el motor.
- **Sensores compartidos.** El motor junta los sensores que piden las reglas
  activas, los ejecuta **una vez por ciclo** y les da caché por tiempo (y por
  evento cuando aplica). Diez reglas de inventario no son diez consultas.
- **Disparo.** Tres fuentes: evento local (después de una venta, compra,
  merma o corte, igual que `ultimoCobro`), tiempo (servicio en `ciclo.js`) y
  al abrir una pantalla (las reglas de esa área, con datos frescos).

### Clave, deduplicación y ciclo de vida

- `clave = regla.id + entidad + periodo` (por ejemplo,
  `core.margen.bajo|producto:812|2026-W46`). Si la regla vuelve a disparar con
  la misma clave, se actualiza la evidencia: no se crea otro hallazgo.
- Estados: `abierto → visto → (pospuesto hasta X | descartado con motivo | resuelto)`.
  Se resuelve **solo** cuando la regla deja de disparar para esa clave. Puede
  reabrirse si vuelve.
- Un descarte guarda motivo y alcance («esta entidad», «esta regla para
  siempre», «hasta tal fecha»). Es la defensa principal contra el ruido.

### Prioridad (un número, explicable)

```
prioridad = severidad × impacto × confianza × frescura × (1 − fatiga)
```

- **impacto**: en pesos cuando se puede (margen perdido por semana, costo de
  la merma, venta perdida por agotado). Si no, en unidades normalizadas.
- **confianza**: depende de los datos. Pocas ventas o costo desconocido la
  bajan. Bajo un mínimo, el hallazgo no se muestra («no hay datos
  suficientes»).
- **fatiga**: descartes y posposiciones previos de esa regla en este negocio.
- La mascota pone cara de «atención» solo por lo `critico` o lo de impacto
  alto. Todo lo demás espera en la bandeja.

### Conflictos

- `supera`: «agotado» supera a «stock bajo»; «precio debajo del costo» supera
  a «margen bajo».
- Agrupación por entidad: un producto con tres hallazgos se muestra como una
  tarjeta con tres puntos.
- Contradicciones reales (una regla dice «compra más», otra «tienes de más»)
  se detectan en pruebas con fixtures: se prohíben entre reglas del mismo
  dominio y misma entidad, salvo que una declare `supera`.

### Pruebas

Cada regla trae fixtures `hechos → hallazgos esperados` (golden tests puros,
sin SQL). Cada sensor nuevo trae su prueba SQL como las de `scripts/db/pruebas`.

---

## 4. Contexto por giro

**Pack** = manifiesto de reglas + sensores + intents + vocabulario + umbrales
por defecto.

| Pack | Se activa con | Reglas ejemplo | Vocabulario y sensores propios |
|---|---|---|---|
| `core` | siempre | stock bajo vs velocidad, agotado con demanda, sin movimiento, sobreinventario (días de cobertura), margen bajo o negativo, precio < costo tras compra, descuadre recurrente, retiro atípico, crédito vencido | unidades base, sinónimos de verbos |
| `hospitality` | `hospitality` / `comandas` | receta con costo > X% del precio, consumo real > teórico, producción > ventas, merma alta, faltante para producción planeada, modificador que suma consumo sin efecto `ADD` | «taza», «shot», «porción»; sensor consumo teórico (ventas × receta efectiva) |
| `retail` | perfil comercio | sin rotación N días, próximo a agotarse, cobertura > N días, venta suelta que abre paquetes muy seguido | «pieza», «caja», «paquete» |
| `servicios` | `servicios` | órdenes abiertas viejas, citas sin cobrar, comisiones sin liquidar | «cita», «orden», «técnico» |
| `purificadora` (futuro) | módulo nuevo | envases en poder de clientes, producción vs reparto, cobranza de ruta | «garrafón», «envase»; sensor sobre `customer_assets` |

Reglas de convivencia:
- **Core no conoce a los packs.** Un pack puede agregar reglas, sensores,
  intents, sinónimos y umbrales; no puede modificar una regla de otro pack.
  Si necesita un cambio, se pide en `core` como parámetro.
- **Umbrales por negocio** en configuración (con mínimos y máximos
  declarados). Los valores por defecto los da el pack del giro: «margen
  mínimo» no es el mismo en una cafetería que en una refaccionaria.
- **Clientes (custom-addons):** solo umbrales y vocabulario, por los huecos de
  `marca.ts`. Nunca reglas con `if (cliente === …)`.

---

## 5. Motor de comandos (sin IA generativa)

Pipeline determinista, mismo espíritu que QuickStart:

```
texto
 → normalizar   minúsculas, acentos, números escritos («seis», «media docena», «medio kilo»), «$65», «65 pesos»
 → segmentar    verbo / objeto / complementos (con, a, de, para, mañana…)
 → intent       gramáticas por intent: patrones con sinónimos y puntaje; empate o puntaje bajo → preguntar
 → extraer      extractores tipados: dinero, cantidad+unidad (uoms + presentaciones), fecha relativa,
                entidad (producto/cliente/proveedor) por índice del catálogo + alias, con confianza
 → validar      esquema del intent (slots requeridos, rangos, permisos)
 → completar    lo que falta o es dudoso se pregunta con un formulario corto, nunca se adivina
 → Plan         (ver §3 y §6)
```

Cada intent se declara así:

```ts
// Conceptual
intent 'produccion.faltantes' {
  frases: ['qué (me) falta (comprar)? para producir {cantidad} {producto} {fecha}?',
           'alcanza para {cantidad} {producto}'],
  slots:  { cantidad: Numero, producto: Producto(formula), fecha: Fecha = hoy },
  tipo:   'consulta',                 // no escribe
  ejecuta: sensor 'produccion_plan' → plantilla 'produccion.faltantes'
}
intent 'merma.registrar' {
  frases: ['registra(r)? merma de {cantidad} {producto}', 'se (tiraron|echaron a perder) {cantidad} {producto}'],
  slots:  { cantidad, producto, motivo = 'MERMA' },
  tipo:   'accion', nivel: 'confirmar', canal: 'produccion:merma'
}
```

Los ejemplos:

| Frase | Intent | Parámetros | Qué pasa |
|---|---|---|---|
| «Crear latte grande a $65 con 18 g de café y 250 ml de leche» | `producto.crear_con_receta` | nombre «Latte grande», precio 65, líneas [café 18 g, leche 250 ml] | «café» → «Café en grano» (exacto). «leche» → entera o deslactosada: **dudoso, pregunta**. Preview: costo de la receta, margen y si ya existe «Latte» con tamaños (propone variante en vez de producto nuevo). |
| «¿Qué me falta comprar para producir 150 donas mañana?» | `produccion.faltantes` | 150, fórmula «Dona glaseada», fecha mañana | Consulta pura: `sp_production_plan` + stock. Responde con lista y botón «Crear borrador de compra». |
| «Registra merma de 6 donas glaseadas» | `merma.registrar` | 6, «Dona glaseada» | Preview: stock antes/después y costo de la merma. Confirmar, ejecutar, auditar. |
| «¿Por qué estoy gastando más leche esta semana?» | `analisis.consumo` | ingrediente leche, periodo semana | Árbol de decisión (§9). No es conversación: es un análisis con causas candidatas ordenadas por evidencia. |

**Lo que no entiende no lo inventa.** Si ningún intent supera el umbral, cae
a la búsqueda de Ctrl+K (entidades y destinos) y ofrece los intents más
parecidos como botones. Sin respuesta libre.

---

## 6. Seguridad

| Nivel | Qué | Cómo |
|---|---|---|
| **A · Automático** | Evaluar reglas, crear y actualizar hallazgos, resolverlos solos, cambiar la cara de la mascota, abrir una pantalla, prellenar un formulario, responder consultas | Sin escritura de negocio. Respeta `verPermiso`: un hallazgo de margen no se muestra a quien no tiene `VER_COSTOS`. |
| **B · Confirmación** | Crear producto o receta, registrar merma, planear producción, borrador de compra, marcar hallazgo como revisado | Preview, luego confirma la persona que tiene el permiso del canal. El ejecutor llama el canal con su sesión. |
| **C · Autorización** | Lo que hoy ya es `APROBABLES`: ajustes de inventario, retiros, compras y pagos a proveedor, cambios de precio, devoluciones; además, cambios masivos (más de N entidades) | El mismo flujo de PIN de encargado o aprobación desde la app del dueño. El asistente no tiene un camino propio. |
| **D · Nunca desde el asistente** | Borrar, cancelar o timbrar CFDI, mover dinero, cambiar permisos, usuarios, licencia o configuración de red, enviar mensajes a clientes | Se ofrece **ir a la pantalla**, no ejecutar. |

Reglas transversales:
- El plan guarda **quién lo propuso** (regla o comando, con su versión),
  **quién confirmó** y **quién autorizó**. Lo sensible además va a
  `security_events` con `origen = ASISTENTE`.
- Idempotencia: un plan se ejecuta una vez (clave del plan). Confirmar dos
  veces no duplica la merma.
- La vista previa caduca si cambian los datos de los que dependía (mismo
  principio que `PAYLOAD_CHANGED` en aprobaciones).
- Límite de acciones por minuto desde el asistente. Una regla que propone
  más de N acciones iguales a la vez se convierte en una sola acción
  agrupada.

---

## 7. Offline y sync

| Se evalúa en la caja, sin Internet | Necesita la nube |
|---|---|
| Todo lo de la sucursal: inventario, recetas, producción, merma, compras, caja, márgenes, doctor técnico | Comparar sucursales (multisucursal) y empresas del grupo |
| Comandos e intents (catálogo local) | Tendencias largas o estacionales si la caja no guarda tanto historial |
| Hallazgos y su estado | Avisar al dueño fuera de la caja (push) |
| POS Mobile: un subconjunto sobre su SQLite (ventas del evento, stock asignado, caja) con las mismas reglas TS | Consolidar hallazgos de varias cajas y tablets |

- Un hallazgo `importante` o `critico` se publica como hecho por
  `sync_outbox` (`FINDING_RAISED`, `FINDING_RESOLVED`). La nube lo convierte
  en `alertas` o notificación con las preferencias que ya existen. La caja es
  la autoridad del estado: si en la nube se marca como visto, vuelve como
  comando por la bandeja, igual que el grupo de empresas.
- Reglas de nube (multisucursal) corren como trabajos en Supabase sobre los
  hechos, con el mismo manifiesto: `ejecutaEn: 'nube'`.

---

## 8. Modelo de datos (conceptual)

| Entidad | Campos clave | Notas |
|---|---|---|
| **ReglaDef** | id, versión, pack, dominio, requiere, sensores, umbrales (def/min/max), severidad, supera, acciones, plantilla | En código, versionada. No es una tabla. |
| **ReglaConfig** | negocio, regla, activa, umbrales propios, silenciada hasta | Por empresa. Ninguna regla se vuelve a encender sola si el negocio la apagó. |
| **Hallazgo** | id, clave, regla+versión, empresa, sucursal, entidad (tipo, id), dominio, severidad, prioridad, confianza, evidencia (JSON con números), parámetros de la explicación, estado, detectado, último visto, resuelto, expira | Local. Lo importante se publica a la nube. |
| **Recomendación** | hallazgo, intent, parámetros propuestos, beneficio estimado, orden | Una o varias por hallazgo. |
| **Descarte** | hallazgo o clave o regla, usuario, motivo, alcance, hasta | Alimenta la fatiga. |
| **Plan / Acción** | id, origen (hallazgo o comando), intent, parámetros, preview, estado (borrador, confirmada, autorizada, ejecutada, fallida, cancelada, caducada), clave de idempotencia, propuso, confirmó, autorizó, resultado | La vista previa se guarda tal como se mostró. |
| **Bitácora del asistente** | evento (detectó, mostró, explicó, propuso, confirmó, ejecutó, falló, descartó), quién, cuándo, referencias | Las acciones sensibles también van a `security_events`. |
| **Contexto** | capacidades, giro, packs, permisos y licencia vigentes al evaluar | Se guarda resumido con el hallazgo para poder explicar «por qué lo vi». |
| **Comando** | texto normalizado, intent, confianza, slots, resultado | Para mejorar gramáticas. Retención corta. Sin datos de clientes. |

---

## 9. Flujo completo — «¿Por qué estoy gastando más leche esta semana?»

1. **Detectar** (puede llegar solo, sin preguntar). La regla
   `hospitality.consumo_desviado` corre cada noche con el sensor
   `consumo_teorico_vs_real`:
   - teórico = ventas de la semana × receta efectiva (incluye opciones de
     tamaño y leche, vía `sp_resolver_receta_efectiva`);
   - real = salidas en `inventory_movements` (consumo, merma y ajustes).

   Leche: teórico 42 L, real 51 L. Desvío de +9 L (+21%), unos $198. Supera
   el umbral de 15% y 3 L, así que crea el hallazgo, severidad `importante`.
2. **Explicar** con plantilla y evidencia: «Esta semana salieron 51 L de leche
   y tus ventas explican 42 L. Faltan 9 L (≈ $198) sin registrar.»
3. **Causas candidatas** (árbol de decisión, ordenado por evidencia):
   - ¿Merma registrada esta semana? 0 L. Merma sin registrar: probable.
   - ¿Recetas con leche que cambiaron o tienen opciones que suman leche sin
     efecto `ADD`? «Extra leche» en Latte no descuenta. Probable.
   - ¿Ajustes de conteo negativos? Uno de −2 L el martes.
   - ¿Ventas sin receta? 14 «Café con leche» vendidos sin receta.
4. **Proponer** acciones:
   - registrar merma;
   - corregir el modificador «Extra leche» (efecto `ADD`, 60 ml);
   - agregar receta a «Café con leche»;
   - hacer conteo de leche.
5. **Previsualizar.** La persona toca «Agregar receta a Café con leche». El
   plan muestra la receta propuesta (copiada del Latte chico, editable), el
   costo nuevo y el margen.
6. **Confirmar.** Es nivel B: confirma quien tiene `CATALOGO_EDITAR`.
7. **Ejecutar.** Se guarda por el canal de recetas que ya existe.
8. **Auditar.** Queda en la bitácora del asistente con regla y versión, plan,
   quién confirmó y resultado.
9. **Cerrar el ciclo.** La siguiente evaluación recalcula: el teórico sube a
   48 L y el desvío baja a 3 L (6%), por debajo del umbral, así que el
   hallazgo se resuelve solo. Si no baja, sigue abierto con la evidencia nueva.

---

## 10. MVP

**Principio:** primero la lectura, que sea útil y confiable. Después las
acciones. Nada de «ChatGPT dentro de Wybix».

**MVP 1 · Hallazgos (solo lectura), en ~2–3 semanas**
- Motor, registro de packs, store de hallazgos (tabla local), bandeja con
  explicar, posponer y descartar. La mascota cambia de cara con el más urgente.
- **Doctor técnico**: respaldo viejo o fallido, sync atrasado, reloj
  desfasado, licencia por vencer o en Venta Esencial, impresora o cajón sin
  configurar, objetos SQL faltantes, disco casi lleno.
- **8 reglas core/hospitality**, casi todas con sensores que ya existen:
  1. agotado con demanda (`sp_reorder_suggestions`);
  2. se agota en ≤ N días;
  3. sin movimiento ≥ 60 días (`sp_dead_products`);
  4. margen bajo o precio < costo (definición de `sp_get_profit_overview`);
  5. precio que no subió tras una compra más cara (`purchase_detail`);
  6. descuadre de caja recurrente (`cash_closures`);
  7. receta con costo > 40% del precio;
  8. faltante para la producción planeada (`sp_production_plan`).
- Métricas del propio asistente: hallazgos mostrados, descartados (ruido),
  accionados y tiempo hasta resolver.

**MVP 2 · Comandos y acciones guiadas**
- Intérprete con 5 intents:
  1. `merma.registrar`;
  2. `produccion.faltantes`;
  3. `producto.crear` (simple, sin receta);
  4. `producto.ajustar_precio` (nivel C);
  5. `ir_a` / buscar.
- Planificador y ejecutor con niveles A, B y C, bitácora e idempotencia.

**MVP 3 · Lo que más valor da después**
- Consumo real vs teórico (§9), `producto.crear_con_receta`, publicación de
  hallazgos críticos a la app del dueño y primeras reglas de nube
  (comparar sucursales).

---

## 11. Evolución con IA (sin volverla autoridad)

La IA solo entra en tres papeles, siempre opcional y con todo funcionando sin
ella:
1. **Otro intérprete.** Convierte texto libre al MISMO `Intent` + slots
   tipados. El esquema lo valida igual; si algo es dudoso, se pregunta igual.
   Nunca llama un canal.
2. **Redactor.** Reescribe la explicación de un hallazgo a partir de su
   evidencia estructurada. Los números salen de la evidencia, no del modelo.
3. **Proponente de reglas.** Sugiere reglas candidatas a partir de patrones.
   Un humano las revisa, se escriben como reglas normales con fixtures y se
   versionan.

Además: apagable por negocio, sin enviar datos de clientes sin
consentimiento, y fallback local siempre.

---

## 12. Riesgos y mitigaciones

| Riesgo | Mitigación |
|---|---|
| **Falsas recomendaciones** (datos sucios: costos en cero, recetas incompletas, conteos viejos) | La confianza baja con datos insuficientes, y bajo un mínimo no se muestra. Primero las reglas de **calidad de datos** («producto sin costo», «receta sin ingredientes») antes de las que dependen de esos datos. Toda explicación enseña su evidencia. |
| **Ruido / fatiga** | Prioridad con fatiga, descartes con alcance, agrupación por entidad, límite de cuántos hallazgos ve la mascota. Métrica de descartes por regla: una regla con >50% de descartes se revisa. |
| **Reglas contradictorias** | `supera`, agrupación y prueba de contradicciones por dominio y entidad en CI. |
| **Permisos** | El ejecutor solo usa canales existentes con `sesion.proteger`. `verPermiso` en hallazgos. Pruebas como `sesion-permisos.mjs`: ningún intent de acción sin canal clasificado. |
| **Rendimiento** | Sensores compartidos y cacheados, cálculo pesado en SQL, evaluación en segundo plano (`ciclo.js`), ventanas incrementales. Prueba de rendimiento con el catálogo de 6,000 productos que ya existe (`e2e/rendimiento.spec.js`). |
| **Duplicación de lógica** | Una regla no recalcula costo, utilidad ni disponibilidad: consume el SP que ya lo define. Revisión de cada PR de reglas contra esta lista. |
| **Escrituras accidentales** | Niveles A/B/C/D, vista previa que caduca, idempotencia, límite de acciones y bitácora. |
| **Explicaciones que envejecen** | Plantillas versionadas con la regla; un hallazgo guarda con qué versión se creó. |
| **Crecer sin orden** | Namespaces por pack, manifiesto obligatorio, fixtures obligatorias, catálogo generado de reglas activas (como `canales.js` responde «qué protege Wybix»). |

---

## Decisiones de diseño (2026-11-14)

- **Una sola puerta: Wybix en el dock.** La mascota del dock (hoy abre Wybix
  Guide) abre un **chat**. Su cara y un número dicen si hay pendientes. En
  Inicio, la frase de Wybix dice lo más urgente. En las pantallas, una
  etiqueta en el renglón del problema abre el mismo chat sobre ese hallazgo.
- **Se ve como conversación, no lo es.** Lo que dice Wybix sale de
  plantillas con números reales; lo que escribe la persona pasa por el
  intérprete. Si falta un dato, Wybix pregunta con botones; si no entiende,
  ofrece los intents más parecidos.
- **Tres formas de pedir algo**: atajos de un toque (lo más usado y lo
  sugerido), escribir con autocompletar del catálogo, y armar la frase con
  toques (cajas táctiles y tablets).
- **Nada se guarda sin «Confirmar»**, con la tarjeta de antes y después. La
  ejecución la hace la pantalla con la API que ya existe (permisos,
  aprobaciones con PIN o desde la app del dueño); el proceso principal
  registra el plan y su resultado en la bitácora.
- **Rutinas** (después del MVP): cuándo + qué. Una rutina prepara, avisa o
  deja borradores sola; lo que mueve inventario, dinero o precios espera a
  una persona.
- **Clasificador ligero** (naive Bayes) entrenado con un corpus propio y con
  las frases que la gente confirma. Un loop de entrenamiento
  (`scripts/asistente/entrenar.mjs`) mide la exactitud sobre frases de prueba
  que no vio y se repite hasta que los errores sean casi nulos.

## Decisiones abiertas

1. Nombre visible: ¿«Wybix» a secas o un nombre para el asistente?
2. Dónde vive la bandeja: ¿una pantalla nueva o dentro de Alertas (que ya
   ordena por urgencia)?
3. Umbrales por defecto de cada giro: ¿los fijamos con datos reales de I Do
   Nut y B&J Super?
4. ¿Qué tanto historial guarda la caja para tendencias (8, 12 o 52 semanas)?
5. El pack Purificadora: ¿`customer_assets` basta para envases en poder del
   cliente o necesita su propio libro de envases?
