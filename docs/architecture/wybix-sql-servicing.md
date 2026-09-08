# Wybix — Mantenimiento del motor SQL Server

Qué versión del motor instala Wybix, cuál debería mantener y cómo llegar de una
a otra sin parar una tienda a media tarde.

**Estado: IMPLEMENTADO en Wybix 1.2.0.** Una instalacion nueva ya no queda en
RTM: aplica el GDR aprobado y verifica el build antes de crear la base.

---

## 1. Qué hacía la instalación antes de este cambio

Auditado en `installer/ConfigurationFile.ini`, `installer/setup-sqlserver.ps1`
y `electron/setupServer.js`:

| Pregunta | Respuesta |
|---|---|
| ¿El setup de SQL busca actualizaciones al instalar? | **No.** `UpdateEnabled="False"` |
| ¿Se pasa `UpdateSource` con parches locales? | No |
| ¿Se descarga o aplica algún CU o GDR? | No |
| ¿Se comprueba la versión del motor después de instalar? | **No, en ningún punto del código** |
| ¿En qué build queda una instalación nueva? | **15.0.2000.5 — RTM de septiembre de 2019** |

`UpdateEnabled="False"` es una decisión razonable para una instalación
desatendida y offline: evita que el setup se cuelgue buscando en internet en
una tienda sin conexión. Pero deja el motor en RTM y **nada lo mueve después**.

---

## 2. Qué hay realmente instalado

No asumido: consultado.

```
Microsoft SQL Server 2019 (RTM) - 15.0.2000.5 (X64)
    Sep 24 2019 13:48:23
    Express Edition (64-bit) on Windows 10 Pro

ProductVersion      15.0.2000.5
ProductLevel        RTM
ProductUpdateLevel  NULL        <- ningun CU ni GDR aplicado
Edition             Express Edition (64-bit)
```

El dato que importa: **`ProductUpdateLevel` es NULL después de meses de uso.**
No es solo que el medio sea RTM — la instalación real también sigue en RTM.

Y no es porque falte el canal: el servicio *Microsoft Update* está registrado
en esta máquina. Aun así, el motor no se ha movido. Eso no es una hipótesis
sobre lo que podría pasar en casa de un cliente; es lo que pasó aquí.

---

## 3. El riesgo de quedarse en RTM

RTM es el código tal como salió en septiembre de 2019. Desde entonces se han
publicado correcciones de seguridad para SQL Server 2019, incluidas
vulnerabilidades de elevación de privilegios en el motor.

Para Wybix el riesgo está acotado pero no es cero:

- La base **no está expuesta a internet**: vive en la LAN de la sucursal.
- Pero **sí acepta conexiones TCP de otras máquinas** de esa red (es el
  requisito de multicaja: `TCPENABLED="1"`, puerto fijo, `SECURITYMODE="SQL"`).
- Y contiene todo el negocio del cliente: ventas, inventario, clientes.

Una vulnerabilidad de elevación de privilegios explotable desde la red local
importa cuando cualquier equipo de esa red —una caja, la computadora del
dueño, un dispositivo invitado— puede alcanzar el puerto.

---

## 4. Las tres opciones

### A) RTM + Windows Update

Dejar el motor en RTM y confiar en que Windows Update lo mantenga.

| | |
|---|---|
| Tamaño del instalador | sin cambio |
| Trabajo de mantenimiento | ninguno |
| Instalación offline | intacta |
| **Seguridad** | **no verificable** |

**El problema es que no funciona, y está medido**: esta máquina tiene
Microsoft Update registrado y sigue en RTM sin un solo parche. Los
*Cumulative Updates* de SQL Server no se distribuyen como actualización
automática, y los GDR de seguridad requieren que el equipo esté inscrito en
Microsoft Update —no solo Windows Update—, cosa que no ocurre por omisión en
una instalación de Windows de tienda.

Además, aunque funcionara, Wybix no sabría en qué build está cada cliente: no
hay ninguna comprobación en el código.

No es una estrategia. Es la ausencia de una, con el nombre de una.

### B) RTM + GDR aprobado por Wybix

Aplicar sobre RTM el último *General Distribution Release*: la rama que
contiene **solo correcciones de seguridad y de fallos críticos**, sin cambios
funcionales.

| | |
|---|---|
| Superficie de cambio | mínima: seguridad, nada de funcionalidad nueva |
| Riesgo de regresión | **el más bajo de los tres** |
| Tamaño | un parche, no un medio completo |
| Instalación offline | se mantiene: el parche viaja o se aplica aparte |
| Mantenimiento | revisar el catálogo cuando salga un GDR nuevo, poco frecuente |

La rama GDR existe precisamente para esto: instalaciones que quieren estar
parcheadas sin adoptar cambios de comportamiento.

### C) RTM + rama CU

Adoptar los *Cumulative Updates*, que acumulan correcciones funcionales además
de las de seguridad.

