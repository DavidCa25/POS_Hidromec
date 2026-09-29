# Wybix Local Host y KDS en la red local

> El KDS es ahora la primera **Pantalla Operativa** (superficie `PREPARATION`).
> Mesero, Mi jornada, Técnico, Inventario y Estado de pedidos viven sobre este
> mismo Host: ver [operational-surfaces.md](operational-surfaces.md).

Las pantallas de cocina (KDS) en tablets o celulares, dentro de la red del
local, **con o sin Internet**. El router solo reparte direcciones.

```
Tablet ──HTTP LAN──> Wybix Local Host (proceso principal de Electron)
                          │
                          └──> procedimientos de siempre (sp_kds_get, sp_comanda_estado)
                                     │
                                     └──> SQL Server
```

La tablet **nunca** habla con SQL Server, nunca ve una credencial de SQL y
nunca usa el puerto 1433. Internet no forma parte del camino de una comanda.

## Piezas

| Archivo | Qué hace |
| --- | --- |
| `electron/local-host/index.js` | Orquesta: rol de Host, arriendo en la base, servidor, eventos, canales IPC `localhost:*` |
| `electron/local-host/servidor.js` | La superficie HTTP que ve una tablet (y nada más) |
| `electron/local-host/eventos.js` | Tiempo real: lee los cambios confirmados de `comandas` y avisa por Server-Sent Events |
| `electron/local-host/repositorio.js` | Arriendo, emparejamientos y dispositivos (tablas de la migración 0044) |
| `electron/local-host/credenciales.js` | Tokens y credenciales: aleatorios de 256 bits, en la base solo el SHA-256 |
| `electron/local-host/red.js` | Interfaces de la red local e Internet (NCSI), por separado |
| `electron/local-host/firewall.js` | Diagnóstico del firewall y la única regla que se puede crear, a petición |
| `electron/local-host/kds-web/` | La pantalla de la tablet: HTML, CSS y JS propios, sin librerías |
| `electron/lib/kds-dominio.js` | El dominio del KDS: listar, una comanda, avanzar un paso (idempotente) |
| `electron/migrations/0044_local-host.sql` | `local_host_lease`, `dispositivos_locales`, `dispositivos_emparejamientos`, `comandas.version` |
| `src/app/dispositivos-locales-panel/` | Configuración → Dispositivos locales |

## Quién es el Host

Una sola computadora por base, y solo si se cumplen las tres condiciones:

1. es la instalación **principal** (`install-config.json` → `role: principal`);
2. tiene el **arriendo** `local_host_lease` en la base (se toma de forma atómica,
   con `UPDLOCK, HOLDLOCK`, y se renueva cada 30 s; caduca a los 90 s sin latido);
3. está **encendido** en Configuración → Dispositivos locales (o se generó un QR,
   que es pedirlo). Una instalación que no lo usa no abre ningún puerto.

Una segunda computadora con la misma base ve quién tiene el arriendo y no
escucha (`OTRO_HOST`). Si el Host pierde el arriendo, deja de servir. No hay
failover automático entre equipos.

## Puerto

**TCP 7427**, fijo. No 8787 (herramientas de desarrollo), no 80/8080 (IIS,
proxies). `WYBIX_LOCAL_HOST_PUERTO` existe solo para las pruebas.

Escucha en `0.0.0.0`. Lo que se **anuncia** (el QR) es solo una IPv4 privada
(10/8, 172.16/12, 192.168/16) de una interfaz física: nunca `127.0.0.1`, nunca
adaptadores virtuales (Hyper-V, WSL, Docker, VirtualBox, VMware) ni VPN
(Tailscale, ZeroTier, WireGuard…). Primero Ethernet, luego Wi-Fi.

## Superficie expuesta (toda)

| Método | Ruta | Credencial | Para qué |
| --- | --- | --- | --- |
| GET | `/health`, `/salud` | no | ¿está vivo? Sin datos del negocio |
| GET | `/`, `/kds`, `/pair/:token` | no | la página (estática; no canjea nada) |
| GET | `/kds/*.js|css|svg|png|webmanifest` | no | estáticos de `kds-web/` |
| POST | `/api/pair` | token del QR | canjea el token por la credencial del dispositivo |
| GET | `/api/kds/estado` | sí | la estación del dispositivo y sus comandas pendientes |
| POST | `/api/kds/comandas/:id/avanzar` | sí | un paso adelante, diciendo desde qué estado |
| GET | `/api/kds/eventos` | sí | tiempo real (Server-Sent Events) |

Todo lo demás es 404. No hay usuarios, reportes, ventas, inventario,
configuración, cancelar, SQL ni nada administrativo: una credencial de KDS no
abre otra puerta porque no hay otra puerta.

## Emparejar

1. En la computadora principal: **Configuración → Dispositivos locales →
   Conectar pantalla**, nombre y estación (o «Todas las estaciones», explícito).
