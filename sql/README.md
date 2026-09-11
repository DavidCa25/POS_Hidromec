# SQL de Wybix — control de versiones

La definición de **todo** el SQL que Wybix necesita para funcionar vive aquí, en
texto revisable. Antes vivía dentro de `installer/template.bak`, un archivo
binario que además está en `.gitignore`: si se perdía, se perdía la lógica de
negocio.

---

## Qué hay aquí

```
sql/
  manifest.json          inventario declarativo: qué objetos espera Wybix
  schema/tables/         una tabla por archivo, con sus claves e índices
  procedures/<dominio>/  una definición canónica por procedure
  types/                 tipos de tabla (SaleDetailType, PurchaseDetailType…)
  baseline/v1/           infraestructura de versionado y seed estructural
  _heredado/             archivos sueltos anteriores. Ver su LEEME.md
  _historial-preproduccion/  migraciones anteriores al baseline. No se aplican
```

Los dominios (`sales`, `cash`, `inventory`, `suppliers`, `billing`, `security`,
`cloud`, `setup`, `reports`, `customers`, `purchases`, `whatsapp`) se definen en
`scripts/db/lib/catalogo.mjs`. Un objeto que no esté catalogado se extrae a
`sin-clasificar/` y el extractor lo reporta: nada entra al árbol sin decisión.

**El historial incremental vive en `electron/migrations/`, hoy vacío.** Este
árbol dice *cómo debe quedar* cada objeto; las migraciones dicen *cómo se
llega* desde una instalación ya entregada. Desde Baseline V1 no hay ninguna:
una base nueva nace completa. Ver «El baseline» más abajo.

---

## Los comandos

```bash
npm run db:verify                      # ¿la base coincide con Git?
npm run db:verify -- Hidromec_DataBase # contra otra base
npm run db:verify -- Wybix_Production --detalle   # muestra la primera línea que difiere

npm run db:extract                     # regenera procedures y tipos desde la base
npm run db:extract-schema              # regenera sql/schema/tables desde la base
npm run db:migration -- 0008 nombre sp_x sp_y     # compone una migración
npm run db:test-migration              # instalación limpia + migraciones, en BD temporal
npm run db:test-rebuild                # levanta una base entera SOLO desde Git
npm run db:compare-schema -- BaseA BaseB          # diferencias de esquema entre dos bases

npm run db:baseline                    # construye template.bak V1 desde Git
npm run db:test-install                # abre ese .bak como lo abriría una caja nueva
```

`db:verify`, `db:extract`, `db:extract-schema` y `db:compare-schema` son de
**solo lectura**: `scripts/db/lib/sql.mjs` rechaza cualquier consulta que
contenga una sentencia de escritura.

`db:test-migration`, `db:test-rebuild`, `db:baseline` y `db:test-install` son
los únicos que escriben, y solo sobre una base temporal que ellos mismos crean
y borran.
`scripts/db/lib/temporal.mjs` rechaza cualquier nombre de base que no encaje
con el patrón temporal, así que no puede tocar una base de trabajo por error.

---

## Cómo cambiar un stored procedure

**No lo edites en SSMS.** Ese es exactamente el hábito que dejó dos procedures
existiendo solo dentro de una base de datos, sin copia en ningún sitio.

```
1. Edita el archivo canónico
      sql/procedures/<dominio>/sp_lo_que_sea.sql

2. Compón la migración
      npm run db:migration -- 0008 descripcion-corta sp_lo_que_sea

3. Pruébala
      npm run db:test-migration

4. Comprueba que no quedó deriva
      npm run db:verify

5. Commit de los dos: el archivo canónico y la migración.
```

La aplicación aplica `electron/migrations/*.sql` al arrancar
(`main.js` → `runMigrations`), así que el cambio llega solo con la siguiente
actualización.

### Numeración

**El historial productivo arranca de cero en Baseline V1.** La primera
migración real se llamará `0001_<primer_cambio_real>.sql`.

Los números `0001`, `0002`, `003`–`006` y `0007` que se usaron antes **no
cuentan**: pertenecen al periodo de desarrollo, están archivados en
`sql/_historial-preproduccion/` y ninguna instalación productiva depende de
ellos. No hay riesgo de colisión porque no existe ninguna base productiva con
esos nombres registrados; las que los tienen son máquinas de prueba, y la ruta
para ellas es reinstalar desde el `.bak` del baseline.

---

## Cómo se calcula la deriva

`db:verify` compara un checksum de la **forma canónica**, no del texto crudo.
La normalización está en `scripts/db/lib/canonico.mjs` y hace cuatro cosas:

1. Finales de línea a `\n`.
2. Recorta el espacio al final de cada línea.
3. Quita líneas en blanco al principio y al final.
4. Unifica el verbo a `CREATE OR ALTER` con **un solo espacio** antes del tipo.