| | |
|---|---|
| Correcciones | las más completas |
| Riesgo de regresión | **el más alto**: cambian planes de ejecución, comportamiento del optimizador y de funciones |
| Tamaño | los CU de SQL Server rondan los cientos de MB |
| Decisión irreversible | **una vez en la rama CU no se puede volver a GDR** sin reinstalar |
| Mantenimiento | seguir la cadena de CU indefinidamente |

Un CU se justifica cuando se necesita una corrección concreta que solo está
ahí. Adoptarlo «porque el número es más alto» compra riesgo sin comprar nada.

Nota de ciclo de vida a confirmar contra Microsoft antes de ejecutar: SQL
Server 2019 salió de soporte estándar y está en soporte extendido, lo que
implica que la publicación de CU nuevos ya cesó y la rama que sigue recibiendo
correcciones de seguridad es la GDR. Si eso se confirma, la opción C no solo es
la más arriesgada: es un callejón sin salida.

---

## 5. Decisión

**Opción B: RTM + el GDR de seguridad aprobado por Wybix.** Implementada.

Un punto de venta necesita, en este orden: no perder ventas, no perder datos,
no ser vulnerable. B da lo tercero sin tocar lo primero ni lo segundo. C
mejora marginalmente lo tercero a costa de arriesgar lo primero, y A no da
nada aunque lo parezca.

### El parche aprobado

Verificado contra la documentación de Microsoft el 2026-09-05, no copiado de
memoria:

