# Dinámicas: qué hay y qué falta

Una **dinámica** es un juego que una venta deja disponible. La venta la
concede (`sp_loyalty_evaluate_sale`), el cliente la juega
(`sp_dynamic_play`), y si gana se le entrega algo.

## La regla que no se negocia

**El resultado lo decide el servidor.** El renderer manda el gesto —cuándo
paró el cronómetro, o simplemente "gira"— y nunca si ganó. Si el azar o la
comparación vivieran en la pantalla, bastaría con repetir hasta ganar o con
mandar el número bueno.

En la ruleta esto significa un orden concreto: **primero se pregunta, después
se anima**. La rueda gira hacia el sector que el servidor ya eligió y
persistió. Al revés —animar y luego mirar dónde paró— el ángulo sería quien
reparte los premios.

## Lo que comparten todos los tipos

Esta parte ya existe y **no hay que volver a construirla** para un tipo nuevo:

| Pieza | Dónde |
|---|---|
| Concesión desde una venta | `sp_loyalty_evaluate_sale` |
| Intento con token, caducidad y un solo uso | `dynamic_attempts` |
| Marcado atómico del intento | `UPDATE ... WHERE status = 'PENDING'` |
| Entrega de recompensa | `sp_dynamic_play` |
| Entrega de boletos de rifa | `sp_dynamic_play` |
| Pantalla de cliente y vista previa | `app-dinamica-juego` |
| Vista previa sin segundo monitor | `customer-display:preview-open` |

Añadir un tipo es **añadir un veredicto y un renderer**, no un dominio.

## Estado por tipo

### TIMING — completo

"Detén el cronómetro exactamente en 10.00". Gana quien pare en la centésima
exacta; la comparación es de enteros a los dos lados.

- Configuración: segundo objetivo.
- Veredicto: `ROUND(@input_value * 100, 0) = ROUND(@objetivo * 100, 0)`.
- Renderer: cronómetro.

### WHEEL — completo

Sectores con peso. El servidor acumula pesos, saca un número y recorre.

- Configuración: `dynamic_segments` (etiqueta, resultado, premio, cantidad, peso).
- Veredicto: sorteo por peso en `sp_dynamic_play`.
- Renderer: rueda que anima hacia el sector devuelto.

### PICK_ONE — falta el renderer

"Elige una de tres cajas". **El modelo ya sirve tal cual**: cada caja es un
sector de `dynamic_segments`, y el sorteo por peso es exactamente el mismo.

Falta:
- Un renderer con N tarjetas boca abajo que se voltean.
- Que `sp_dynamic_play` acepte cuál eligió el cliente **solo como gesto**: el
  sector premiado ya lo decidió el servidor, así que la tarjeta que el cliente
  toca es la que se revela. Es una diferencia de presentación, no de reparto.

### RANDOM_REVEAL — falta el renderer

Igual que `PICK_ONE` pero sin elección: se revela un sector al azar. El
veredicto ya está resuelto por el sorteo por peso; solo cambia la animación.

### SCRATCH — falta el renderer

"Raspa y descubre". El veredicto tiene una rama preliminar en
`sp_dynamic_play` que usa `target_value` como probabilidad suelta.

Antes de darlo por bueno conviene migrarlo a `dynamic_segments`, que ya
expresa lo mismo mejor: un sector "premio" y otro "sin premio" con sus pesos.
Así habría **un solo mecanismo de azar** en lugar de dos.

Falta:
- Migrar el veredicto al sorteo por peso.
- Un renderer de raspado (canvas con `destination-out`).

## Lo que sí haría falta tocar

Un tipo que **no** se pueda expresar como "uno de estos resultados, con estos
pesos" sí pediría modelo nuevo. Por ejemplo, un juego de varias rondas, o uno
cuyo premio dependa de algo del cliente. Ninguno de los tres pendientes lo es.
