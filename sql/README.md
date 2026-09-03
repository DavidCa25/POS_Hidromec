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
  _heredado/             archivos sueltos anteriores. Ver su LEEME.md
```

Los dominios (`sales`, `cash`, `inventory`, `suppliers`, `billing`, `security`,
`cloud`, `setup`, `reports`, `customers`, `purchases`, `whatsapp`) se definen en
`scripts/db/lib/catalogo.mjs`. Un objeto que no esté catalogado se extrae a
`sin-clasificar/` y el extractor lo reporta: nada entra al árbol sin decisión.

**El historial incremental sigue en `electron/migrations/`.** Este árbol dice
*cómo debe quedar* cada objeto; las migraciones dicen *cómo se llega*.

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
```

`db:verify`, `db:extract`, `db:extract-schema` y `db:compare-schema` son de
**solo lectura**: `scripts/db/lib/sql.mjs` rechaza cualquier consulta que
contenga una sentencia de escritura.

`db:test-migration` y `db:test-rebuild` son los únicos que escriben, y solo
sobre una base temporal que ellos mismos crean y borran.
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

**Los números `003`, `004`, `005` y `006` están quemados.** Existen como
archivos vacíos y están registrados como aplicados en `schema_migrations` de
instalaciones reales; el runner nunca los volvería a ejecutar. La siguiente
migración válida es la que siga a la última usada (`0007`).

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

## Actualizar el baseline (`template.bak`)

Todavía **no** se ha hecho, a propósito. Primero había que demostrar que

```
template.bak  +  migraciones  =  estado CURRENT
```

lo cual `npm run db:test-migration` ya confirma. Cuando se decida cortar un
baseline nuevo, el orden razonable sería:

1. Restaurar `template.bak` en una base limpia.
2. Aplicar todas las migraciones.
3. Verificar con `db:verify` que da `0 FALTA` y `0 DERIVADO`.
4. Respaldar esa base como el nuevo `template.bak`.
5. **Conservar las migraciones**: las instalaciones existentes siguen
   necesitándolas para llegar al mismo punto.

Mientras tanto, `template.bak` es el baseline y las migraciones son el camino.
