# Wybix QuickStart — la carga inicial del catálogo

Cómo está construido y, sobre todo, **por qué** cada decisión es la que es.
Lo que sigue no describe funciones: describe los problemas que resuelven.

---

## El problema

Un POS recién comprado está vacío. El cliente tiene su catálogo en un Excel del
proveedor, en el sistema anterior, o en una libreta. El importador que existía
antes le pedía que preparara un archivo con nuestras columnas, lo subía entero
de un golpe y, si algo no cuadraba, devolvía un mensaje de SQL Server.

Tres cosas hacían que no sirviera:

1. **Era solo INSERT.** Volver a importar el mismo archivo no actualizaba nada:
   marcaba las 428 filas como error porque «ya existen». El importador no
   servía después del primer día.
2. **Todo vivía en memoria.** Cerrar la ventana borraba el trabajo de revisión.
3. **Una fila mala tumbaba la importación entera.** Un nombre de 120 caracteres
   abortaba las 5,000 filas dentro de la misma transacción.

---

## La idea: una carga es un objeto

Una **carga** (`import_batches`) se guarda en la base desde el primer renglón
leído y tiene ciclo de vida propio:

```
ANALIZANDO → NECESITA REVISIÓN → LISTA → IMPORTADA
```

Eso es lo que permite las tres cosas que antes no se podían:

- capturar cuarenta productos de una libreta, cerrar Wybix y seguir mañana;
- resolver los problemas **sin tocar el catálogo**, y confirmar después;
- deshacer, porque hay constancia de qué hizo cada fila.

---

## La tubería, una sola

Las cinco entradas —archivo, pegado, plantilla, captura a mano, lector de
códigos— terminan en el mismo sitio. No hay cinco importadores.

```
ENTRADA → lector.js        lee xlsx/csv/portapapeles
        → alias.js         propone qué columna es qué
        → plan.js          normaliza · valida · busca duplicados · decide
        → import_rows      el almacén intermedio (SQL)
        → [ revisión ]     resolver por clase, sin tocar nada
        → sp_import_execute_chunk    ← LO ÚNICO que escribe en el catálogo
        → import_batches   el historial, que hace posible deshacer
```

### Por qué la tubería corre en el proceso principal

Analizar diez mil filas en el hilo de la interfaz deja la ventana congelada, y
lo primero que hace el usuario con una ventana congelada es cerrarla. Medido:
**10,000 filas contra un catálogo de 5,000 tardan 39 ms** porque el índice de
duplicados se construye una vez, no una consulta por fila.

---

## Decisiones que cuestan explicarse

### ExcelJS en lugar de SheetJS

`xlsx@0.18.5` arrastra [CVE-2023-30533](https://github.com/advisories/GHSA-4r6h-8v6p-xvw6)
—prototype pollution a través de un archivo manipulado—. El aviso dice
literalmente que los flujos que **no** leen archivos arbitrarios no están
afectados; esto es exactamente un flujo que lee archivos arbitrarios del
cliente. La versión corregida (0.19.3+) **no está en npm**: npm se quedó en
0.18.5 y sin mantenimiento, y el arreglo solo se publica en el CDN propio de
SheetJS, que es una fuente difícil de empaquetar y de auditar.

ExcelJS es MIT, está mantenido en npm, lee y escribe, y además **escribe
validaciones de datos** —las listas desplegables de la plantilla—, cosa que
SheetJS Community descarta en silencio al escribir.

`xlsx-js-style` se conserva: solo **exporta** reportes, y escribir no expone a
ese fallo.

### El stock inicial es un movimiento, no un número

Antes: `products.stock = 24`. Un número sin origen, sin fecha y sin
responsable.

Ahora la existencia inicial es una fila en `inventory_movements` con
`source = 'IMPORT_INICIAL'` y `reference = 'IMP-<carga>'`, igual que una compra
o una venta. **No hay un segundo libro mayor: es el mismo.** Sin esto,
«deshacer» sería imposible de hacer bien.

### Por lotes, no de un golpe

Cada lote de 300 filas es su propia transacción. Un lote que falla deja los
anteriores dentro. Y las filas que no caben en el modelo —un nombre de 120
caracteres, una unidad que no existe— **ni siquiera se eligen**: la guarda de
longitud está en el `WHERE`, no en el `INSERT`, así que una fila imposible se
queda fuera en vez de tumbar a sus vecinas.

### Proponer no es adivinar

El importador viejo mapeaba encabezados con expresiones regulares y **no se lo
enseñaba a nadie**. Aquí cada propuesta lleva un grado de confianza:

| Confianza | Qué pasa |
|---|---|
| `exacto` | se aplica |
| `probable` | se aplica, marcado |
| `ambiguo` | **no se aplica**: se pregunta |

«P. Unit.» es ambiguo a propósito: en unos catálogos es el costo y en otros el
precio. Reconocerlo está bien; decidir por el usuario, no.

La tabla de alias es curada y no una distancia de edición. Se probó con los
encabezados reales: «Cve», «Exist.», «Depto.». Ninguno se resuelve por parecido
—Levenshtein además empareja «precio» con «preciso» y se equivoca en silencio—.

### Deshacer no es borrar

Tres respuestas, no una:

| Veredicto | Cuándo |
|---|---|
| `TODO` | ninguna fila tuvo actividad posterior |
| `EN_PARTE` | algunas sí, y **esas se quedan** |
| `NADA` | el catálogo ya se movió demasiado |

Lo que se deshace se deshace con **movimientos inversos** y desactivando
(`active = 0`), nunca con `DELETE`: el id de un producto puede estar escrito en
sitios que no sabemos mirar.

### La plantilla se genera, no se guarda

Las plantillas anteriores eran nueve columnas fijas con ejemplos de
refaccionaria. Un salón de belleza se descargaba una plantilla de taller.

Ahora se arma en el momento desde el perfil del negocio, el giro
(`presets.json`) y los campos reales de la base. El vocabulario sale del giro:
**Refacción** en un taller, **Producto e insumo** en un salón, **Componente**
en electrónica. Un solo generador.

Los ejemplos van en su **propia hoja**, y el lector la salta por nombre: una
plantilla vacía intimida, pero un ejemplo en la hoja de datos acaba importado
como producto del negocio.

---

## Lo que deliberadamente NO hace

- **Recetas, presentaciones y modificadores de Hospitality.** Son un grafo;
  convertirlos en ocho hojas de Excel hace la carga inicial *peor* que la
  pantalla que ya existe. La plantilla de alimentos trae Productos e
  Ingredientes, y las recetas se montan después, donde se ven.
- **OCR, PDF, imágenes, IA documental.** Fuera de alcance.
- **Fusionar por nombre parecido.** Se sugiere; decide la persona.

---

## Permisos

Importar es reemplazar precios, costos y existencias de golpe: la operación que
más puede cambiar un negocio en un gesto.

| Canal | Paquete |
|---|---|
| analizar, remapear, resolver, ejecutar, deshacer, plantilla | `CONFIGURACION_ADMINISTRAR` |
| abrir captura, capturar a mano | `INVENTARIO_OPERAR` |
| leer el riel, el resumen y las filas | abierto |

Leer está abierto a propósito: Inicio necesita saber si el catálogo está vacío
para poder ofrecer ayuda, y exigir permiso ahí dejaría a un cajero sin ver que
no hay productos.