| | |
|---|---|
| KB | **KB5102336** |
| Rama | GDR |
| Build | **15.0.2180.2** (`FileVersion` 2019.150.2180.2) |
| Fecha | 14 de julio de 2026 |
| Paquete | `SQLServer2019-KB5102336-x64.exe` |
| SHA256 | `576BF5BE2953BEF7B8C718906BCE9D8CB6B38632019B0B57C881161B6FAF438F` |
| Fuente | [KB5102336 en Microsoft Support](https://support.microsoft.com/en-us/servicing/sql/sql-server-2019/general-distribution-release/kb5102336-july) |

Microsoft documenta dos problemas conocidos de este build y **ninguno afecta a
Wybix**, comprobado sobre el código: el primero rompe consultas de *linked
server* con proveedor MSDASQL —Wybix no usa linked servers—; el segundo es una
fuga de memoria con `sys.dm_exec_input_buffer` y `DBCC INPUTBUFFER` —Wybix no
los usa—.

---

## 6. WYBIX SQL ENGINE POLICY

Tres conceptos que no son el mismo y que conviene no mezclar:

| | Que responde | Donde vive |
|---|---|---|
| **COMPATIBILITY VERSION** | con que version mayor esta probado este release | `compatibilidad.major` |
| **SECURITY BRANCH** | en que rama de mantenimiento esta una instancia | `ramaDe()` en el codigo |
| **SECURITY BUILD** | que build hace falta **en esa rama** para estar al dia | `seguridad.ramas.<rama>.buildMinimo` |

```
COMPATIBILITY   SQL Server 2019, major 15.0  (EXACTO, no un minimo)

SECURITY, a 2026-07-14
  rama GDR   KB5102336   15.0.2180.2   <- la que Wybix instala y distribuye
  rama CU    KB5102335   15.0.4480.2   <- solo se reconoce, no se instala
```

Todo vive en `installer/sql-servicing.json`. Ni el script de instalacion ni la
guarda de empaquetado llevan estos numeros escritos dentro.

### Compatibilidad: un contrato, no un minimo

`major == 15`. No `>= 15`.

SQL Server 2022 no se rechaza por ser peor, sino porque **nadie ha comprobado
que el esquema de Wybix se comporte igual ahi**. Un numero mas alto no es lo
mismo que una combinacion probada.

| | Produccion | Desarrollo |
|---|---|---|
| major distinto de 15.0 | **bloquea**, tambien al arrancar | avisa y continua |

Se bloquea tambien en el arranque, no solo al instalar: seguir vendiendo sobre
una combinacion sin certificar no es algo que un aviso arregle. En desarrollo
se avisa para no romper entornos de trabajo.

---

## 7. Seguridad por rama: por que el numero no basta

Este es el error facil de cometer, y cometerlo da por segura una instancia que
no lo esta.

Las dos ramas de SQL Server 2019 **no forman una sola secuencia**:

```
  rama RTM/GDR   15.0.2xxx.x     seguridad de julio 2026 -> 15.0.2180.2  (KB5102336)
  rama CU        15.0.4xxx.x     seguridad de julio 2026 -> 15.0.4480.2  (KB5102335)
```

Microsoft publica **las mismas correcciones dos veces**, una por rama. Y ahi
esta la trampa:

```
  15.0.4430.1  (CU32, anterior a julio 2026)
      >  15.0.2180.2  (GDR de julio 2026)      <- numericamente MAYOR
      <  15.0.4480.2  (CU de julio 2026)       <- y sin embargo DESACTUALIZADO
```

Un CU32 anterior tiene un build mas alto que el GDR mas reciente y **no tiene
sus correcciones**. Compararlo contra `15.0.2180.2` lo daria por al dia.

Por eso cada instancia se evalua contra el objetivo de **su** rama. La rama la
dice `SERVERPROPERTY('ProductUpdateLevel')` -devuelve `CUxx` o `GDR`-, y
cuando es NULL, como en un RTM sin parches, se usa el tercer componente del
build, que separa las dos ramas.

### Que se hace con cada instancia

| Instancia | Al dia si | Alta de host | Arranque |
|---|---|---|---|
| Rama GDR | `>= 15.0.2180.2` | bloquea si no | avisa si no |
| Rama CU | `>= 15.0.4480.2` | bloquea si no | avisa si no |
| Instalada por Wybix | **exactamente** 15.0.2180.2, rama GDR | bloquea si no | — |

**Nunca se migra a nadie entre ramas.** Si una instancia CU esta
desactualizada, el mensaje remite a `KB5102335` -la actualizacion de SU rama-,
no al GDR que Wybix distribuye. Pasar de CU a GDR no es posible sin
reinstalar, y al reves es decision del dueño de esa instancia.

**Wybix tampoco parchea una instancia que no instalo**: no puede demostrar que
le pertenezca y podria estar dando servicio a otra cosa.

---

## 8. Reinicio pendiente (codigo 3010)

El instalador del parche devuelve `0` cuando termino del todo y `3010` cuando
se aplico pero Windows tiene **operaciones pendientes hasta el reinicio**.

**No se tratan igual.** Se busco documentacion oficial que garantizara que el
motor es plenamente utilizable antes de reiniciar y no la hay: lo unico
documentado es que quedan operaciones a medias. Crear la base de un negocio en
ese estado seria apostar sin necesidad.

```
  codigo 0     verifica el build del motor  ->  restaura template  ->  sigue

  codigo 3010  termina la configuracion de red (registro, firewall)
               NO crea ninguna base
               Wybix avisa: "reinicia y vuelve a abrir"
               ↓  (reinicio de Windows)
               al abrir de nuevo: SQL responde, se salta la instalacion,
               se verifica el build de verdad y se sigue donde tocaba
```

**No hizo falta ningun mecanismo de reanudacion**: el flujo ya era reentrante.
`ensureServerReady` comprueba si SQL responde antes de instalar nada, asi que
volver a abrir Wybix despues del reinicio retoma en el punto correcto.

---

## 9. Host y caja secundaria

| | HOST | SECUNDARIA |
|---|---|---|
| Tiene el motor SQL | si | no |
| Instala o parchea el motor | **si** | **no** |
| Lee la version del motor | si | si |
| Informa si el motor no cumple | si | si |

El parche solo se aplica cuando Wybix instala SQL Server, y eso solo ocurre en
el host. Una caja secundaria se conecta a un motor ya instalado en otra
maquina: no lo parchea, no ejecuta servicing remoto y no tendria privilegios.

Lo que si hace una secundaria es **no fingir que la combinacion esta**
**soportada**: si el host corre una version mayor no certificada, lo dice y no
continua en produccion.

---

## 10. Que NO hace este mecanismo

- **No parchea al actualizar Wybix.** Actualizar la aplicacion es reemplazar
  archivos y aplicar migraciones; parchear el motor detiene el servicio SQL.
- **No descarga nada.** El parche viaja en el instalador o no se empaqueta.
- **No corre en desarrollo.** Ni `npm install`, ni `npm run dev`, ni
  `npm start`, ni `db:prepare-release` ejecutan el parche.
- **No migra instancias entre ramas** ni toca un SQL Server que no instalo.
- **No incluye el paquete de la rama CU**: se conoce su objetivo para
  reconocer instancias ajenas, no para instalarlo.

---

## 11. Pruebas

`node scripts/pruebas/servicing-sql.mjs` — **42 comprobaciones**, sin instalar
ni parchear nada. Entre ellas, la que da sentido a todo lo demas:

```
ok  15.0.4430.1 es numericamente MAYOR que 15.0.2180.2
ok  y aun asi NO se considera al dia: es un CU32 anterior a julio de 2026
ok  el mensaje remite al objetivo de SU rama (CU), no al del GDR
```

Cubre ademas: deteccion de rama con y sin `ProductUpdateLevel`; los cuatro
objetivos (GDR viejo/actual, CU viejo/actual); el motor instalado por Wybix;
compatibilidad en produccion y en desarrollo; seguridad en arranque normal;
codigos de salida del parche; y la coherencia del contrato -incluido que el
objetivo de cada rama pertenezca de verdad a esa rama-.

`npm run db:check-template` — comprueba el payload de la rama que se
distribuye: presencia, nombre y SHA256 contra el oficial, mas la coherencia de
los objetivos por rama.

Lo que solo puede hacerse en una maquina limpia esta en
[la lista de comprobacion de la VM](prueba-vm-instalacion.md).
