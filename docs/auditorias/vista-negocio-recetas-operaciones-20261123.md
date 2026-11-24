# Auditoría: recetas y producción visuales, y operaciones que ahorran trabajo

Fecha: 23 de noviembre de 2026. Rama `feat/vista-negocio-recetas`, desde `origin/main` (72492c9).
Auditoría estática de código. No cambia lógica, datos ni contratos.

Dos objetivos:

1. Que las pantallas de **recetas por tamaño**, **fórmulas** y **producción** se vean menos genéricas y se
   entiendan con un vistazo, por ejemplo con la bebida preparándose mientras se arma la receta.
   La regla: **misma funcionalidad**. Mismos campos, mismos guardados, mismos `data-guide`.
2. Encontrar operaciones del cliente que se pueden acortar como ya se hizo con **registrar una compra
   subiendo el ticket** (0077).

## Conclusión

- **Recetas por tamaño.** Agregar un *escenario* SVG/CSS al lado de la tabla: un vaso que se llena por
  capas con los ingredientes de la receta, del tamaño de la variante elegida. Se dibuja a partir de los
  mismos `draftLines()` que ya se editan, así que no hace falta un dato nuevo. La tabla se queda: el
  dibujo explica y la tabla captura.
- **Fórmulas.** La frase «Para N piezas de X se usa» ya es buena. Le falta la imagen: una charola con
  las N piezas (con la ilustración del producto) y un tazón con lo que lleva. En el simulador, cada
  ingrediente se ve como un frasco que alcanza o no alcanza.
- **Producción.** El tablero ya está bien resuelto. Basta con darle a cada tarjeta la ilustración del
  producto y, a «En preparación», un horno con el tiempo que lleva.
- **Operaciones.** La de mayor impacto por menor esfuerzo es **Pedido sugerido → compra prellenada**:
  los datos ya existen (sensor de reorden) y el botón «Generar pedido» de Alertas hoy solo despliega la
  lista. Le siguen: **egresos con foto del recibo** (mismo OCR de compras) y **sugerido de producción**
  (el reorden, aplicado a las tandas).

## 1. Estado encontrado

### Recetas y modificadores — `src/hospitality/hospitality-admin.*`

- Tres columnas: productos con receta, editor e ingredientes disponibles (`hospitality-admin.html:30-174`).
- **Por tamaño**: chips «Base (todos los tamaños)» y uno por variante (`:64-78`). Las variantes son
  las opciones de los grupos de rol tamaño (`hospitality-admin.ts:225`). `sp_get_recipe` devuelve la
  receta de la variante o la base con `is_fallback = 1`, y la pantalla avisa «Este tamaño todavía usa
  la receta base».
- El editor es una **tabla**: ingrediente, cantidad, unidad, merma %, costo. Debajo van el costo por
  unidad y el margen sin IVA (`:85-134`).
- Hay todo lo necesario para dibujar:
  - `draftLines()` trae `ingredientName`, `inputQty`, `inputUom`, `baseUom`, `wastePct` y `cost`;
  - `factor(uom, baseUom)` convierte a la unidad base (`hospitality-admin.ts:190`);
  - `uoms()` tiene la dimensión (`VOLUME`, `WEIGHT`, `COUNT`, `LENGTH`);
  - `costoLinea()`, `costoReceta()` y `margen()` ya están calculados.
- **Modificadores**: cada opción tiene un efecto (`ADD`, `SUBSTITUTE`, `REMOVE`, `SCALE`), con su
  ingrediente y cantidad (`:249-300`). Hoy son selects y números; nada muestra qué le pasa a la bebida.
- No hay ninguna representación visual. Es la pantalla más genérica de las tres.

### Fórmulas de producción — `src/app/produccion/formulas.component.*`

- La frase «Para [−N+] piezas de X se usa:» y una lista de ingredientes con stepper, unidad y merma
  (`formulas.component.html:31-67`). Ya es menos genérica que Recetas.
- El **simulador** («si hoy haces N») calcula lo que pide la tanda, si alcanza y para cuántas alcanza
  (`:81-111`). Es texto con píldoras «✓ alcanza» o «faltan…».
- El costo por pieza y el margen se calculan en vivo.

### Producción de hoy — `src/app/produccion/produccion.component.*`

- Tablero de tres columnas: Planeado, En preparación y Listo para vender (`produccion.component.html:40-83`).
- Una hoja con teclado numérico para planear, empezar y pasar a listo, con merma y motivo (`:88-156`).
- Las tarjetas solo tienen texto: nombre, número y pie.

### Compras con ticket (referencia) — 0077

- `electron/ipc/compras-documentos.js` lee una foto con OCR local (`electron/ocr/motor.cjs`,
  `ticket.cjs`) o el XML del SAT (`cfdi.cjs`). Propone proveedor y productos y **aprende**, por
  proveedor, qué producto es cada renglón.
