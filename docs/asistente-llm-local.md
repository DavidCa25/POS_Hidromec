# Wybix con un LLM local (diseño)

Estado: **propuesta, sin implementar.** Este documento decide qué haría el modelo, qué no haría nunca, cómo se mide y en qué orden se construye.

## Qué problema resuelve

Hoy Wybix entiende con reglas y un clasificador entrenado con ~3,100 frases. Los resultados:

- 97% en frases que nunca vio.
- 96% en variaciones.
- 0 respuestas inventadas.

El ~3% que falla son frases con forma rara, rodeos, varias ideas mezcladas o vocabulario que no está en el corpus. Ahí Wybix contesta «no te entendí» o pregunta «¿cuál de estas?».

Un LLM local cubriría justo ese hueco: **lenguaje realmente abierto**, sin internet.

## Lo que el modelo hace y lo que NO hace

| El modelo SÍ | El modelo NUNCA |
|---|---|
| Lee la frase y dice **qué intent es** (de la lista cerrada de Wybix) | Contesta al cliente con sus propias palabras |
| Copia **los pedazos de texto** de cada dato («la coca grande», «los sábados», «después de las 6») | Da números del negocio (ventas, existencias, precios) |
| Llena la forma de una pregunta libre (qué medir, cómo agrupar, orden) | Elige ids de productos o personas |
| Dice qué tan seguro está | Ejecuta acciones o se salta la tarjeta de Confirmar |

El modelo traduce la frase al mismo formato que ya produce el intérprete. Después sigue el camino de siempre:

1. Los pedazos de texto se resuelven con los extractores actuales: catálogo, personas, filtros y periodos.
2. `llenar` y `cerrar` deciden qué falta y Wybix lo pregunta.
3. Las respuestas salen de SQL y de las plantillas.
4. Las acciones pasan por su tarjeta y su permiso.

Si el modelo se equivoca, lo peor que pasa es una pregunta de más o una tarjeta que la persona cancela.

**Inventados = 0 sigue siendo la regla.** Si un pedazo que el modelo «copió» no aparece en la frase, se descarta su respuesta completa.

## Dónde entra

```
frase → reglas (apodos, preferencias, por qué, correcciones, pregunta libre)
      → clasificador
      → ¿intent claro (≥ 0.45)? ── sí → como hoy
                                └ no → LLM local (si está instalado) → validar → como hoy
                                                                   └ falla / tarda > 6 s → «no te entendí» (como hoy)
```

Solo se llama al LLM en la minoría de frases que hoy fallan. Lo normal sigue siendo instantáneo.

## Salida restringida (no texto libre)

El modelo genera **solo JSON válido contra una gramática**: GBNF de llama.cpp o JSON Schema convertido a gramática.

- El campo `intent` es un `enum` con los intents **disponibles para esa caja y esa persona**, filtrados por módulos y permisos.
- Cada dato es texto copiado o un `enum`: periodo, medida, agrupar, forma de pago y orden.

```json
{ "intent": "analisis.libre",
  "datos": { "pregunta": { "medida": "ganancia", "agrupar": "categoria", "orden": "desc" },
             "filtros": "los domingos en la tarde", "periodo": "mes" },
  "seguridad": 0.82 }
```

Con gramática, un modelo pequeño no puede «salirse» del formato. Tampoco puede inventar un intent que no existe.

## Qué modelo

Requisitos: buen español, ≤ 2 GB, licencia que permita uso comercial y que corra en CPU.

| Modelo (GGUF Q4_K_M) | Tamaño | Notas |
|---|---|---|
| **Qwen3 1.7B Instruct** | ~1.1 GB | Recomendado para empezar: Apache 2.0, buen español y buen seguimiento de formato |
| Qwen3 4B Instruct | ~2.5 GB | Para cajas con 16 GB de RAM; más preciso con frases enredadas |
| Gemma 3 1B / 4B | 0.8 / 2.5 GB | Buen español; licencia propia de Google (revisar términos) |
| Llama 3.2 3B Instruct | ~2.0 GB | Licencia comunitaria de Meta (revisar términos) |

Antes de distribuir cualquiera hay que confirmar su licencia vigente y fijar el archivo exacto: URL, tamaño y SHA-256, como la voz.

**Motor:** `node-llama-cpp`. Trae llama.cpp precompilado para Windows (CPU, Vulkan y CUDA), soporta gramáticas y reutiliza el caché del prompt.

