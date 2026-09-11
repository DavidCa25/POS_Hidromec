# Migración de clientes desde otro POS/ERP

**Estado: propuesta de arquitectura. No hay código ni cambios de base derivados de este documento.**

---

## 1. El problema real no es leer datos

Leer un Excel es fácil. Conectarse a MySQL es fácil. Lo que no es fácil, y es donde
mueren todas las migraciones, es esto:

> El esquema de origen es **desconocido y distinto en cada cliente**, y el negocio
> lleva años metiendo datos que su sistema nunca validó.

Un catálogo real de una ferretería con 8 años de uso trae: el mismo producto tres
veces con claves distintas, precios con y sin IVA en la misma columna, "1/2" y
"0.5" y "MEDIA" como cantidades, códigos de barras con espacios, proveedores
escritos de seis formas, y stock negativo.

Por eso la arquitectura no debe organizarse alrededor de *de dónde vienen los
datos*, sino alrededor de **un modelo canónico y una validación dura**. El origen
—Excel, SQL Server, MySQL— es un detalle intercambiable.

---

## 2. Qué ya existe en Wybix

Antes de proponer nada, lo que hay hoy:

| Pieza | Estado |
|---|---|
| `src/app/migracion/` | Pantalla con pestañas: productos, clientes, proveedores, ventas |
| `src/app/importador-productos/` | Lector de Excel con vista previa fila a fila y errores |
| `sp_import_products` + `ProductImportType` | Importación por TVP; crea marcas y categorías que falten |
| `products.part_number` UNIQUE | La clave natural que decide qué es duplicado |

**No hay que empezar de cero.** Lo que falta no es un importador: es el *modelo
canónico*, el *mapeo*, y sobre todo las **reglas de qué no se importa**.

---

## 3. El modelo canónico es el contrato

Una sola definición, en el centro, contra la que validan todos los orígenes:

```
                Excel / CSV  ─┐
        SQL Server (Aspel…)  ─┤
              MySQL / Maria  ─┼──►  ADAPTADOR  ──►  MODELO CANÓNICO  ──►  validación
                 PostgreSQL  ─┤     (por origen)     (uno solo)              │
                SQLite / …   ─┘                                              ▼
                                                                       vista previa
                                                                             │
                                                                             ▼
                                                              importación transaccional
```

El adaptador es lo único que se escribe por origen, y su única responsabilidad es
producir filas canónicas. **Ni valida ni escribe.** Eso hace que añadir un origen
nuevo sea barato y que la validación no se duplique nunca.

Entidades canónicas, en orden de dependencia:

1. `marca`, `categoria`, `unidad`
2. `proveedor`, `cliente`
3. `producto` (depende de 1)
4. `existencia_inicial` (depende de 3)
5. `saldo_inicial_cliente`, `saldo_inicial_proveedor` (dependen de 2)

Ese orden **es** el orden de importación. Nada más.

---

## 4. La decisión que más importa: qué NO migrar

Esta es la parte que casi siempre se hace mal, y la que más caro sale.

### No migrar: ventas históricas

Es lo que todo cliente pide primero y lo que menos conviene hacer.

- Una venta de Wybix **pertenece a un turno y a una caja**. Las ventas viejas no
  tienen ni turno ni caja. Importarlas obliga a inventar turnos falsos, y a partir
  de ahí ningún corte de caja del sistema vuelve a cuadrar.
- Wybix guarda `unit_cost` **congelado** en cada línea para calcular utilidad. Los
  datos viejos no lo traen. Se importarían con costo 0, y todos los reportes de
  utilidad quedarían inflados para siempre, sin forma de distinguir lo importado
  de lo real.
- Los folios chocan con la serie nueva.
- El CFDI viejo lo emitió otro sistema con otros certificados. Wybix no puede
  responder por él, ni cancelarlo, ni relacionarlo.

**Qué hacer en su lugar:** dejar el sistema anterior instalado y en solo lectura
durante el periodo que exija el SAT. Si el cliente insiste en tener el histórico
dentro de Wybix, importarlo a una tabla **plana de archivo** (`legacy_sales`), con
su propia pantalla de consulta, que **ninguna consulta de reportes toca**. Es
histórico consultable, no es contabilidad viva.

### Tampoco migrar

| Qué | Por qué |
|---|---|
| Cortes de caja históricos | Cuadran contra ventas que no existirán en Wybix |
| Movimientos de inventario históricos | El stock inicial se establece con un conteo, no reconstruyendo años de kardex |
| Usuarios y contraseñas | Los hashes no son compatibles y no deben serlo. Se dan de alta a mano |
| Promociones, listas de precios múltiples | Wybix V1 no tiene ese modelo. Importarlas es prometer algo que no existe |

### Sí migrar

