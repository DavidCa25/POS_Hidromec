# Rive en Wybix: qué hay que producir y para qué

Este documento existe porque el código está preparado y el asset no. Aquí está
escrito exactamente qué hay que crear en el editor de Rive para que la
integración se encienda sola.

**No hay ningún `.riv` en el repositorio, y no debe inventarse uno.** Un `.riv`
es un binario que produce el editor de Rive; escribirlo a mano no es posible y
un archivo falso rompería la carga en silencio.

---

## 1. El reparto: Rive no es la mascota

Esto es lo que se aprendió construyendo, y es la razón de que el contrato de
abajo sea tan estrecho.

| | **Blobatar** | **Rive** |
|---|---|---|
| Qué es | Persona y presencia | Sistema y evento |
| Quién | La guía Wybix y las figuras de la gente | Ningún personaje |
| Qué hace | Respirar, parpadear, mirar, cambiar de expresión | Contar un proceso que avanza |
| Coste | ~13 KB de JS + 8 KB de CSS, bajo demanda | 2.9 MB de runtime + wasm |
| Estado | **En producción** | **Preparado, sin asset** |

Rive **no** se usa para respirar, parpadear, mirar ni cambiar de expresión.
Blobatar ya resuelve todo eso, y mejor: sus poses se interpolan entre sí con
curvas distintas para adoptar una expresión y para volver al reposo.

Rive se reserva para lo que una pose **no puede contar**: un proceso con
duración y con final.

---

## 2. Para qué lo queremos

Casos en los que Rive aportaría algo que hoy no se puede hacer:

| Momento | Qué tendría que contar |
|---|---|
| Venta cobrada | Un remate breve alrededor del total o del check |
| Respaldo | Procesando → terminado, con progreso real |
| Sincronización con la nube | Movimiento continuo mientras sube, y un cierre |
| Conexión MultiCaja | Buscando → conectada → caída |
| Primera configuración | Micro-guía contextual entre pasos |
| Error importante | Una transición controlada, no un icono que aparece |

Todos comparten la misma forma: **hay un estado que cambia con el tiempo y el
usuario necesita saber en cuál está.** Eso es lo que una pose estática no da.

---

## 3. El contrato del asset

El componente `wx-mascota` ya sabe leer esto. Si el archivo aparece con estos
nombres, se enciende sin tocar una línea de código.

### Archivo

```
src/assets/mascota/wybix.riv
```

No se versiona un binario grande sin pensarlo: si pesa más de ~200 KB,
decidirlo antes de commitear.

### Artboard

| Campo | Valor |
|---|---|
| Nombre | `Wybix` |
| Dimensiones | 200 × 200 px |
| Origen | Centrado |
| Fondo | Transparente, sin disco ni placa |

Cuadrado y centrado porque el componente lo dibuja en una caja cuadrada de
lado variable (26 px en el dock, 104 px en Inicio).

### Máquina de estados

| Campo | Valor |
|---|---|
| Nombre | `Wybix` |
| Entrada | `estado`, de tipo **Number** |

Valores de `estado`:

| Valor | Estado | Cuándo |
|---|---|---|
| `0` | idle | Reposo. Es el estado por defecto. |
| `1` | atencion | Hay algo parado que requiere una decisión. |
| `2` | exito | Acaba de completarse algo. Dura 500–900 ms y vuelve a 0. |
| `3` | error | Algo no se pudo hacer. Acompaña al mensaje, no lo sustituye. |

Una sola entrada numérica y no cuatro booleanos: con booleanos son posibles
estados contradictorios —éxito y error a la vez— y habría que decidir en la
máquina cuál gana. Con un número eso no puede pasar.

### Transiciones

- Todas las transiciones entre estados deben ser **explícitas**. Ir de
  `atencion` a `exito` no puede pasar por `idle` si eso produce un parpadeo.
- `exito` y `error` **no se quedan**: vuelven a `idle` solos, o el llamador los
  devuelve. El componente no pone temporizadores.
- La entrada a `idle` debe poder ocurrir desde cualquier estado sin salto.

### Paleta

El cian de la marca es `#45B3C3`. La figura de blobatar usa `#00BFC6`, que es
el vecino más cercano dentro de su escala. **Cualquiera de los dos sirve**,
pero tiene que ser reconociblemente el mismo personaje que dibuja blobatar: no
un segundo personaje con otra silueta.

---

## 4. Cómo carga, y por qué no pesa hoy

El orden en `wx-mascota` importa y está probado:

1. Se busca `assets/mascota/wybix.riv` con `fetch`.
2. Se comprueba que el archivo empiece por la firma `RIVE`.
3. **Solo entonces** se importa `@rive-app/canvas-lite`.

Al revés se descargarían 2.9 MB para descubrir que no hay nada que animar. Hoy,
sin asset, **el runtime no se descarga nunca** y la prueba `test:dock` vigila
que nadie lo importe de forma estática.

El wasm viaja dentro de la aplicación —`scripts/assets/rive.mjs` lo copia desde
`node_modules` en cada build— porque una caja de punto de venta puede estar sin
internet, y el runtime va a buscarlo a un CDN si no se le dice otra cosa.

Comprobado: bajo `file://` en Electron, `fetch` a una ruta relativa **sí**
funciona, así que no hace falta ni canal IPC nuevo ni protocolo propio.

---

## 5. Lo que NO hay que hacer

- No producir un `.riv` con un personaje distinto al de blobatar.
- No usar Rive para la presencia constante: la guía respira con blobatar.
- No meter texto dentro del artboard. Las frases son del producto y cambian con
  el idioma y el giro.
- No dar por hecho que hay conexión.
- No cargar el runtime "por si acaso".