El punto 4 no es cosmético. **SQL Server no guarda `CREATE OR ALTER`**: al
ejecutarlo reescribe la cabecera según lo que hizo realmente —`CREATE` si el
objeto no existía, `ALTER` si ya existía— y rellena con espacios para conservar
la longitud. El mismo procedure aparece como:

```
CREATE   PROCEDURE dbo.x          recién creado
ALTER     PROCEDURE dbo.x         actualizado
CREATE OR ALTER PROCEDURE dbo.x   en el archivo de Git
```

Sin colapsar ese hueco, **todas** las instalaciones darían deriva. Está
verificado ejecutando un `CREATE OR ALTER` y leyendo la definición de vuelta.

Lo que **no** se normaliza, a propósito: sangría interior, saltos de línea
internos, comentarios y mayúsculas. Colapsar espacios haría el checksum más
estable pero ciego a un cambio dentro de una cadena o un comentario. Se
prefiere un falso positivo que obligue a mirar, a un falso negativo que oculte
una edición hecha a mano en producción.

---

## Estados que devuelve `db:verify`

| Estado | Significa |
|---|---|
| `OK` | Existe y coincide. |
| `FALTA` | Está en Git y no en la base. Si es crítico, esa base no puede operar. |
| `DERIVADO` | Existe en ambos, pero el cuerpo difiere. Alguien lo editó a mano, o el archivo cambió sin migración. |
| `EXTRA` | Está en la base y no en Git. **Rescatarlo antes de perderlo.** |
| `PENDIENTE` | Está en Git y aún no se ha desplegado. Esperado, no es error. |

Hoy hay dos `PENDIENTE`: `sp_cloud_daily_profit` y `sp_import_sales`. Nunca
llegaron a ninguna base; su código solo existía en archivos del repositorio.
Están declarados en `scripts/db/lib/solo-repo.mjs` para que la herramienta sepa
que su ausencia es conocida.

---

## Comprobación al arrancar

Después de aplicar migraciones, `main.js` verifica que estén los objetos de
`electron/objetos-criticos.json` (lo genera `db:extract`; vive bajo `electron/`
porque `sql/` no viaja en el instalador). Si falta alguno, la aplicación muestra
un error con la lista y **no continúa**.

Es una comprobación de presencia, no de contenido: dos consultas a `sys`.
Comparar 108 checksums en cada arranque costaría más de lo que aporta; para eso
está `db:verify`.


---

## El esquema estructural

`sql/schema/tables/` tiene un archivo por tabla, con **todo** lo que la define:
columnas con su tipo y colación, `IDENTITY`, `DEFAULT`, `PRIMARY KEY`,
`UNIQUE`, `CHECK`, claves foráneas con su `ON DELETE`/`ON UPDATE`, e índices
con sus columnas incluidas y su filtro.

### Por qué se reconstruye y no se copia

SQL Server **no guarda el texto** de un `CREATE TABLE`. Solo guarda el
resultado en catálogos (`sys.tables`, `sys.columns`, `sys.indexes`…). Con los
procedures existe `sys.sql_modules.definition` y se puede extraer el original;
con las tablas no hay tal cosa. Estos archivos son una reconstrucción
**equivalente, no literal**, y por eso deben ser **deterministas**: todo se
ordena explícitamente (columnas por posición, constraints por nombre, columnas
de índice por clave) para que el mismo esquema produzca siempre el mismo texto.

### Constraints sin nombre propio

Cuando una constraint se declara sin nombre, SQL Server le inventa uno con un
sufijo distinto **en cada base**: `PK__security__3213E83F996354FB` aquí y
`…45CC39F1` allá, para la misma estructura.

Por eso, cuando el original no tenía nombre propio (`is_system_named`), el
archivo canónico **tampoco lo pone** — deja que SQL Server lo invente otra vez —
y la huella de comparación lo sustituye por `<auto>`. Sin esto, cada
instalación aparecería como derivada.

### Qué se compara

La deriva de esquema **no compara el texto** del `CREATE TABLE`, porque no
existe un texto original con el que comparar. Compara una *huella estructural*:
lista ordenada de columnas con tipo y nulabilidad, identidad, defaults, claves,
constraints e índices. Estructura, no formato.

### Reconstrucción desde cero

`npm run db:test-rebuild` crea una base temporal vacía y aplica, en orden:

```
schema/tables   →  tablas → CHECK → FK → índices
types           →  tipos de tabla
procedures      →  procedures
```

Las fases importan: una clave foránea no puede crearse antes que la tabla a la
que apunta, y los archivos están organizados por tabla, no por dependencia.

La base temporal se crea con la colación `Modern_Spanish_CI_AS`. Una base nueva
hereda la del servidor (`SQL_Latin1_General_CP1_CI_AS`) y reconstruir con la
colación equivocada produce conflictos al comparar cadenas.