| Qué | Cómo |
|---|---|
| Catálogo de productos | Directo |
| Marcas, categorías | **Derivadas del archivo de productos**, no como archivos aparte |
| Clientes y proveedores | Directo |
| Existencias | Como **conteo físico de apertura**, ver §6 |
| Saldos de crédito y cuentas por pagar | Como **documento de apertura**, ver §6 |
| Precios y costos | Directo, con la advertencia de §6 |
| Códigos de barras | Directo, normalizados |

---

## 5. A) Excel/CSV

Es el mínimo común denominador: **todo** sistema, por viejo que sea, exporta a
Excel o imprime a un archivo que se puede pegar en Excel. Y tiene una propiedad que
ningún conector tiene: el cliente **ve** lo que va a importar antes de importarlo.

Formato: **una plantilla por entidad**, descargable desde la propia pantalla, con
la primera fila de encabezados y una hoja de instrucciones. Y aun así, el
importador **no debe exigir los encabezados de la plantilla**: debe ofrecer
mapeo de columnas (§7), porque el cliente va a subir el export de su sistema.

Columnas canónicas de `producto`:

```
clave*        nombre*     marca        categoria    precio_venta*
costo         stock       codigo_barras            unidad
lleva_iva     tasa_iva    clave_sat    proveedor
```

`*` obligatorio. Todo lo demás tiene un valor por defecto explícito y **visible en
la vista previa** — no un default silencioso.

---

## 6. Los tres puntos donde una migración se rompe en silencio

### Precios con IVA vs sin IVA

Es el error más caro y el más difícil de detectar después, porque el sistema
funciona: simplemente todos los precios están un 16% mal.

`products.price` en Wybix **incluye** IVA; `products.cost` **no**. El export del
sistema anterior puede traer cualquiera de las dos convenciones, y muchos traen las
dos mezcladas.

**No se adivina.** El asistente debe preguntarlo explícitamente, en un paso propio,
y mostrar tres productos de ejemplo con el resultado de cada interpretación para
que el cliente elija mirando números que reconoce.

### Existencias

Importar `stock` escribiéndolo en la ficha del producto deja el inventario **sin
rastro**: hay 40 unidades y ningún movimiento que las explique. El primer descuadre
es imposible de investigar.

**Lo correcto:** el stock inicial entra como un **conteo físico de apertura** —
Wybix ya tiene esa pantalla y ese concepto—, que genera sus movimientos de
inventario con referencia `MIGRACION`. A partir de ahí el kardex es completo desde
el día uno.

### Unidades e inventario por receta

Wybix tiene `base_uom`, `allow_decimal_qty` e `inventory_mode`. **Ningún sistema
de origen tiene esto.** No se debe intentar deducirlo.

Todo entra como `DIRECT` / `pza` / sin decimales, que es el comportamiento
histórico y el correcto para retail. La conversión a gramos, mililitros y recetas
es una decisión de negocio que el cliente toma después, producto por producto, con
la pantalla que ya existe. Un importador que "adivina" que "Leche 1L" debe ser
`ml` va a acertar en el 60% de los casos y a dejar un desastre en el 40%.

---

## 7. B) Conectores de base de datos

Técnicamente triviales: un driver por motor y una consulta. **Estratégicamente
caros**, y conviene ser honesto sobre por qué.

El costo no está en conectarse. Está en que, una vez conectado, hay que **entender
un esquema que nadie documentó**. Aspel SAE no se parece a Microsip, que no se
parece al POS que le programó un sobrino en 2014. Cada uno necesita su propio
mapeo, escrito por alguien que entienda ese sistema, y **mantenido** cuando el
fabricante cambia de versión.

Además:

- Pedir credenciales de la base del sistema anterior es una conversación incómoda y
  muchas veces imposible (el proveedor anterior no las da).
- Leer en caliente de un sistema en producción es un riesgo que el cliente no
  quiere correr.
- El cliente **no ve** lo que se va a importar hasta que ya pasó.

**Cuándo sí valen la pena:** cuando el mismo sistema de origen aparece por tercera
vez. Ahí el conector se paga solo. Antes, no.

**Y cuando se hagan, que no sean un camino aparte:** un conector debe leer y
producir **exactamente las mismas filas canónicas** que produce el lector de Excel,
y entrar por la misma validación y la misma vista previa. Un conector que escribe
directo en `products` es una segunda implementación de la migración, con sus
propios errores.

---

## 8. C) El asistente

Seis pasos, y **el orden importa**:

**1 · Respaldo.** Antes de nada, y no opcional. Wybix ya sabe respaldar la base
(`export-database`). Sin respaldo confirmado, el asistente no avanza.

**2 · Origen.** Archivo o conexión. Detección de codificación (los CSV mexicanos
vienen en Windows-1252 más veces que en UTF-8) y de separador.

