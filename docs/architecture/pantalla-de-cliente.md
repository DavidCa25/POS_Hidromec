# La pantalla del cliente

Es lo único de Wybix que mira alguien que no trabaja aquí. No es un
dashboard, ni un ticket gigante, ni una landing, ni una máquina
recreativa: es **señalización comercial interactiva**. Se lee de pie, a
dos metros, de reojo, mientras a alguien le están cobrando.

La marca del **negocio** es la protagonista. Wybix pone la estructura, la
tipografía, el movimiento y el acabado.

Vive en `electron/customer-display/customer.html`. Es HTML plano con su
propio preload, no Angular: el punto de venta le empuja estados por IPC y
ella los pinta.

---

## Por qué está escrita así

### Usa el sistema de Wybix, no uno suyo

Durante un tiempo declaró su propia paleta y cargó Poppins desde Google
Fonts. Era un tercer sistema de diseño que coincidía con Wybix sólo
porque alguien había copiado el cyan a mano, y que además se quedaba en
Arial en una caja sin internet.

Ahora los valores salen de `src/styles/tokens.css`: Geist y Geist Mono,
el acento cyan, `cubic-bezier(.23, 1, .32, 1)` y las duraciones de 110 a
230 ms. Las fuentes viajan dentro de la aplicación, desde
`node_modules/@fontsource-variable`, que es de donde ya las toma el resto
del producto.

**Si cambias un token en `tokens.css`, cámbialo también aquí.** Esta
pantalla no puede importar el CSS de Angular porque se carga como archivo
suelto, así que la copia es deliberada y hay que mantenerla a mano.

### La unidad es `--u`, no `vw`

```css
--u: min(1vw, 1.7778vh);
```

En un 16:9 vale `1vw`, así que 1024x576, 1366x768 y 1920x1080 se ven
idénticas. En una pantalla más alta que ancha la limita la altura y nada
se desborda.

Todo tamaño va en `calc(N * var(--u))`. **No uses `ch` para limitar
anchos** salvo en el elemento que declara su propio `font-size`: `ch` se
resuelve contra la fuente del propio elemento, y un contenedor sin
`font-size` hereda los 16px del documento y mide un tercio de lo
previsto. Eso partía los nombres de premio en tres líneas y sacaba la
lista de la pantalla.

### La jerarquía está decidida, no escalada

Entre el protagonista y lo secundario hay un factor de tres, no de uno y
medio. Una pantalla, un mensaje. Nada de tarjetas y nada de una cápsula
por dato: lo que separa contenido es un filete o el espacio en blanco.

---

## El pulsador

Uno solo, rojo, y es lo **único** rojo de la pantalla. Se comporta como un
objeto físico: tiene cuerpo, se hunde al pulsarlo y el cuerpo se comprime
con él. Sin halo, sin rebote y sin animación en bucle.

La intención se separa de su origen. Las tres acciones viven en
`window.wybixDinamica`:

```js
window.wybixDinamica.comenzar();   // START_TIMING
window.wybixDinamica.parar();      // STOP_TIMING + centésimas
window.wybixDinamica.girar();      // SPIN
```

El `click` del botón sólo las invoca. Si mañana el origen es un pulsador
atornillado a la pared o un pedal, llama a las mismas funciones y no hay
que tocar nada más.

---

## El cronómetro

La instrucción y el número son **una sola frase**: «Detenlo exactamente
en» seguido de `10.00`. Partirla entre dos capas es como se acabó
enseñando un número y un botón sin relación aparente, y por qué la
primera versión no se entendía.

El **mismo** botón pasa de `EMPEZAR` a `PARAR`. No son dos botones: es un
objeto en otro estado.

Al terminar, la pantalla dice **en qué número se quedó**. Al perder ese
número es el protagonista, con el objetivo debajo para comparar de un
golpe; al ganar manda el premio y el número baja a línea secundaria. Sin
él, quien acaba de jugar no sabe si falló por dos centésimas o por dos
segundos.

### La paridad que no se puede romper

El reloj corre aquí, con `requestAnimationFrame`, sobre centésimas
**enteras**. De ese mismo entero salen el número que se pinta y el que se
manda. Contar en segundos y redondear dos veces es como la pantalla acaba
diciendo 10.00 y el servidor juzgando 9.99.

`STOP_TIMING` lleva **las centésimas que se estaban mostrando**, nunca un
«he ganado». No recalcules el tiempo en el momento de parar: si lo que
viaja deja de ser lo que el cliente vio, el juego deja de ser justo.

Consecuencia conocida y aceptada: `requestAnimationFrame` se frena cuando
la ventana está oculta o tapada, así que el número avanza a saltos. Lo
que se manda sigue siendo exactamente lo que se veía. En la pantalla del
cliente, que está a pantalla completa en su monitor, no ocurre; en la
vista previa por detrás de la ventana principal, sí.

---

## La ruleta

Sangra por el borde derecho, pero conserva la forma circular, el puntero,
la lectura del giro y el sector final. A la izquierda, el reto y la lista
de lo que se puede ganar.

### El dibujo existe en las tres fases

**Este fue un fallo real.** `jgDibujarRueda` se llamaba en un solo sitio,
dentro de la rama de la fase `LISTA`, así que los sectores existían
únicamente como efecto secundario de que **esa ventana** hubiera pintado
esa fase. La pantalla del cliente y la vista previa son documentos
independientes y el estado se emite a las dos: la que se abriera o se
recargara a mitad de partida recibía `GIRANDO` o `RESULTADO` sobre un
disco que nadie había dibujado, y se quedaba en un círculo vacío. Por eso
aparecía unas veces sí y otras no.

