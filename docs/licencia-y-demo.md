# La licencia, y qué haría falta para una licencia DEMO_INTERNAL

Este documento **no implementa nada**. Describe cómo funciona hoy la licencia
de Wybix y qué tendría que existir en el backend para que el Demo Manager
pudiera pedir una licencia interna en el futuro. No hay bypass, no hay clave
interna, no se toca el fingerprint.

El motivo de escribirlo: el build interno instala Wybix en la misma máquina que
una instalación real, y la licencia identifica **máquinas**, no instalaciones.
Antes de resolver eso conviene tener por escrito qué se rompería.

---

## 1. Cómo se calcula el `machineId`

Hay **dos identidades** conviviendo, y no hacen lo mismo.

### 1.1 `machineId` v1 — el identificador que se le reporta al servidor

[`electron/main.js:246`](../electron/main.js#L246), `generarMachineId()`:

```js
const partes = [
  obtenerUuidPlaca(),   // UUID de la placa, vía WMI
  obtenerSerialDisco(), // serial del primer disco, vía WMI
  os.hostname(),
  os.platform(),
  os.arch()
].filter(Boolean).join('|');

return crypto.createHash('sha256').update(partes).digest('hex').slice(0, 32);
```

Los primeros 32 caracteres hexadecimales del SHA-256, es decir 128 bits. **Su fórmula no se cambia**:
los clientes ya dados de alta están registrados en el servidor de activación con
el valor que produce esta función, y cambiarla los dejaría sin poder revalidar.

Dos detalles con consecuencias:

- `os.hostname()` entra en el hash. Renombrar el equipo cambia el identificador.
- `.filter(Boolean)` descarta las partes vacías en vez de dejar huecos, así que
  un fallo de WMI produce en silencio un hash distinto.

Los dos se mitigan hoy sin tocar la fórmula:

- `candidatosMachineIdV1()` ([`main.js:270`](../electron/main.js#L270)) enumera
  las cuatro combinaciones posibles con y sin UUID y con y sin disco, para poder
  abrir licencias v2 selladas cuando WMI sí respondía.
- `machineIdEstable()` ([`license.js:328`](../electron/license.js#L328))
  devuelve el `machineId` **que quedó sellado en la licencia**, no el
  recalculado, mientras la huella siga diciendo que es la misma máquina. Solo se
  cae al calculado cuando todavía no hay licencia.

### 1.2 La huella v2 — quién decide si es la misma máquina

[`electron/lib/huella.js`](../electron/lib/huella.js). No es un hash: es un
conjunto de señales guardadas por separado y comparadas una a una.

| Señal    | Origen              | Decide |
| -------- | ------------------- | ------ |
| `uuid`   | UUID de placa (WMI) | sí     |
| `discos` | seriales, ordenados | sí     |
| `macs`   | MACs de red         | sí     |
| `host`   | `os.hostname()`     | no     |
| `plat`   | `os.platform()`     | requisito duro |
| `arch`   | `os.arch()`         | requisito duro |

Regla: se comparan solo las señales duras presentes **en ambas**. Al menos una
en común es *misma máquina*; ninguna en común habiendo alguna comparable es
*otra máquina*; ninguna comparable es *indeterminada*. Cambiar un disco o una
placa es una reparación legítima y no cuesta la licencia; copiar la licencia a
otra PC cambia las tres a la vez y sí se rechaza.

### 1.3 Dónde vive la licencia

Dos copias, ambas bajo rutas de Electron:

| | Instalación normal | Wybix Demo |
| --- | --- | --- |
| Principal | `userData/license.json` | `userData-demo/license.json` |
| Espejo | `appData/.wxsys.dat` | `appData/.wxsys-demo.dat` |

Formato v3: AES-256-CBC con llave derivada de una **sal aleatoria por
instalación**, más HMAC-SHA256 sobre cuerpo y sal. Se reconcilian tomando el
`lastSeen` más avanzado y el `expiresAt` más temprano, de forma que ni retrasar
el reloj ni editar una sola copia extienden nada.

**Las dos copias están aisladas, y por dos mecanismos distintos.**
`aislarDatos()` cambia `userData` a `%APPDATA%\wybix-pos-demo`, y con esa sola
línea se mueve la copia principal junto con las otras doce cosas que cuelgan de
ahí. El espejo no cuelga de `userData` sino de `appData` —`%APPDATA%` a secas,
el mismo directorio para las dos instalaciones—, así que ahí lo que cambia es
el **nombre del archivo**: el gestor declara su espacio con
`licencia.usarEspacio('demo')` y el espejo pasa a llamarse `.wxsys-demo.dat`.

No se mueve dentro de `userData` a propósito: las dos copias viven en carpetas
distintas para que borrar o editar una sola no sirva de nada, y juntarlas
perdería esa protección.

Sin espacio declarado —que es lo único que ocurre en el instalador público,
donde `electron/demo` no viaja— las rutas son las históricas, byte por byte.
`scripts/pruebas/licencia-aislamiento.mjs` lo comprueba, junto con que escribir
en un espacio no toque los archivos del otro y que los rescates de lectura no
crucen de uno a otro.

---

## 2. El endpoint de prueba

`ipcMain.handle('license:start-trial')`, [`main.js:4398`](../electron/main.js#L4398):

```
POST https://swlpspgmkwzlrowllvvj.supabase.co/functions/v1/trial-license
Authorization: Bearer <ANON_KEY>
apikey: <ANON_KEY>

{ "action": "start", "machineId": "...", "businessName": null, "email": null }
```

Respuesta esperada: `{ success, expiresAt, trialExpired, ... }`. El
`ANON_KEY` es la clave anónima pública de Supabase y ya está en el binario;
no es un secreto y no sustituye a la autorización del lado del servidor.

El endpoint de activación de pago es otro:

```
POST .../functions/v1/license-check
{ "action": "activate", "licenseKey": "...", "machineId": "...", "machineAlias": ... }
```

**La regla del servidor de prueba es "una por máquina"**, y la máquina es el
`machineId` v1. Ahí está el choque real: una demo instalada en la laptop de
quien vende consume la prueba de esa laptop, porque las dos instalaciones
producen el mismo `machineId` — la fórmula solo mira hardware y hostname, y
`userData` no entra en ella.

---

## 3. Qué distingue una licencia de prueba de una de pago

Un solo campo decide, en `computeStatus()`
([`license.js:282`](../electron/license.js#L282)):

```js
const type = data.type || (data.plan === 'trial' ? 'trial' : 'paid');
```

| Campo          | Prueba                        | Pago                        |
| -------------- | ----------------------------- | --------------------------- |
| `type`         | `'trial'`                     | ausente, o `'paid'`         |
| `plan`         | irrelevante                   | `'mono'`, `'multi'`, …      |
| `expiresAt`    | fecha de fin, **obligatoria** | no se usa                   |
| `revalidateBy` | —                             | fecha de próxima revalidación |
| `startedAt`    | informativo                   | —                           |
| `customerName` | informativo                   | se muestra                  |
| `machineId`    | sellado en la primera activación, no se reescribe | igual |
| `fp`           | huella sellada                | igual                       |
| `lastSeen`     | ancla de reloj                | igual                       |

Estados que produce: `none`, `trial`, `active`, `expired`, `tamper`. El
renderer bloquea en `expired` y `tamper`
([`license.service.ts:43`](../src/services/license.service.ts#L43)).

`sellarComoPrueba()` ([`electron/lib/licencia-prueba.js`](../electron/lib/licencia-prueba.js))
fuerza `type: 'trial'` sobre la respuesta remota antes de guardarla, porque una
respuesta sin `type` caía en la rama `paid` y la pantalla anunciaba un plan que
nadie compró.

---

## 4. Qué haría falta para una licencia `DEMO_INTERNAL`

**No implementado, y a propósito.** Lo que sigue es el trabajo que habría que
hacer, casi todo en el backend.

### 4.1 En el backend (lo que no existe hoy)

1. **Un tipo nuevo**, `type: 'demo_internal'`, emitido por un endpoint propio
   —`demo-license`— y no por `trial-license`. Un tipo nuevo en el endpoint de
   prueba obligaría a tocar el flujo que usan los clientes reales.
2. **Autorización real, no una clave en el binario.** El emisor tiene que
   comprobar que quien pide es del equipo: OAuth contra el dominio de la
   empresa, o una clave de corta vida por persona emitida desde el panel
   interno. Una constante compilada en el ejecutable es exactamente lo que el
   encargo prohibió, y con razón: viaja en cada copia del instalador interno.
3. **Que NO consuma la prueba de la máquina.** El endpoint tiene que escribir
   en otra tabla —o con otra clave— que la del `trial-license`, o instalar una
   demo dejará sin prueba al equipo donde se instaló.
4. **Vencimiento corto y renovable**, del orden de 30 días. Una licencia interna
   perpetua filtrada es una licencia de producción gratis.
5. **Revocación**, y que el cliente la respete al revalidar. Sin lista de
   revocación no hay forma de apagar una que se escapó.
6. **Registro de emisión**: quién la pidió, cuándo y para qué máquina.

### 4.2 En el cliente (mínimo, y solo después de lo anterior)

1. `computeStatus()` tendría que reconocer `type === 'demo_internal'` y
   devolver un estado propio —`demo`— con su fecha. **No** mapearlo a `active`:
   una demo no debe poder pasar por instalación de pago en ninguna pantalla.
2. La petición saldría **solo desde `electron/demo/`**, que es la carpeta que no
   se empaqueta en el instalador público. En `main.js` no puede vivir nada de
   esto, o viajaría en el build del cliente.
3. El almacenamiento local **ya está aislado** (ver 1.3): copia principal por
   carpeta, espejo por nombre de archivo. No hay nada pendiente de este lado.
4. Marca visible permanente mientras el estado sea `demo`.

### 4.3 Lo que no se debe hacer, y por qué

- **Debilitar el fingerprint** para que demo y real no choquen. La huella es lo
  que impide copiar una licencia a otra PC; aflojarla para una comodidad interna
  la afloja para todos los clientes.
- **Hardcodear una clave interna**. Viaja en cada instalador interno, no se
  puede rotar sin publicar una versión y no se puede revocar por persona.
- **Un `if (esDemo) return { state: 'active' }`**. Es una línea que alguien
  copia al build público sin darse cuenta de lo que sostenía; sería un bypass de
  licencia dentro del producto, no una herramienta interna.
- **Reutilizar `trial-license` con una bandera**. Mezcla el flujo interno con el
  de clientes reales en el mismo código de servidor.

### 4.4 Mientras tanto

El Demo Manager funciona sin nada de esto: crea, restablece y elimina bases de
datos, que es su trabajo. El estado de licencia de la demo es el mismo que el de
cualquier instalación —prueba o activación— y sus archivos ya no pisan los de la
instalación real.

Lo que sigue compartido es el **`machineId`**, porque es hardware: las dos
instalaciones son la misma máquina y la fórmula no mira dónde están los datos.
La consecuencia práctica es que iniciar una prueba desde la demo consume la
prueba de esa máquina, ya que el servidor la contabiliza por `machineId`. Es una
limitación conocida y deliberada —falsear el identificador sería exactamente el
bypass que no se quiere—, y se resuelve con una decisión de producto sobre el
punto 4.1, no con un parche en el cliente.
