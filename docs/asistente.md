# Wybix, asistente operativo

Diseño completo y decisiones: `docs/arquitectura/asistente-operativo.md`.
Esto es la guía de lo que está construido.

## Qué hace hoy

- **Revisa el negocio** cada 10 minutos (y poco después de una venta) con
  reglas, sin IA generativa. Lo que encuentra queda como *hallazgo* con su
  evidencia y sus acciones.
- **Avisa sin interrumpir**: la mascota del dock muestra cuántos pendientes
  nuevos hay; Inicio dice el más urgente (se toca y abre el chat sobre él).
- **Conversa de todo el negocio** en el chat del dock: venta, caja,
  inventario, compras, proveedores, clientes, gastos, finanzas, facturación,
  personal, y lo propio de cada giro (producción, mesas y cocina; citas,
  profesionales y membresías). Español de mostrador, con jerga y dedazos.
- **Recuerda la plática**: «¿cuánto vendí hoy?» → «¿y ayer?»; «¿cuántas
  conchas quedan?» → «¿y cuánto le gano?».
- **Pregunta lo que falta** con botones y **nunca adivina** un producto o
  una persona: si duda, ofrece opciones.
- **Propone, no ejecuta**: cada acción llega como tarjeta con antes y
  después. Al **Confirmar**, la pantalla ejecuta con la API de siempre
  (permisos y PIN de encargado incluidos) y queda en la bitácora.
- **Lo delicado, en su pantalla**: cobrar, devolver, facturar, cancelar una
  factura y hacer el corte. Wybix explica cómo y lleva ahí. «Cóbrale 2
  cocas» deja la cuenta ya cargada en Venta (un producto con opciones no se
  carga a ciegas: lo avisa).
- **Contesta lo que no tiene escrito** (`analitica/`):
  - *filtros combinados*: «¿cuánto vendí de refrescos los sábados después de
    las 6 con tarjeta?», «en octubre», «del 1 al 15», «lo que cobró Ana»;
    «¿y en efectivo?» suma el filtro a la pregunta anterior.
  - *«¿por qué?»*: separa «vinieron menos clientes» de «gastaron menos» y dice
    dónde se concentró (producto, día, hora, cajero, forma de pago).
  - *pronóstico*: «¿cuánto voy a vender el sábado?», «¿cuántas conchas hago
    mañana?» (con botón para planear la producción).
  - *cuándo se acaba*: «¿para cuántos días me alcanza la leche?».
  - *«¿y si…?»*: «si subo la concha a $14, ¿cuánto gano?» — la ganancia con el
    precio nuevo y el punto de equilibrio; no inventa cuántos clientes se van.
- **Varias cosas en una frase**: «registra $500 de luz y dime cuánto me queda
  en caja» se contesta por partes, en orden.
- **Aprende el idioma del negocio**: «a la coca de 600 dile la roja» (con
  tarjeta), y si preguntó «¿cuál?» y la persona eligió, aprende solo el apodo
  y lo dice. «Olvida la roja» lo borra.
- **El resumen del día** al abrir el chat: cómo cerró ayer, cuánto se espera
  hoy, lo urgente y quién lleva semanas sin pagar; en la tarde, «es tu mejor
  martes en 8 semanas».
- **No contesta siempre igual**: varias formas de decir lo frecuente
  (`acciones/voz.js`), deterministas por conversación y turno.
- **Dictado sin internet** (opcional): micrófono en el chat con Vosk; la voz
  no sale de la caja. Ver «Dictado» abajo.
- **Preguntas libres** (`lenguaje/pregunta.js`, intent `analisis.libre`):
  cualquier combinación de qué medir (ventas, piezas, ganancia, tickets,
  ticket promedio) × cómo agrupar (producto, categoría, hora, día de la
  semana, día, cajero, forma de pago, cliente) × orden («lo que menos», «top
  3») × filtros. «¿Qué categoría deja más ganancia los domingos en la
  tarde?», «¿a qué hora vendo menos?». Y comparar: «café contra concha»,
  «octubre contra septiembre», «esta semana contra la pasada». Si un intent
  ya contesta exactamente eso («¿qué se vende más?»), se queda con él.
- **Habla de su respuesta anterior** (`lenguaje/referencias.js`):
  «dime más del segundo», «¿y el último?», «¿cuánto deja ese?» (un renglón de
  la lista que acaba de dar); «no, me refería a la grande», «mejor de ayer»,
  «no, eran 3» (corrige un dato y vuelve a contestar u ofrece otra tarjeta);
  «¿por qué?» después de un número (lo explica); «¿cómo lo calculaste?»
  (periodo, filtros, de cuántos tickets y cómo).