2. Wybix muestra un QR con `http://IP_LAN:7427/pair/TOKEN`.
   - El token: 256 bits aleatorios, **un solo uso**, **caduca en 10 minutos**,
     ligado a la estación y al alcance `KDS`, guardado solo como SHA-256.
   - No lleva secretos del negocio.
3. La tablet abre la página y toca **Conectar esta pantalla**: el Host canjea el
   token (atómico: dos tablets con el mismo QR → entra una) y crea el
   dispositivo con **su propia credencial**, en una cookie `HttpOnly;
   SameSite=Strict`. En la base, solo el hash.

Cada dispositivo guarda: `id`, `nombre`, `station_id` / `todas`, `alcance`,
`credencial_hash`, `emparejado_en/por`, `ultimo_contacto`, `ultima_ip`,
`revocado_en/por`.

**Revocar** («Desconectar») es inmediato: la conexión en tiempo real se corta
en el acto y la siguiente petición recibe 401.

## Tiempo real

**Server-Sent Events**, no WebSocket. El tiempo real va en una dirección (Host
→ pantalla); lo que hace la pantalla son POST normales. SSE es HTTP puro, Node
lo sirve sin dependencias, el navegador reconecta solo (Chrome Android, Safari
iPad, Edge) y pasa por cualquier router. Si más adelante se necesita
bidireccional, WebSocket cabe detrás de la misma credencial.

- **La base es la verdad.** El Host no se entera por la caja (la caja 2 es otro
  proceso, en otra máquina): cada 700 ms pregunta a la base «¿qué cambió desde
  la versión N?» (`comandas.version`, ROWVERSION). Solo lee lo **confirmado**:
  un aviso nunca sale antes del commit (probado con una transacción abierta).
- `nueva` = comanda creada después de arrancar el Host y vista por primera vez.
  Todo lo demás es `cambio`.
- Al (re)conectar, la pantalla pide el **estado completo** y reconcilia. Cada
  30 s revisa por si un aviso se perdió sin que la conexión se notara caída.

## Avanzar sin duplicar

La pantalla manda `{ desde: 'NUEVA' }`. El Host lee y mueve **en una
transacción con la fila bloqueada** (`UPDLOCK`): si otra pantalla ya la movió,
o este mismo toque ya llegó y se perdió la respuesta, contesta `repetido` y no
la avanza dos veces. Las transiciones las decide el backend (`SIGUIENTE` +
`sp_comanda_estado`, solo hacia adelante).

## Sonido

- Generado en la página con WebAudio (dos notas, La5 → Mi6). Ningún archivo,
  nada descargado, nada de terceros.
- El navegador solo deja sonar después de tocar la pantalla: franja **Activar
  sonido** hasta que se toca.
- Por pantalla: ON/OFF, volumen y **Probar sonido** (Ajustes). Se guarda en esa
  tablet.
- Suena **solo** una comanda `nueva` en tiempo real. Lo que se recupera al
  reconectar **no suena**: se anuncia una vez, en texto («3 comandas pendientes
  recuperadas»).

## Firewall

- **Revisar firewall** solo lee (`Get-NetFirewallRule`, `Get-NetConnectionProfile`).
- **Permitir pantallas en el firewall**, solo si la persona lo pide y lo
  confirma. Crea **una** regla:
  `New-NetFirewallRule -DisplayName "Wybix Local Host (TCP 7427)" -Direction Inbound -Protocol TCP -LocalPort 7427 -Action Allow -Profile Private,Domain -RemoteAddress LocalSubnet`
  Windows pide permiso de administrador (UAC).
- Nunca: desactivar el firewall, abrir SQL (1433), abrir a Internet, perfil
  Público, cambios silenciosos.
- Si Windows marcó la red como **Pública**, la pantalla lo dice y explica cómo
  cambiarla a Privada; Wybix no la cambia.

Regla manual equivalente (PowerShell como administrador):

```powershell
New-NetFirewallRule -DisplayName "Wybix Local Host (TCP 7427)" -Direction Inbound -Protocol TCP -LocalPort 7427 -Action Allow -Profile Private,Domain -RemoteAddress LocalSubnet
```

## Router

Nada. Sin UPnP, sin redirección de puertos, sin túneles, sin VPN. Todo pasa
dentro de la red del local.

## HTTPS, PWA y lo que el navegador no permite por HTTP en la LAN

La página se sirve por `http://IP_LAN`. Para el navegador **no es un contexto
seguro** (solo lo son HTTPS y `localhost`). Consecuencias, encontradas y
aceptadas:

| Qué | Por HTTP en la LAN | Qué hacemos |
| --- | --- | --- |
| Service Worker / PWA instalable completa | No disponible | No se promete. «Agregar a pantalla de inicio» funciona como acceso directo; sin modo sin conexión |
| Wake Lock (pantalla siempre encendida) | No disponible | Se intenta y se ignora si falla. En la tablet: Ajustes → Pantalla → nunca apagar, o modo kiosco/fijar app |
| Notificaciones push | No | Fuera de esta fase |
| WebAudio | Sí, tras un toque | «Activar sonido» |
| Cookies HttpOnly/SameSite | Sí | La credencial va ahí |
| EventSource (SSE) | Sí | Tiempo real |