**3 · Mapeo de columnas.** Cada columna del origen se asigna a un campo canónico.
Se propone automáticamente por similitud de nombre, y **el cliente confirma**. El
mapeo se guarda con nombre: la segunda importación del mismo cliente es un clic.

**4 · Reglas.** Los dos o tres interruptores que no se pueden adivinar: precios con
o sin IVA, qué hacer con duplicados, tasa por defecto.

**5 · Vista previa y validación.** La pantalla más importante del asistente:

- Cada fila: **válida**, **advertencia** o **error**.
- Un resumen honesto arriba: *"1 240 productos: 1 180 nuevos, 45 actualizan uno
  existente, 15 no se pueden importar"*.
- Se puede exportar el listado de errores a Excel para que el cliente lo corrija en
  su archivo y vuelva.
- **Nada se importa si hay errores sin resolver.** O se corrigen, o se excluyen
  explícitamente.

**6 · Importación.** Transaccional, con barra de progreso y un resumen final.

### Duplicados

La clave natural es `part_number`, que es UNIQUE. Tres políticas, elegidas en el
paso 4:

- **Omitir** el de origen (por defecto: no toca lo que ya existe)
- **Actualizar** el existente
- **Crear con sufijo** — para catálogos donde la clave de origen no es confiable

Y **detección de duplicados dentro del propio archivo**, que es más común: el mismo
`part_number` en dos filas del Excel. Eso es un error de la fila, no una decisión.

Duplicados por *nombre parecido* se señalan como **advertencia**, nunca se
fusionan solos. Fusionar dos productos que resultaron ser distintos no tiene vuelta
atrás.

---

## 9. Respaldo y reversión

Tres capas, y las tres hacen falta:

1. **Respaldo completo antes de empezar** (paso 1). Es la única reversión que
   funciona siempre.
2. **Transacción por lote.** Cada entidad se importa en una transacción: o entran
   las 1 240 filas o no entra ninguna. Nada de catálogos a medias.
3. **Sello de lote.** Cada fila importada lleva un `import_batch_id`. Permite
   *"deshacer la importación del martes"* sin restaurar el respaldo completo —
   siempre que no se haya vendido encima, que es la condición que el asistente debe
   comprobar antes de ofrecerlo.

La capa 3 es la que convierte la migración en algo que se puede intentar dos veces.
Sin ella, cada intento fallido cuesta una restauración completa y el cliente pierde
la confianza a la primera.

---

## 10. Recomendación final

**Modelo híbrido, pero por etapas y con las etapas en este orden.**

No es una respuesta de compromiso: es que las dos primeras etapas son las que
hacen posible la tercera.

### Etapa 1 — Excel, bien hecho *(lo que vale la pena construir ahora)*

Modelo canónico, mapeo de columnas, validación dura, vista previa honesta,
importación transaccional con sello de lote, y las tres reglas de §6 (IVA
explícito, stock como conteo, todo DIRECT/pza).

Cubre el **100% de los clientes**, porque todo sistema exporta a Excel. Ninguno
queda fuera esperando un conector.

### Etapa 2 — Reversión y repetibilidad

Deshacer un lote, y guardar el mapeo con nombre. Es lo que permite que la
migración se ensaye antes de hacerla en serio, que es como se hacen las
migraciones que salen bien.

### Etapa 3 — Conectores, sólo por demanda comprobada

Un conector por sistema de origen, **y sólo a partir del tercer cliente con ese
mismo sistema**. Se implementa como un adaptador más: lee, produce filas
canónicas, y entra por la misma validación y la misma vista previa de la etapa 1.

En México eso probablemente signifique **Aspel SAE / Aspel CAJA primero**, y
después ya se verá. Empezar por "soportar SQL Server, MySQL, PostgreSQL y SQLite"
es soportar cuatro *motores* y cero *sistemas*: el motor nunca fue el problema.

### Lo que NO conviene construir, en ninguna etapa

Un importador de ventas históricas hacia las tablas vivas. Si el cliente lo exige,
tabla de archivo separada y aislada de los reportes. La contabilidad de Wybix
empieza el día que arranca Wybix, y esa frontera limpia vale más que la comodidad
de tener todo en un solo lugar.

---

## 11. Riesgo aparte, encontrado durante este QA

No es de migración, pero afecta a cualquier cliente al que se le migre y se le
instale en una máquina nueva. Ver el informe de esta ronda: la huella de máquina
de la licencia (`generarMachineId`) incluye `os.hostname()`. **Renombrar el equipo
—o que falle la lectura del UUID de placa— cambia la huella, y la licencia pasa a
estado `tamper`, que bloquea la aplicación.** Conviene resolverlo antes de tener
clientes migrados en producción.