- **Gráficas en el mensaje** (`wx-grafica-chat`): barras o línea con los
  mismos números de la lista; sin librerías y sin animación.
- **Observaciones**: si en el periodo hubo un día raro contra ese mismo día
  de la semana en las 8 semanas anteriores, lo dice («Ojo: el martes 11
  vendiste 45% menos que un martes normal. ¿Cerraste ese día?»).
- **Preferencias por persona** (`asistente_preferencias`, 0084): «llámame
  Jesús», «no me des el resumen», «sin gráficas», «no me des
  observaciones», «léeme las respuestas», «olvida mis preferencias».
- **Altas habladas**: «da de alta un producto Dona glaseada a 18 en
  panadería» pregunta el costo y la existencia (una vez; «no sé» / «ninguno»
  los salta) y arma la tarjeta con todo.
- **Lee en voz alta** (opcional): bocina en cada respuesta y «léeme las
  respuestas». Ver «Wybix habla» abajo.
- **LLM local**: diseño y plan en `docs/asistente-llm-local.md` (sin
  implementar).

| Reglas (packs) | |
|---|---|
| `core` | se acabó con demanda · se acaba en ≤ 3 días (dice qué ingrediente limita) · sin venderse 60 días · se vende con pérdida · poca ganancia (% sobre el costo) · productos sin costo · compra más cara sin subir precio · descuadres repetidos |
| `hospitality` | ingredientes > 40 % del precio · recetas con ingredientes sin costo · no alcanza para la producción de hoy |
| `sistema` (doctor) | respaldo viejo o fallido · nube atrasada · licencia (prueba, gracia, Venta Esencial) · reloj · impresora · disco |

### Lo que entiende (81 intents)

| Área | Consultas | Acciones (Confirmar) | En su pantalla |
|---|---|---|---|
| Venta | cuánto vendí (hoy, ayer, semana, mes, año, «la semana pasada») · lo más vendido y cuánto de un producto · por forma de pago · hora y día pico · contra antes, con qué subió o bajó · buscar un ticket · «¿cuánto es 3 cocas y 2 sabritas?» | — | cobrar · devolución |
| Caja | cuánto hay en caja (por caja) · cortes y faltantes · quién tiene la caja | entrada de efectivo · retiro | corte |
| Inventario | existencia · precio y datos · agotados · lo que no se mueve · valor del inventario · movimientos | ajuste (conteo) · merma · precio · alta de producto | traspaso |
| Compras | qué comprar · pedido para un proveedor · última compra y su costo · cuánto he comprado | — | registrar compra |
| Proveedores | a quién le debo · quién me surte X · su contacto | pago · alta | — |
| Clientes | quién me debe (fiado) · ficha · mejores clientes · puntos · cumpleaños | abono (a una nota) · alta | — |
| Gastos | en qué se va el dinero | registrar gasto (luz, renta, sueldos…) | — |
| Finanzas | ganancia de lo vendido · lo que queda después de gastos | — | — |
| Facturación | facturas del periodo y con error | — | facturar · cancelar |
| Personal | quién vino · ventas por cajero | — | — |
| Hospitality | qué falta para producir · producción del día · mesas · cuenta de una mesa · cocina · receta · pedidos en línea · propinas | planear producción | — |
| Servicios | citas · huecos libres · lo que generó cada profesional · membresías por vencer · órdenes abiertas | agendar · cancelar · mover cita | — |
| Análisis | cuánto voy a vender · cuándo se acaba · «¿y si cambio el precio?» · «¿por qué?» (venta.comparar) | — | — |
| General | pendientes · estado del sistema · «¿cómo hago…?» · ir a una pantalla · ayuda · saludo (el resumen del día) | apodos (enseñar · olvidar) | — |

Los intents de un módulo (hospitality, servicios, loyalty, asistencia) solo
existen si el negocio lo tiene encendido.

Las consultas de venta que declaran `analitica` (cuánto vendí, lo más
vendido, por forma de pago, por hora, ganancia, por cajero) aceptan
**filtros**; con filtros las contesta el cubo en lugar de su SQL fijo.

## Cómo entiende (sin IA generativa)