Hacer HTTPS en la LAN exige un certificado en el que confíe la tablet (CA
propia instalada en cada dispositivo o un dominio público con DNS local). No se
hace ningún truco (certificados autofirmados que obliguen a «continuar de todos
modos», flags de Chrome). Queda como decisión futura.

## Con y sin Internet

La operación es idéntica. La pantalla de Configuración muestra **Red local** e
**Internet** por separado; Internet «No disponible» no es un error.

## Salida futura

La estación ya tiene `salida` (`PANTALLA`, `IMPRESORA`, `AMBOS`): la misma
arquitectura sirve para una salida `PRINTER` / `SCREEN_AND_PRINTER` por la red
cuando se implemente. Hoy la impresora de comandas sigue siendo la del equipo.

---

## Laboratorio manual: router sin Internet

Material: un router cualquiera, la computadora con Wybix (instalación
principal) y una tablet Android o iPad.

1. **Desconecta el cable WAN del router** (el que viene del módem). El router
   sigue encendido.
2. Conecta la **computadora Wybix por Ethernet** al router.
3. Conecta la **tablet al Wi-Fi** de ese router.
4. Abre **Wybix** en la computadora e inicia sesión como administrador.
5. Ve a **Configuración → Dispositivos locales** y verifica:
   - **Red local: Activa** (Ethernet · 192.168.x.x);
   - **Internet: No disponible** · «No hace falta para las pantallas».
   Enciende **Permitir pantallas en la red local** si está apagado. Si es la
   primera vez: **Revisar firewall** → **Permitir pantallas en el firewall** →
   acepta el aviso de Windows.
6. **Conectar pantalla** → nombre «Tablet Cocina», estación **Cocina** →
   **Generar código**.
7. En la tablet, abre la **cámara** y **escanea el QR**. Abre el enlace.
8. Toca **Conectar esta pantalla**. Debe aparecer **Cocina** con «Conectado».
9. Toca **Activar sonido** (o cualquier parte de la pantalla). En **Ajustes →
   Probar sonido**, confirma que suena.
10. En la computadora, abre **Touch** (o Venta) y toca **Aquí → Mesa 1**.
11. Agrega un producto que prepare **Cocina** (en esta prueba, un
    «Americano» asignado a Cocina).
12. Toca **Enviar** (enviar a preparación).
13. La tablet, en menos de un segundo, debe:
    - mostrar el ticket en **Nuevas**;
    - **sonar una vez**;
    - decir **Mesa 1**.
14. En la tablet, toca **Empezar** → pasa a **En preparación**.
15. Toca **Lista** → pasa a **Listas**.
16. En la computadora, la cuenta de la Mesa 1 (Touch/Venta o Cocina) debe
    mostrar el estado **Listo**.
17. **Apaga el Wi-Fi de la tablet.** La tablet dice «Reconectando…» y, a los
    pocos segundos, «No hay conexión con Wybix».
18. En la computadora, en otra mesa, **envía otra comanda** a Cocina.
19. **Vuelve a encender el Wi-Fi** de la tablet.
20. La tablet debe **recuperar la comanda pendiente** y decir
    «1 comanda pendiente recuperada».
21. **No debe duplicarse** ninguna tarjeta.
22. **No debe sonar** por la recuperación (ni una vez por comanda).

Después **repite todo con el cable WAN conectado** (router con Internet). En
el paso 5 verás «Internet: Disponible». Todo lo demás debe ser idéntico.

### Si algo no funciona

| Síntoma | Causa probable | Qué hacer |
| --- | --- | --- |
| La tablet no abre la página | Firewall | Revisar firewall → Permitir. Si dice «red Pública», cámbiala a Privada |
| La tablet no abre la página | Otra red | Tablet y computadora en el mismo router (no la red de invitados) |
| «Otro programa usa el puerto 7427» | Puerto ocupado | Cierra ese programa; el Host reintenta solo |
| «Otra computadora ya atiende las pantallas» | Arriendo | Es correcto: solo una por base. Apágalo allí o espera 90 s tras cerrarla |
| «Este código ya se usó / caducó» | QR de un uso, 10 min | Genera otro |
| No suena | El navegador exige un toque | Activar sonido; revisar volumen y el interruptor en Ajustes |
| La pantalla se apaga | Sin Wake Lock por HTTP | Ajustes de la tablet → no apagar pantalla |

## Pruebas automáticas

```
npm run test:local-host
```

Base temporal real, Host real y un Chromium real para sonido, tema y tacto.
Cubre las 30 pruebas de la especificación. Safari iPad se prueba a mano (arriba).