- `compra-documento.component` no registra nada. Enseña, deja corregir y pasa los renglones a la
  compra de siempre. Ese patrón («lee, propone, la persona confirma, se aprende») es el que conviene
  repetir.

### Otras operaciones revisadas

| Operación | Dónde | Estado |
|---|---|---|
| Reorden inteligente | `src/alertas/alertas.ts:1069`; sensor `reorden` (`electron/asistente/acciones/compras.js:6-23`) | Calcula `sugerido` y días que alcanza. El asistente ya arma «Pedido sugerido para <proveedor>». En Alertas, el botón **«Generar pedido» solo despliega la tabla** (`alertas.ts:369`); no llega a Compras |
| Registrar compra | `src/compras/appRegistrarCompra/` | Con ticket/XML (0077) y precio sugerido de venta. No recibe renglones prellenados desde otra pantalla |
| Egresos | `src/egresos/egresos.html:173-214` | Captura manual: concepto, persona, periodo, forma de pago, monto. **Sin foto ni XML** del recibo |
| Proveedores / por pagar | `src/app/proveedores/` | Saldo por pagar visible. No revisé vencimientos |
| Conteo | `src/conteo/conteo.ts` | Busca por código de barras. No revisé escaneo continuo |

## 2. Propuestas de interfaz (misma funcionalidad)

Reglas para las tres pantallas:

- **El dibujo no captura nada.** Sale de los mismos signals y es `aria-hidden`; la tabla o lista
  sigue siendo la fuente. Ningún guardado ni validación cambia.
- **Movimiento reducido** (CLAUDE.md, Wybix Guide §7): con `prefers-reduced-motion` las capas
  aparecen sin animación.
- **Sin `<select>` nativo** y con los `wx-*` existentes. Los `data-guide` actuales no se tocan, porque
  los recorridos del asistente y las e2e dependen de ellos.
- **Reusar las ilustraciones** (`shared/ilustraciones.ts`, `wx-ilustracion`) para ingredientes y
  productos. Ya son vectoriales y deterministas.
- Ligero: un solo SVG por pantalla, recalculado con un `computed()` y no en cada ciclo de detección.

### 2.1 Recetas por tamaño: «la bebida se prepara»

Un panel **escenario** sobre la tabla, o a su lado en pantallas anchas:

- **El recipiente según el producto.** `formaDe()` del producto da su familia:
  - bebidas → vaso (frío con tapa domo si el nombre dice frappé o helado; taza si es caliente);
  - comida → plato;
  - lo demás → tazón genérico.

  Un taller o una papelería no ven esta pantalla: solo es para Hospitality (`:20`).
- **El tamaño de la variante.** Se lee el volumen del nombre de la opción («Chico 12 oz»,
  «Grande 500 ml»); si no lo trae, se escala por el orden de las variantes. Base = tamaño medio. Al
  cambiar de chip, el vaso crece o se encoge con una transición de 250 ms.
- **Capas.**
  - Cada ingrediente de volumen (dimensión `VOLUME`) es una capa, con altura proporcional a su
    cantidad en unidad base respecto a la capacidad del vaso. Si se pasa, el vaso se desborda y aparece
    el aviso «Más que el vaso».
  - Los de peso o pieza (shot, jarabe en g, galleta, crema) se dibujan como toppings, gotas o trozos
    encima, con su ilustración.
  - El color sale de la ilustración del ingrediente (leche → crema, café → café, fresa → rosa). Sin
    pista, toma un tono estable por id.
- **En vivo.**
  - Agregar un ingrediente lo «vierte»: la capa sube desde el fondo.
  - Cambiar la cantidad cambia la altura.
  - Quitarlo baja la capa.
  - La merma se ve como un borde punteado sobre la capa (lo que se tira).
- **Rótulos al lado del vaso.** Nombre y cantidad de cada capa, y abajo el costo y el margen que ya
  existen. Con `is_fallback`, el vaso sale en gris con «usa la receta base».
- **Comparar tamaños.** Una tira de miniaturas (Chico · Mediano · Grande) con su costo y margen, para
  ver de un golpe si el grande deja menos margen que el chico. Sale de llamar a `getRecipe` por
  variante, que ya existe. Solo lectura.

**Modificadores**, en la misma pestaña: al lado de cada opción, un mini vaso con el efecto:

| Efecto | Dibujo |
|---|---|
| `ADD` | capa o topping nuevo con «+» |
| `REMOVE` | la capa tachada |
| `SUBSTITUTE` | la capa cambia de color, con una flecha |
| `SCALE` | el vaso entero «×1.5» |

Así se entiende sin leer el select.

### 2.2 Fórmulas: la charola y el tazón

- Junto a «Para N piezas…», una **charola** con N piezas usando la ilustración del producto (hasta
  24 dibujadas y «+n» después). El stepper de rinde la llena o la vacía.