```
texto → ¿varias órdenes? partir donde empieza otra («… y dime …») y contestar cada una
      → ¿enseña un apodo? («a X dile Y») → regla, no predicción
      → normalizar (números con letra, docenas, acentos)
      → corregir dedazos (solo hacia palabras frecuentes o del catálogo; nunca una conjugación)
      → extraer: dinero · cantidades · fecha · hora · folio · mesa · forma de pago · teléfono
                 filtros (días, horas, categoría, cajero, rango de fechas)
                 producto (catálogo + apodos) · persona (clientes, proveedores, profesionales + apodos)
      → marcar: <num> <dinero> <prod> <cliente> <proveedor> <profesional>
      → clasificar:  naive Bayes + vecinos más parecidos (kNN)
                     sobre palabras, lemas («cancelala» = «cancelar») y CONCEPTOS del léxico
      → ajustar:     palabras clave · señales (patrones de frase precisos)
                     · encaje (¿la frase trae lo que el intent necesita? ¿la persona es del tipo?)
                     · fuera de tema (palabras que nunca vio y ningún dato → baja la seguridad)
      → llenar los datos · heredar del contexto lo que falte · preguntar lo dudoso
```

- **Léxico** (`lenguaje/lexico.js`): cada palabra apunta a un concepto
  (#DINERO, #DEBER, #CANCELAR…). Es lo que deja entender palabras que no
  están en ninguna frase de entrenamiento («morralla», «feria», «lana»).
- **Señales** (`lenguaje/senales.js`): «de qué está hecho» es receta, «la 4
  pide la cuenta» es una mesa. Suman al intent y restan a los demás.
- **Tipo de persona**: «¿cuánto me debe doña Mary?» es fiado y «¿cuánto le
  debo a Bimbo?» es una cuenta por pagar: lo decide el catálogo, no la frase.

## Dónde vive

```
shared/asistente.ts                 contratos (Hallazgo, Plan, Mensaje…)
electron/asistente/
  index.js                          arma todo; catálogos (productos, personas, conceptos); servicio por empresa
  motor.js · sensores.js · packs/   reglas → hallazgos
  store.js                          tablas 0082 (hallazgos, planes, bitácora, chat, frases, apodos)
  acciones/<área>.js                respuestas y planes con vista previa, un archivo por área
  acciones/analisis.js              el cubo con filtros, «¿por qué?», pronóstico, agotamiento, «¿y si…?»
  acciones/resumen.js · voz.js      el resumen del día · las varias formas de decir algo
  conversacion.js                   el chat: pregunta pendiente, contexto, frases compuestas, aprender apodos
  analitica/
    cubo.js                         pregunta con filtros → UN SQL parametrizado (medidas y dimensiones como datos)
    periodos.js · explicar.js       fechas de un periodo · la descomposición del «¿por qué?»
    pronostico.js · simular.js      mismos días de la semana + tendencia · ganancia y punto de equilibrio
  lenguaje/
    intents/<área>.js               lo que sabe hacer, como datos (+ destinos.js)
    frases/*.txt                    FRASES COMPLETAS de entrenamiento, anotadas
    lexico.js · senales.js          la parte «semántica», escrita a mano
    filtros.js · apodos.js · compuesto.js   filtros combinados · «dile la roja» · partir frases
    normalizar · extractores · marcas · clasificador · corpus · interprete
electron/ipc/asistente.js           canales asistente:* (incluye alias y voz)
src/core/asistente.service.ts       la pantalla; ejecuta los planes confirmados y carga el carrito
src/core/dictado.service.ts         el dictado sin internet (Vosk)
src/app/wx-guia/wx-wybix-chat.*     el chat (pestaña «Chat» del panel de Wybix)
scripts/asistente/                  entrenar.mjs (loop) · giros.mjs (catálogos de prueba) · casos.mjs · humo-sql.mjs
```

## Agregar algo que Wybix entienda

1. Un intent en `lenguaje/intents/<área>.js` (slots, claves, plantillas).
2. Su respuesta o plan en `acciones/<área>.js`.
3. **Frases completas** en `lenguaje/frases/<área>.txt`, como las diría la
   gente, con el producto entre `[corchetes]` y la persona entre `{llaves}`
   (`{pedro:pro}` fija el tipo si hace falta). Que nombren productos y
   personas de `scripts/asistente/giros.mjs`.
4. Palabras nuevas de jerga a su concepto en `lexico.js`; si hay un patrón
   inconfundible, una señal en `senales.js`.
5. `npm run asistente:entrenar` hasta cumplir la meta.

## Todo lo que se hace a mano, lo hace el asistente

**La regla:** cada operación que una persona puede hacer en una pantalla, el
asistente la tiene que poder hacer. Las excepciones son a propósito y con
motivo.

### El mapa: `electron/asistente/cobertura.js`

Cada canal protegido de `electron/seguridad/canales.js` está en uno de estos
lugares:

| Dónde | Qué quiere decir |
|---|---|
| Lo hace el asistente | **No se escribe a mano: se calcula.** Algún plan de `acciones/` llama a la función de preload que invoca ese canal. |
| `LECTURA` | El canal solo lee. No es una acción. |
| `MANUAL` | A propósito no lo hace el asistente, con motivo: un archivo, un secreto, hardware o algo irreversible. |
| `PENDIENTE` | Falta. Es la lista de trabajo, por área. |

`node --test scripts/pruebas/asistente-cobertura.test.mjs` (dentro de
`npm run test:asistente`) falla en estos casos:

- un canal nuevo que no está en ninguna parte (nadie decidió);
- un canal que el asistente ya cubre y sigue en `PENDIENTE`;
- un canal `MANUAL` que el asistente hace;
- un canal `MANUAL` sin motivo;
- la lista nombra un canal que ya no existe.

Además imprime el avance, por ejemplo «asistente: 94 de 171 acciones (55 %)».

**El asistente no llama SPs directo.** Un plan se ejecuta desde la pantalla
con la misma función de `preload`. Así pasa por el mismo canal: permisos,
autorizaciones, candados de sucursal, bitácora, nube e impresión.

Cuando la operación tiene efectos que viven en la pantalla, el plan dice
`pantalla.<método>` y lo atiende `AsistenteService`. Cada uno se declara en
`PANTALLA` (`cobertura.js`) con el canal que termina invocando. La prueba
comprueba que el método exista. Hoy solo hay uno: `pantalla.cobrar` →
`sp-register-sale`.

### Editar una ficha hablando

Lo reconoce una **regla** en `lenguaje/edicion.js`, no el clasificador. Los
campos de cada entidad viven en `acciones/entidades.js`: etiqueta, cómo se lee
el valor actual, validación, permiso y el payload del canal. Agregar un campo
es una entrada ahí y su forma de decirlo en `edicion.js`.

Hoy, del producto:

| Frase | Qué hace |
|---|---|
| «cambia el costo de la concha a 8», «el costo de la concha es 8» | Costo sin IVA. Pide `VER_COSTOS`. La tarjeta muestra cómo queda la ganancia. |
| «ponle el código de barras 750… a la coca», «quítale el código de barras a…» | Código de barras. Rechaza uno que ya tiene otro producto. |
| «cambia el SKU de la concha a PAN-001» | Número de parte. |
| «renombra la concha a Concha de vainilla» | Nombre, con sus acentos y mayúsculas. |
| «ponle IVA 16 a la coca», «la coca va sin IVA» | 16 %, 8 % o exento. |
| «ponle IEPS 8% a las papas», «quítale el IEPS a…» | Otros impuestos (`producto:impuestos-guardar`). Uno por cuota pide cuánto trae una pieza. |
| «da de baja la concha», «ya no vendo la concha» | Baja lógica (`sp-delete-product`). «Dar de baja 5 conchas» sigue siendo merma. |

**El producto también se nombra por su código de barras o su SKU:**
«cambia el costo del 7501055300846 a 9.50», «ponle 25 pesos al
7501055300846». El intérprete lo busca antes que por nombre y no lo confunde
con una cantidad. Si el código lo tienen dos productos, pregunta cuál.

Si falta el valor («cambia el costo de la concha»), pregunta nombrando el
campo («¿A qué costo, sin IVA?»).

### Caja y ventas hablando

La caja es la de **este equipo** (`device-config` → `register`), la misma que
usan Venta y Corte. El asistente la recibe como `equipo` en `crearAsistente`.

| Frase | Qué hace |
|---|---|
| «abre la caja con 500» | Abre el turno (`sp-open-shift`). Si ya está abierta, lo dice. |
| «haz el corte, conté 3,250» | Cierra el turno propio (`sp-close-shift`). La tarjeta muestra lo esperado con la misma suma que `sp_close_shift` (fondo + movimientos). Corte ciego para quien no es encargado: no ve lo esperado. El turno de otra persona se cierra en Corte, con PIN. Avisa si parece que no contó el fondo. |
| «abre el cajón» | Apertura sin venta (`open-cash-drawer`). La autoriza un encargado y queda en bitácora. |
| «manda el corte por correo» | El último corte de esta caja (`corte:correo-enviar`). |
| «reimprime el ticket 1234», «… el último ticket» | `print-sale-ticket`. «El último» es la última venta de esta caja. |
| «devuelve el ticket 120, venía en mal estado», «devuelve 2 cocas del ticket 120» | `sp-refund-sale` con lo que todavía se puede devolver y el motivo, con las mismas etiquetas que la pantalla. La tarjeta anticipa por dónde regresa el dinero. Sin folio o sin motivo, los pregunta. |
| «cóbrale 2 cocas en efectivo, me dio 100», «cobra 3 conchas con tarjeta» | Cobra desde el chat. La tarjeta trae el total **con las ofertas de hoy** (el mismo motor comercial) y el cambio. Al confirmar, `AsistenteService.cobrar` hace la venta con `SaleService.checkout` en una cuenta aparte: turno, ticket, cajón, premios y cupones, igual que el botón Cobrar. La cuenta abierta en la caja no se toca. Si el total ya no es el de la tarjeta, no cobra. |

Sin forma de pago, «cóbrale 2 cocas» deja la cuenta cargada en Venta. Un
producto con opciones (tamaño, sabor) también se cobra en Venta.

### Clientes, proveedores, compras y catálogo

| Frase | Qué hace |
|---|---|
| «cambia el teléfono de doña Mary a 55…», «el correo de Bimbo es …», «ponle límite de crédito de 2000 a doña Mary», «dale 30 días de crédito a…», «cambia el RFC de…», «renombra al cliente Juan a …» | Ficha del cliente (`sp-update-customer`, con la ficha completa) o del proveedor (`sp-supplier-save`). Regla `edicionPersona` en `edicion.js`; solo entra si la persona existe. Límite y días piden «Crédito y cupones», como la pantalla. |
| «compré 24 cocas a 12 a Coca-Cola», «llegó el pedido de Bimbo: 30 conchas a 6 y 10 sabritas a 14 en efectivo» | Compra (`sp-register-purchase`). Costo **sin IVA** por pieza; sin costo usa el anterior. Sin forma de pago queda a crédito. `sp_register_purchase` recalcula el precio de venta con el margen de cada renglón: el asistente manda el margen que **deja el precio de ahora**. Si el costo nuevo no cabe, el precio sube a costo + IVA y la tarjeta lo dice. Avisa si hoy ya hay una compra de ese proveedor. |
| «crea la categoría Lácteos», «agrega la marca Lala» | `sp-add-category`, `sp-add-brand`. Rechaza una que ya existe. |
| «Bimbo me surte las conchas», «el proveedor principal de la concha es Bimbo», «Bimbo ya no me surte las conchas» | Proveedores del producto (`sp-upsert-product-supplier`, `sp-set-product-default-supplier`, `sp-remove-product-supplier`). Reglas en `lenguaje/catalogo.js`. |

`EQUIVALE` (`cobertura.js`) marca un canal que hace lo mismo que otro ya
cubierto: el alta rápida de proveedor de Inventario (`sp-add-supplier`) es la
misma alta que `sp-supplier-save`. La prueba exige que el de la derecha esté
cubierto.

### Producción, socios, propinas y gastos

| Frase | Qué hace |
|---|---|
| «empieza la tanda de conchas», «salieron 48 conchas», «cancela la tanda de conchas» | Tandas (`wybix.produccion.empezar / terminar / cancelar`). Se empieza una planeada (salen los ingredientes), se termina una en proceso y lo que falta es merma: pregunta el motivo. Solo se cancela una planeada. |
| «Juan retiró 500 de la caja», «Ana aportó 2,000», «le pagué 1,000 a Juan por transferencia» | Movimiento de socio (`socios:movimiento`). Un retiro sin decir cómo sale del cajón. |
| «la compra 45 la pagó Juan», «el gasto 12 es de Ana», «el gasto 12 lo pagó Juan» | `socios:compra`, `socios:gasto`. Un gasto en efectivo lo pagó el negocio. |
| «liquida a los socios» | `socios:liquidar` hasta ayer. La tarjeta trae el saldo de cada uno (`sp_socios_resumen`). |
| «reparte las propinas» | La tarjeta trae el cálculo de `sp_propinas_repartir` sin confirmar; al confirmar, el mismo procedimiento paga y cierra. |
| «cancela el gasto 12, era de otra sucursal», «crea el concepto de gasto Papelería», «renombra el concepto Luz a Luz y agua», «desactiva el concepto Gasolina» | `egresos:cancelar` (pide el motivo) y `egresos:concepto-guardar`. |

Los socios no están en el catálogo de personas: el intérprete recibe la lista de
socios activos y la regla (`lenguaje/socios.js`) solo entra si el nombre
dicho es de uno. «El cajero sacó 300» no es un socio. Sin la aplicación de
Socios o Propinas encendida, esas frases no se entienden como suyas.

### Servicios

Reglas en `lenguaje/servicios.js`. Solo con Servicios encendido, y solo si la
persona (cliente o profesional) o el servicio existen: si no, la frase sigue
su camino («Pedro trabaja de 9 a 6» no es un horario si Pedro no es
profesional).

| Frase | Qué hace |
|---|---|
| «abre una orden para doña Mary: no prende la licuadora» | `servicios:orden-crear` (abierta, en esta caja). |
| «la orden 12 ya está lista», «la orden 12 está en proceso», «entrega la orden 12» | `servicios:orden-estado`. Entregar pide que esté cobrada. |
| «el cliente autorizó la orden 12 por teléfono» | `servicios:orden-autorizar` (mostrador, teléfono o WhatsApp). |
| «cancela la orden 12, ya no lo quiso» | `servicios:orden-cancelar`; sin motivo, lo pregunta. |
| «el diagnóstico de la orden 12 es: falla el motor» | `servicios:orden-actualizar` con el resto de la orden igual. |
| «ponle 2 balatas a la orden 12», «el cambio de aceite de la orden 12 ya está hecho / a 350» | `servicios:linea-agregar`, `servicios:linea-actualizar`. |
| «llegó doña Mary a su cita» | `servicios:cita-a-orden` con su cita de hoy. |
| «crea el servicio Corte de dama a 250 de 45 minutos», «desactiva el servicio Tinte» | `servicios:guardar-servicio`, `servicios:activar-servicio`. |
| «mi negocio es una barbería» | `servicios:elegir-giro`. |
| «registra el carro de doña Mary: Nissan Versa 2018 placas ABC1234» | `servicios:guardar-activo` (vehículo, mascota, equipo o inmueble). |
| «da de alta a la estilista Paola Ruiz», «desactiva a Laura» | `servicios:guardar-profesional`, `servicios:activar-profesional`. |
| «Laura hace cortes», «Laura ya no hace tintes» | `servicios:asignar-profesionales` con la lista completa del servicio. |
| «Laura trabaja de lunes a viernes de 9 a 6», «… los sábados de 10 a 2» | `servicios:guardar-horario`: esos días se reemplazan, los demás se quedan. |
| «Laura no viene el viernes», «Laura sale de vacaciones del 1 al 15 de diciembre», «siempre sí viene Laura el viernes» | `servicios:guardar-ausencia`, `servicios:borrar-ausencia`. Avisa de sus citas esos días. |

Los cambios a una orden llevan su testigo de versión (`rowver`): si alguien la
cambió entre la tarjeta y el «Confirmar», el canal lo rechaza.

### Fidelización

Reglas en `lenguaje/fidelizacion.js`.

| Frase | Qué hace |
|---|---|
| «ponle 100 puntos a doña Mary porque se le cobró doble», «quítale 50 puntos a doña Mary» | `puntos:ajustar`, con el saldo antes → después. No deja saldo negativo. |
| «cancela la membresía de doña Mary» | `club:gestionar` (CANCELAR) sobre su membresía activa. |
| «cierra la rifa de Navidad», «sortea la rifa de Navidad con 3 ganadores» | `raffles:close`, `raffles:draw`. Sortear pide que esté cerrada y es irreversible. |
| «dale a doña Mary un cupón de 10%», «genera 20 cupones de 2x1» | `coupons:issue` con la definición que coincide por nombre, % o monto. |
| «da 1 punto por cada 10 pesos», «los puntos caducan a los 12 meses», «apaga los puntos» | `puntos:config-guardar` con la configuración completa y solo ese cambio. |

A propósito manuales: el canje del cupón (lo hace el cobro), escanear el pase
de la cartera y girar la ruleta (lo hace el cliente).

### Mesas, comandas, salón y estaciones (Hospitality)

Reglas en `lenguaje/mesas.js`, solo con Hospitality encendido. La mesa se busca
por su nombre o su número («4», «mesa 4», «terraza 2»).

| Frase | Qué hace |
|---|---|
| «abre la mesa 4 para 3», «abre una cuenta para llevar a nombre de Juan» | `cuentas:abrir`. Una mesa abierta no se abre otra vez. |
| «la mesa 4 pide 2 tacos y una coca», «manda 3 aguas a la mesa 4» | `cuentas:enviar`: el mismo envío que la caja (comanda por estación, impresión). Un producto con opciones se manda desde la caja. |
| «la mesa 4 pidió la cuenta», «la mesa 4 es de doña Mary», «libera la mesa 4» | `cuentas:estado`, `cuentas:cliente`, `cuentas:liberar` (solo sin consumo). |
| «la comanda 12 ya está lista», «cancela la comanda 12, se quemó», «reimprime la comanda 12» | `kds:estado` (solo hacia adelante), `comandas:cancelar`, `comandas:reimprimir`. |
| «crea el área Terraza», «agrega la mesa 10 en la terraza para 4» | `salon:area-guardar`, `salon:mesa-guardar`. |
| «crea la estación Postres», «el agua de jamaica va a la barra» | `estaciones:guardar`, `estaciones:producto-asignar`. La estación tiene que existir. |

Cerrar la cuenta con la venta (`cuentas:cobrada`) lo hace Venta al cobrar.

### Configuración, asistencia y propinas

Reglas en `lenguaje/config.js`. El usuario tiene que existir.

| Frase | Qué hace |
|---|---|
| «desactiva al usuario Pedro», «activa a Pedro» | `users:set-active`. Nadie se desactiva a sí mismo y siempre queda un administrador. |
| «haz encargado a Pedro», «Pedro ahora es cajero» | `users:update-role`. |
| «dale a Pedro permiso de devoluciones», «quítale a Pedro el permiso de ver costos» | `users:set-permissions` con la lista ajustable completa (`seguridad/permisos.js`). |
| «agrega la caja 3», «desactiva la caja 2» | `registers-add`, `registers-set-active` (no con turno abierto). |
| «enciende Servicios», «apaga la venta suelta», «activa propinas repartidas por horas», «activa asistencia» | `modules:set`; Propinas y Asistencia con su propio canal de activación y valores de inicio. Socios se enciende en su pantalla. |
| «el giro es panadería» | `negocio:giro-guardar`. |
| «haz un respaldo ahora», «respalda todos los días a las 11 de la noche», «guarda 30 días de respaldos» | `backup-run-now`, `backup-set-config`. |
| «checa mi entrada», «salgo a comer», «ya regresé», «checa mi salida» | `asistencia:marcar` del usuario de la sesión. |
| «el horario de Pedro es de lunes a viernes de 9 a 6 con 30 minutos de comida» | `asistencia:horario-guardar` (esos días se reemplazan). |
| «corrige la entrada de Pedro de ayer a las 9», «no marques los retardos», «que tengan que checar antes de vender» | `asistencia:corregir`, `asistencia:reglas-guardar`. |
| «las propinas se reparten por horas» | `propinas:config-guardar` con lo demás igual. |

A propósito manuales: crear un usuario (su contraseña la escribe la persona),
exportar la base (archivo) y el asistente de Socios.

**Pendiente con razón:** `update-business-config` (nombre, teléfono, RFC y
pie del ticket del negocio). El canal solo manda esos campos y
`sp_update_business_config` escribe también los fiscales: los deja en nulo y
apaga la facturación. Pasa igual desde la pantalla. El asistente no lo usa
hasta que el canal conserve lo que no se manda.

## El loop de entrenamiento

```
npm run asistente:entrenar            resumen y errores
node scripts/asistente/entrenar.mjs --area clientes   un solo archivo de frases
```

Mide, con frases que el modelo **no vio**:

1. **Frases apartadas**: 1 de cada 5 frases del corpus (decidido por su texto:
   copiar una frase apartada también la aparta) se interpreta con los
   catálogos de prueba de abarrotes, café-panadería, restaurante y salón.
2. **Variaciones** de esas frases: un dedazo, muletillas y MAYÚSCULAS.
3. **Casos detallados** (`casos.mjs`): cada dato de 147 frases.
4. **Ruido**: con una frase de otro tema no arma ninguna acción.
5. **Nada inventado**: un producto o persona equivocado con seguridad es peor
   que preguntar; tiene que ser cero.

Meta: ≥ 97 % apartadas, ≥ 95 % variaciones, ≥ 97 % casos, 0 inventados.

Estado al 2026-11-15: **3,114 frases completas** (retail 2,730 · hospitality
2,907 · servicios 2,867 por giro), **97.1 % apartadas, 95.8 % variaciones,
161/161 casos detallados, 0 inventados**.

En cada caja, el intérprete además se reentrena solo con las frases que la
gente de ese negocio confirmó (`asistente_frases`), y entiende sus apodos
(`asistente_alias`).

## Dictado (opcional)

Dos piezas:

1. el motor: `vosk-browser@0.0.8` (dependencia del proyecto; el instalador
   lo lleva en `node_modules`). Sin él, el micrófono no aparece;
2. el modelo de español `vosk-model-small-es-0.42` (~40 MB), en
   `<datos del usuario>/wybix-voz/modelo.tar.gz` (en desarrollo,
   `%APPDATA%/wybix-pos/wybix-voz/`). **No viaja en el instalador: se baja
   desde el chat.** La primera vez que alguien toca el micrófono, Wybix ofrece
   «Bajar la voz» (una vez, con avance) y después funciona sin internet.

La descarga (`electron/asistente/voz-descarga.js`, canal
`asistente:voz-descargar`, avance por `asistente:voz-avance`):

- URL, tamaño y SHA-256 **fijos en el código**. Si el archivo que llega no es
  exactamente ese, se borra y no se abre.
- Se descomprime con el `tar.exe` de Windows (`System32`, ruta absoluta) y
  se re-empaca como `.tar.gz`, que es lo que lee vosk-browser.
- Se escribe como `.part` y se renombra al final: un corte a medias nunca
  deja un modelo roto. Una descarga a la vez.
- Para cambiar de modelo: actualiza `MODELO` (url, carpeta, bytes, sha256).

Sin internet en la caja, se puede copiar a mano:

```
tar -xf vosk-model-small-es-0.42.zip
tar -czf modelo.tar.gz vosk-model-small-es-0.42
```

Todo corre en la caja: la voz no sale del equipo. Lo dictado queda en el
campo para revisarlo antes de enviarlo. `e2e/dictado.spec.js` pasa un audio
grabado («Cuánto vendí hoy») por el mismo camino y espera ese texto; antes
comprueba que sin modelo el micrófono ofrece bajarlo. Sin modelo en la
máquina, se salta.

## Wybix habla (opcional)

La bocina de cada respuesta (y «léeme las respuestas») usa, en este orden:

1. **La voz de Wybix: Piper**, sin internet, en la caja (`electron/asistente/voz-piper.js`).
   - Programa: `piper_windows_amd64.zip`, release 2023.11.14-2 de rhasspy/piper, licencia MIT.
   - Voz: `es_MX-claude-high` (Hugging Face rhasspy/piper-voices). Sus datos de entrenamiento son Apache-2.0.
   - Pesa unos 85 MB y **no viaja en el instalador**. La primera vez que alguien toca la bocina sin voz, el chat ofrece «Bajar la voz». La descarga usa URL, tamaño y SHA-256 fijos para los tres archivos (canal `asistente:habla-descargar`, avance por `asistente:habla-avance`).
   - Se instala en `<datos del usuario>/wybix-habla/`.
   - `piper.exe` se queda corriendo con el modelo cargado, así que cada frase tarda unos 0.2 s; la primera, unos 1.2 s. Se cierra tras 5 minutos sin hablar y al salir de la app.
2. **Una voz de Windows en español**, si la caja la tiene (Configuración de Windows → Hora e idioma → Voz → Agregar voces → Español (México)).

Sin ninguna de las dos, la bocina ofrece bajar la de Wybix.

`e2e/habla.spec.js` comprueba que la bocina ofrece la voz y que, ya instalada, Piper dice «cuánto vendí hoy» y el dictado (Vosk) lo vuelve a entender.

## Pruebas

| | |
|---|---|
| `npm run test:asistente` | motor, reglas, léxico, señales, corpus (≥ 2,000 por giro), tipo de persona, contexto, módulos, el loop, la conversación, y lo de análisis: filtros, cubo (parámetros, nada concatenado), «¿por qué?», pronóstico, simulación, apodos, frases compuestas y la voz |
| `npm run asistente:entrenar` | el loop del intérprete |
| `npm run db:test-asistente` | contra SQL de verdad: la 0082 con el runner de la app (una caja en la 0081 la recibe sola, crea las 8 tablas, se registra, no queda pendiente, reejecutarla no truena, UNIQUE y CHECK de los apodos) y el análisis con 8 semanas de ventas hechas a mano (filtros, ganancia por producto, «¿por qué?», pronóstico, cuándo se acaba, hoy contra sus iguales, la respuesta en palabras) |
| `npm run asistente:humo` | el SQL de las 81 respuestas, y las 7 del cubo con todos los filtros a la vez, contra una base temporal real |
| `npm run e2e:asistente` | en la app: hallazgos, dock, Inicio, merma y precio; gasto, proveedor y ajuste; caja, fiado y «¿y ayer?»; apodo enseñado y usado, filtros, simulación, pronóstico, frase compuesta y «cóbrale» con la cuenta cargada |