Corre en un **proceso aparte** (`utilityProcess` de Electron) para que nunca congele la caja. Se carga al primer uso y se descarga tras 10 minutos sin uso.

## Velocidad esperada (a medir)

El prompt fijo trae la lista de intents, sus datos y ejemplos cortos, unos 1,500 tokens. Se procesa **una vez** y queda en caché. Por frase, el modelo solo procesa unos 30 tokens nuevos y genera unos 40 tokens de JSON.

| Equipo | Qwen3 1.7B Q4 (estimado) |
|---|---|
| Caja de 4 núcleos, sin GPU | 1.5 – 3 s |
| Laptop de 8 núcleos | 0.7 – 1.5 s |
| Con GPU (Vulkan/CUDA) | < 0.5 s |

RAM: unos 1.5 GB en uso. Solo se ofrece si la caja tiene **8 GB o más**, CPU con AVX2 y 2.5 GB libres.

## Instalación (opcional, como la voz)

- No viaja en el instalador.
- En Configuración aparece una opción: «Wybix entiende más (1.1 GB, una vez)». Lleva un aviso de tamaño y una recomendación de usar Wi-Fi.
- La descarga sigue el mismo patrón que `voz-descarga.js`:
  - URL, tamaño y SHA-256 fijos.
  - El archivo se escribe como `.part` y se renombra al final.
  - Si el hash no coincide, el archivo se borra.
  - Se puede reanudar con Range si se corta.
- Se puede desinstalar y liberar el espacio.

## Aprende con el uso

Cuando el LLM resuelve una frase y la persona la confirma, la frase se guarda en `asistente_frases` con su intent. Cuenta como confirmada si la tarjeta se confirma, o si la consulta se contesta y no se corrige.

El clasificador se reentrena con esas frases. Con el tiempo, **cada negocio necesita menos al LLM**: sus maneras de decir las cosas pasan a las reglas, que son instantáneas.

## Cómo se mide (puerta para lanzarlo)

1. **El loop de siempre**, con el LLM como respaldo:
   - Frases apartadas, variaciones y casos.
   - Además, un conjunto nuevo de frases «difíciles»: rodeos, faltas de ortografía fuertes, órdenes mezcladas.
2. Metas:
   - Las frases que hoy fallan se resuelven en ≥ 70%.
   - **Inventados = 0**.
   - Ninguna frase que hoy sale bien empeora.
3. Latencia p50 y p95 en la caja más modesta de un cliente real.
4. Una semana en una caja piloto, con bitácora de qué resolvió el LLM y si la persona corrigió.

## Antes del LLM en la caja: usarlo para entrenar (recomendado como paso 0)

Un LLM grande usado **solo en desarrollo** puede generar miles de maneras de decir cada intent.

- Las frases se revisan a mano y se suman a `electron/asistente/lenguaje/frases/`.
- El clasificador mejora para todos los clientes.
- Costo en la caja: cero.
- Es barato, sin riesgo, y probablemente sube el 97% a 98–99% antes de instalar nada.

## Alternativa: LLM en la nube como respaldo

Cuando hay internet, el mismo contrato (gramática → intent + pedazos) podría resolverse con un modelo en la nube.

| | Local | Nube |
|---|---|---|
| Calidad con frases enredadas | Buena | Mejor |
| Funciona sin internet | Sí | No |
| Costo por uso | 0 | Por llamada |
| Privacidad | Nada sale de la caja | Sale la frase (sin números del negocio) |
| Requisitos de la caja | 8 GB RAM, 1.1 GB de disco | Ninguno |

Las dos pueden convivir: primero local si está instalado, si no la nube si el negocio la activó, si no «no te entendí».

## Plan por fases

| Fase | Qué | Resultado |
|---|---|---|
| 0 | Generar y revisar frases con un LLM en desarrollo | Más corpus; el loop sube sin tocar la caja |
| 1 | Prototipo: `utilityProcess` + node-llama-cpp + Qwen3 1.7B + gramática, detrás de una bandera | Medir aciertos y latencia con el loop |
| 2 | Puerta de medición en 2–3 cajas reales | Decidir modelo (1.7B o 4B) y requisitos mínimos |
| 3 | Descarga opcional en Configuración, aprende con el uso | Lanzamiento a clientes que lo quieran |

## Decisiones pendientes (del negocio)

- ¿Opcional para quien lo quiera, o encendido por omisión donde la caja aguante?
- ¿Se permite el respaldo en la nube para negocios que lo acepten?
- ¿Qué caja es la «más modesta» que hay que soportar? Fija el tamaño del modelo.