**Esto no cambia el instalador**, que sigue usando `template.bak` + migraciones.
Es la comprobación de que el árbol canónico está completo.

---

## El baseline

`installer/template.bak` es **WYBIX DATABASE BASELINE V1**: el punto de partida
de toda instalación nueva, y el **único** template oficial. Es el archivo que
`electron/setupServer.js` restaura y el único que `package.json` empaqueta en
`extraResources`. No debe existir un segundo `.bak` en `installer/`: dos
artefactos equivalentes solo sirven para divergir.

Lo importante es de dónde sale. No es una copia de `Wybix_Production` ni de
ninguna otra base viva: `npm run db:baseline` crea una base temporal **vacía** y
la llena solo con lo que hay en este árbol, en este orden:

```
base temporal vacía
  ↓  sql/schema/tables/          tablas → CHECK → FK → índices
  ↓  sql/types/                  tipos de tabla
  ↓  sql/procedures/             procedures desplegables
  ↓  sql/baseline/v1/00_*.sql    schema_migrations + database_metadata
  ↓  sql/baseline/v1/01_seed.sql seed estructural
  ↓  verificación
  ↓  BACKUP DATABASE             solo si todo pasó
installer/template.bak
```

El `BACKUP` es el último paso y solo se ejecuta si la verificación pasó, así que
un fallo nunca deja el template a medias.

Eso invierte la relación que había antes: **Git es la fuente de verdad y el
`.bak` es un artefacto derivado**, reproducible en cualquier momento. Si el
archivo se pierde, se regenera con un comando.

### Qué se despliega y qué no

`scripts/db/lib/catalogo.mjs` clasifica cada objeto:

| Clase | Cuántos | Se despliega | Qué es |
|---|---|---|---|
| `current` | 98 | sí | producto |
| `incierto` | 7 | sí | los `sp_WA_*`: existen, compilan y hoy ya viajan dentro del template, pero ningún punto del código los invoca |
| `futuro` | 2 | **no** | `sp_import_sales` y `sp_cloud_daily_profit`: escritos, nunca desplegados, y hoy no compilan contra el esquema real |
| `legacy` | 1 | **no** | `sp_mig_test` |

**Total desplegado: 105 de 108.** `repartirPorClase()` en
`scripts/db/lib/catalogo.mjs` es la única definición de ese conjunto:
`db:baseline`, `db:test-rebuild`, `db:test-install` y `db:verify` la consumen,
ninguno vuelve a filtrar por su cuenta. Cuando `db:test-rebuild` decidía solo,
desplegaba los 108 del manifiesto y metía `sp_mig_test` en la base — reportaba
106 donde el baseline reportaba 105.

Los `futuro` se quedan en Git a propósito: perderlos sería perder trabajo hecho.
El baseline comprueba explícitamente que ninguno de los dos grupos de abajo se
haya colado en la base.

### Seed estructural

Solo tres filas, y ninguna es dato de negocio:

| Tabla | Fila | Por qué es obligatoria |
|---|---|---|
| `registers` | `C1` / Caja 1 | `sp_register_sale` resuelve la caja contra esta tabla |
| `WA_Configuracion` | singleton, `Activo = 0` | `sp_WA_UpdateConfiguracion` hace `UPDATE` sin upsert: sin la fila el módulo queda inerte sin avisar |
| `database_metadata` | `baseline_version = 1` | de qué punto de partida nació la base |

**Cero usuarios y cero `business_config`**: el alta del primer administrador es
de `sp_setup_inicial`, ya en manos del cliente. No se entrega ninguna credencial
por defecto.

### La tabla `database_metadata`

Responde a lo que `schema_migrations` no puede responder tras un reseteo de
historial: *¿desde qué punto de partida nació esta base?* Sin ella, una base
recién instalada y una base vieja a la que alguien le vaciara la tabla de
migraciones serían indistinguibles.

Junto con `schema_migrations`, es infraestructura del mecanismo de versionado,
no esquema de producto. Por eso vive en `sql/baseline/v1/` y por eso
`db:extract-schema` la excluye: versionarla junto al producto duplicaría su
definición y haría que el contenido de sus filas —distinto en cada
instalación— apareciera como deriva.

### Cortar un baseline nuevo (V2)

Cuando el árbol canónico se aleje lo suficiente del `.bak` actual:

1. `npm run db:baseline` — construye, verifica y sustituye `installer/template.bak`.
2. `npm run db:test-install` — lo abre como lo abriría una caja nueva.
3. **Conservar las migraciones productivas**: las instalaciones ya entregadas
   siguen necesitándolas para llegar al mismo punto. Un baseline nuevo solo
   cambia el punto de partida de las instalaciones futuras.

El paso 3 es la diferencia con lo que se hizo en V1. Allí se pudo vaciar el
historial porque **ninguna instalación productiva dependía de él**. Eso deja de
ser cierto en cuanto haya un cliente real con una migración aplicada.
