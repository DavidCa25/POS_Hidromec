# installer/ — qué es cada cosa

Tres tipos de archivo conviven aquí y se tratan distinto. La diferencia
importa: uno se versiona, otro se genera y otro se consigue aparte.

| | Qué es | ¿En Git? | Cómo se obtiene |
|---|---|---|---|
| `ConfigurationFile.ini` | **Fuente.** Instalación desatendida de SQL Server | sí | se edita a mano |
| `setup-sqlserver.ps1` | **Fuente.** Script que orquesta la instalación | sí | se edita a mano |
| `sql-servicing.json` | **Fuente.** Contrato del motor: medio base, parche aprobado y política | sí | se edita a mano |
| `template.bak` | **Artefacto derivado** de Wybix | no | `npm run db:prepare-release` |
| `sqlexpress/` | **Dependencia externa de release** (Microsoft) | no | se descarga de Microsoft, ver abajo |
| `sqlupdates/` | **Dependencia externa de release** (Microsoft) | no | se descarga de Microsoft, ver abajo |

Dos cosas distintas que conviene no mezclar:

- **MEDIO BASE** — `sqlexpress/`, el instalador de SQL Server 2019 Express RTM
  (15.0.2000.5). No cambia entre releases.
- **SERVICING** — `sqlupdates/`, la actualización de seguridad que se aplica
  encima. **Sí puede cambiar** en releases futuros, sin cambiar de SQL Server
  mayor. El número vive en `sql-servicing.json`, no en el código.

---

## sqlexpress/ — dependencia externa de release

**No es código de Wybix ni un artefacto que Wybix genere.** Es el medio oficial
de instalación offline de Microsoft, que viaja dentro del instalador para que
un cliente sin internet pueda instalar el motor de base de datos.

Por eso no está en Git: son 314 MB de binarios de terceros que no cambian con
el desarrollo y que Git no debe versionar ni mover en cada clon.

### Contrato

| | |
|---|---|
| Producto | Microsoft SQL Server |
| Edición | **Express** |
| Versión mayor | **2019** (15.0) |
| Build | **15.0.2000.5** — RTM |
| `FileVersion` de SETUP.EXE | `2019.0150.2000.05 ((SQLServer).190924-2033)` |
| Layout del medio | `Core`, `ReleaseTrain = BASELINE` |
| Idioma | ENU (1033) |
| Arquitectura | x64 |
| Ubicación esperada | `installer/sqlexpress/` |
| Tamaño aproximado | 314 MB |

### De dónde salen esos datos

No se dan por supuestos: se leen del propio medio.

- `MEDIAINFO.XML` → `BaselineVersion = 15.0.2000.5`, `MediaLayout = Core`,
  `ReleaseTrain = BASELINE`.
- Metadatos de `SETUP.EXE` → `ProductVersion 15.0.2000.5`,
  `FileVersion 2019.0150.2000.05`, `Microsoft Corporation`.
- `x64/Setup/SQL_ENGINE_CORE_INST.MSI` → `ProductName = SQL Server 2019
  Database Engine Services`, `ProductVersion = 15.0.2000.5`.

**La edición** no aparece escrita en ningún archivo del medio —los MSI del
motor son comunes a todas—, así que se deduce de lo que el medio **no** trae:
no hay un solo componente de Analysis Services (`AS_*`), Integration Services
(`DTS_*`), Reporting (`RS_*`), Master Data Services (`MDS_*`) ni PolyBase. Solo
están los 11 MSI del motor y sus utilidades. Un medio Developer o Standard pesa
más de 1 GB y los incluye; éste pesa 314 MB y no. Eso, con el layout `Core`, es
Express.

### Huellas de los archivos que importan

Sirven para confirmar que dos máquinas tienen el mismo medio sin recorrer los
314 MB:

```
SETUP.EXE                          142 944 bytes
  SHA256  37AB97C4806497FC2E5CD66FF81E95168DF0198C8A6853A56A1C9B1EA465119F

x64/Setup/SQL_ENGINE_CORE_INST.MSI 101 408 768 bytes
  SHA256  27133E802520B0DF569070515D63F804F61F7FF3ED38D404500E4B3ADEB867E0
```