La regla ahora es: **el cambio de fase altera el estado visual, nunca la
existencia del dibujo.** `jgDibujarRueda` es idempotente, se llama siempre
que haya sectores, y una firma evita repintar sin motivo. Repintar no
toca `transform` ni `dataset.giro`, así que el giro acumulado sobrevive.

Cubierto por `scripts/pruebas/customer-display-ruleta.mjs`.

### Las etiquetas: o caben todas, o no va ninguna

«Cambio de aceite completo» no entra en un sexto de rueda, y recortarlo a
«Cambio de ace…» es peor que no ponerlo. Un nombre largo se deriva a su
primera palabra, que es una presentación y no un truncado.

La decisión es de la rueda **entera**, no de cada sector: media rueda con
texto y media sin él se lee como un error. Y si dos sectores derivaran a
la misma palabra la rueda va sólo con color, porque ver la rueda parar en
«Cambio» sin saber en cuál de los dos es peor que no leer nada.

Cuando no hay etiquetas, el sector se distingue por color y por posición,
el nombre completo se lee en la lista de al lado, y el premio de verdad
lo dice el resultado. El cliente nunca pierde información.

### Antes de empezar, la rueda vuelve a cero

Las etiquetas se desgiran respecto al disco para quedar horizontales. Si
la partida anterior dejó el disco girado, en `LISTA` aparecerían torcidas
o boca abajo. `jgEnderezarRueda` la devuelve a cero sin animarla: es una
preparación, no un giro.

### El ángulo no reparte premios

En `GIRANDO` la rueda se anima **hacia** el sector que el servidor ya
decidió. La animación representa un resultado; no lo produce. Al parar,
el sector ganador se enfatiza y el resto retrocede.

---

## Los colores de la rueda

Una paleta curada, derivada de la de Wybix, desaturada y alternando claro
y oscuro para que dos sectores vecinos nunca se confundan. **El rojo no
está**: es del pulsador, que es lo único que se toca.

El tamaño visual de un sector **no** es su peso. Todos los sectores se
dibujan iguales. La probabilidad la decide `weight` en SQL y **no se le
enseña al cliente**.

---

## Lo que la pantalla no puede prometer

Al perder se dice «esta vez no» y nada más. **No** se invita a volver a
intentarlo: el modelo todavía no sabe si la campaña permite otro intento,
y una pantalla que promete de más se paga en el mostrador.

El mensaje de espera se construye con los premios y la campaña que el
negocio tiene **de verdad**. Una frase fija del tipo «hoy tu compra puede
salir gratis» es mentira en cuanto la campaña regala un café.

`empujar` manda `mensaje` **sólo** cuando algo ha fallado. Ganar o no
ganar lo redacta la pantalla, que es quien sabe con cuánto espacio
cuenta.

---

## La vista previa no es otra pantalla

Se abre con `?preview=1`. Es lo **único** que la distingue: un chip
discreto arriba a la derecha. Si la vista previa se viera distinta
dejaría de servir para comprobar cómo se ve de verdad.

Comprobado comparando las dos: la única diferencia es el chip.

La garantía de que una vista previa no entrega premios la da el
**backend**, no un color. No hay token, así que no hay intento que
resolver.

---

## Listas que no caben

Tres sitios aplican la misma regla, y por la misma razón: encoger una
lista hasta que quepa la vuelve ilegible desde el otro lado del
mostrador, que es otra forma de no decir nada.

| Dónde | Tope | Resto |
|---|---|---|
| Premios de la ruleta | 3 | «y N premios más» |
| Premios ganados | 4 | «y N premios más · Pregunta en caja» |
| Líneas del carrito | las que caben **enteras** | «y N artículos más», arriba |

El carrito calcula el cupo con la altura real del hueco. Antes recortaba
una fila por la mitad, y media fila se lee como un fallo de la pantalla,
no como una lista que sigue. Se pintan las **últimas**: lo que el cajero
acaba de añadir es lo que el cliente está comprobando.

---

## Cómo se prueba

```bash
npm run test:marca     # la marca es la del negocio, nunca la del POS
npm run test:ruleta    # la rueda existe en las tres fases, y el resto
```

`customer-display-ruleta.mjs` carga el HTML de verdad en un DOM mínimo y
ejecuta su lógica de pintado. No usa jsdom a propósito: el proyecto no lo
trae y la prueba tiene que correr en cualquier caja.

Para el QA visual sobre la ventana real hay un arnés de Electron que
carga la página en 1024x576, 1366x768 y 1920x1080, recorre los once
estados y comprueba que ninguno desborda. Las capturas quedan en
`docs/evidencias/customer-display/`, que no va a Git.

---

## Lo que queda pendiente

- **`PICK_ONE`, `RANDOM_REVEAL` y `SCRATCH`** no tienen presentación en
  esta pantalla. Ver [dinamicas.md](dinamicas.md).
- **Reintento tras perder.** No hay en el modelo nada que diga si una
  campaña permite volver a jugar. Mientras no lo haya, la pantalla no lo
  insinúa.
- **Un pulsador físico.** El punto de entrada existe
  (`window.wybixDinamica`) pero no hay driver ni ajuste para ninguno.
- **Los tokens están duplicados** entre `tokens.css` y esta página. Se
  arreglaría generando el bloque `:root` desde el mismo sitio en tiempo
  de compilación; hoy se mantiene a mano.