- Los ingredientes caen en un **tazón**, proporcional a su peso o volumen en unidad base.
- **Simulador:** cada ingrediente es un frasco que muestra lo que hay contra lo que pide la tanda. Si
  falta, se ve el faltante en rojo. «Alcanza para X» se ve en la charola: piezas llenas contra piezas
  en contorno.
- Los cálculos (`simulacion()`, costo, margen) no cambian.

### 2.3 Producción: tarjetas con identidad

- Cada tarjeta lleva la ilustración del producto (es la misma de Venta y Touch: se reconoce).
- **En preparación:** un horno o comal con brillo suave y «hace 25 min», que sale de `started_at`.
  Planeado lleva el contorno de la pieza; Listo, la pieza con ✓.
- La hoja numérica muestra la charola de 2.2 llenándose con el número tecleado (12 piezas = una
  docena visible).

## 3. Operaciones que ahorran trabajo (como compras con ticket)

Ordenadas por impacto entre esfuerzo. Lo marcado **verificado** está leído en el código; lo marcado
*por confirmar* falta revisarlo antes de diseñar.

| # | Propuesta | Ahorro | Esfuerzo | Base existente |
|---|---|---|---|---|
| 1 | **Pedido sugerido → compra prellenada.** «Generar pedido» en Alertas (y en el asistente) abre Registrar compra con proveedor y renglones del sugerido; la persona ajusta y registra como siempre. Opcional: mandar el pedido al proveedor por WhatsApp | Alto: hoy se copia a mano lista por lista | Bajo-medio | **Verificado**: sensor `reorden` con `sugerido`, pedido por proveedor en el asistente; `alertas.ts:369` solo despliega |
| 2 | **Recepción contra pedido.** Al subir el ticket de esa compra, marcar lo que llegó incompleto o de más contra lo pedido | Medio | Medio | Depende de 1; 0077 ya lee el ticket |
| 3 | **Egresos con foto del recibo o XML** (luz, gas, renta, servicios): propone concepto, monto, fecha y proveedor, y aprende el concepto por emisor | Medio-alto en negocios con muchos gastos | Medio | **Verificado**: OCR local y `leerCfdi` reutilizables; Egresos es captura manual |
| 4 | **Sugerido de producción.** Para cada producto con fórmula, «hoy conviene hacer N» según lo vendido el mismo día de la semana y lo que quedó ayer; un toque lo planea | Alto en panaderías y donas | Medio | Tablero y fórmulas **verificados**; promedio por día de semana *por confirmar* en SQL |
| 5 | **Fórmula o receta desde la foto del cuaderno.** La pantalla ya dice «escríbela como la tienes en el cuaderno»: leerla con el mismo OCR y proponer los ingredientes del inventario | Medio (solo al dar de alta) | Medio-alto (letra a mano) | OCR **verificado**; la calidad con letra manuscrita está *por confirmar* |
| 6 | **Recordatorio de pagos a proveedores** por vencer, desde «Por pagar» | Medio | Bajo | Saldo **verificado**; vencimientos *por confirmar* |
| 7 | **Conteo por escaneo continuo** (escanear y sumar sin tocar la pantalla) | Medio | Bajo | Búsqueda por código **verificada**; el modo continuo está *por confirmar* |

Las propuestas 1, 3 y 5 siguen el patrón de 0077: **leer o calcular, proponer, la persona confirma y
se aprende**. Ninguna mueve inventario ni dinero sin el botón de siempre.

## 4. Riesgos

- **Rendimiento:** el vaso se recalcula con cada tecla. Debe ser un `computed()` sobre `draftLines()`
  y unas decenas de nodos SVG, sin animar `height` en bucle. Transformaciones y opacidad, nada más.
- **Datos raros:** recetas sin volumen (todo en g), cantidades enormes o un vaso de 2 L. El dibujo
  satura con un tope y avisa; nunca bloquea guardar.
- **Leer el tamaño del nombre** falla con nombres libres («Venti»). Hay que caer al orden de las
  variantes y no inventar mililitros.
- **Contratos de prueba:** las e2e y los recorridos del asistente usan los `data-guide` de estas
  pantallas. No se renombran; lo nuevo lleva sus propios `data-guide`.
- **Pedido prellenado (1):** el precio de la compra lo sigue capturando la persona. El sugerido no
  inventa costos: usa el último costo y se marca como sugerido.

## 5. Orden propuesto

1. Recetas por tamaño con el vaso, más los mini vasos de modificadores (2.1).
2. Pedido sugerido → compra prellenada (3.1).
3. Fórmulas y producción con charola, tazón y horno (2.2 y 2.3).
4. Egresos con foto o XML (3.3) y sugerido de producción (3.4).

Cada paso, con prueba: e2e de recetas por tamaño (las capas cambian con la cantidad y el guardado es
el de siempre), e2e de pedido sugerido (abre la compra con sus renglones y registra) y las pruebas
existentes de producción.