El segundo es el paquete del motor: si coincide, el payload es el mismo. No se
calcula un hash del árbol completo porque recorrer 314 MB en cada empaquetado
cuesta minutos y no añade certeza sobre estos dos.

### Cómo conseguirlo

Descargar de Microsoft el instalador de **SQL Server 2019 Express** y, en el
asistente, elegir **«Descargar medios» → «Paquete de instalación ISO/CAB»** en
inglés (ENU), x64. Extraer el contenido —el que tiene `SETUP.EXE` en la raíz—
dentro de `installer/sqlexpress/`.

La estructura mínima que debe quedar:

```
installer/sqlexpress/
  SETUP.EXE
  MEDIAINFO.XML
  x64/
    Setup/
      SQL_ENGINE_CORE_INST.MSI
      SQL_ENGINE_CORE_SHARED.MSI
      SQL_COMMON_CORE.MSI
      ...
  1033_ENU_LP/
  resources/
```

`npm run db:check-template` lo verifica antes de empaquetar y falla con
instrucciones si falta o no corresponde.

### Cambiar de versión

No se hace a la ligera: `ConfigurationFile.ini` y `setup-sqlserver.ps1` están
escritos contra el comportamiento de este medio. Cambiarlo obliga a repetir la
instalación limpia completa en una máquina sin SQL Server. Hoy no está previsto.

---

## sqlupdates/ — actualización de seguridad del motor

El medio base es RTM de septiembre de 2019. Dejar ahí el motor significaría
entregar a cada cliente un SQL Server sin los parches de seguridad publicados
desde entonces — y en Wybix ese motor acepta conexiones TCP de otras máquinas
de la red, porque es el requisito de multicaja.

Por eso **toda instalación nueva queda parcheada antes de crear la base**.

### Contrato

| | |
|---|---|
| Rama | **GDR** (solo seguridad, sin cambios de comportamiento) |
| Rama CU equivalente | KB5102335 -> 15.0.4480.2 · **no viaja**: Wybix no instala esa rama, solo la reconoce |
| KB | **KB5102336** |
| Build resultante | **15.0.2180.2** (`FileVersion` 2019.150.2180.2) |
| Fecha | **14 de julio de 2026** |
| Paquete | **`SQLServer2019-KB5102336-x64.exe`** |
| SHA256 | `576BF5BE2953BEF7B8C718906BCE9D8CB6B38632019B0B57C881161B6FAF438F` |
| Arquitectura | x64 |
| Ubicación esperada | `installer/sqlupdates/` |
| Fuente | [KB5102336 en Microsoft Support](https://support.microsoft.com/en-us/servicing/sql/sql-server-2019/general-distribution-release/kb5102336-july) |
| Verificado el | 2026-09-05 |

Estos datos no se copian aquí a mano: son los de `sql-servicing.json`, que es
lo que leen el instalador y la guarda de empaquetado.

### Problemas conocidos de este parche

Microsoft documenta dos, y ninguno afecta a Wybix (comprobado sobre el código):

1. Consultas de *linked server* con el proveedor MSDASQL y cadena de proveedor
   fallan con error 7416. **Wybix no usa linked servers.**
2. Fuga de memoria al usar `sys.dm_exec_input_buffer` o `DBCC INPUTBUFFER`.
   **Wybix no los usa.**

### Cómo conseguirlo

Descargar `SQLServer2019-KB5102336-x64.exe` del Centro de descarga de Microsoft
o del Catálogo de Microsoft Update, y dejarlo en `installer/sqlupdates/` sin
renombrarlo.

`npm run db:check-template` comprueba antes de empaquetar que está, que se
llama como debe y que **su SHA256 es el oficial**. Si falta o no coincide, el
empaquetado falla: no se construye un instalador que deje motores sin parchear.

### Cambiar de parche en un release futuro

Se edita `installer/sql-servicing.json` —`kb`, `build`, `fecha`, `paquete`,
`sha256`, `fuente`— y se pone el archivo nuevo en `installer/sqlupdates/`. No
hay que tocar código: ni el script de instalación ni la guarda llevan el número
escrito dentro.
