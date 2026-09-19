/**
 * CREAR, RESTABLECER Y ELIMINAR ENTORNOS DE DEMOSTRACION.
 *
 * SOLO EXISTE EN EL BUILD INTERNO. El instalador publico no empaqueta esta
 * carpeta, asi que en una maquina de cliente este archivo no esta: no es un
 * boton escondido, es codigo ausente.
 *
 * DE DONDE SALE UNA DEMO
 * ----------------------
 * Del MISMO camino que una instalacion de verdad:
 *
 *     template.bak  ->  migraciones  ->  semilla del perfil
 *
 * No hay un esquema paralelo ni un script que cree tablas por su cuenta. Eso
 * tiene un efecto util de lado: cada vez que se crea una demo se esta
 * probando el instalador real. Si el template o una migracion se rompen, la
 * demo no se puede crear, y nos enteramos aqui antes que un cliente.
 *
 * QUE NO HACE
 * -----------
 * No borra tabla por tabla. Restablecer es tirar la base y rehacerla: dejar
 * filas huerfanas de un DELETE selectivo es como una demo acaba pareciendose
 * a nada que un cliente vaya a tener.
 */
const fs = require('fs');
const path = require('path');
const { sePuedeDestruir, nombreDeBase, PATRON_INSTANCIA } = require('./guardas');
/* Los giros, de la MISMA lista que usa el onboarding real. El gestor de
   demos no define sus propios giros: si lo hiciera, la demo y la
   instalacion de un cliente acabarian ofreciendo cosas distintas, y el
   sintoma aparece en una demostracion delante de ese cliente. */
const presetsServicios = require('../servicios/presets');

/**
 * Donde viven los perfiles. UNA sola carpeta, nunca las dos.
 *
 * Empaquetado manda `resources/demo-profiles`; en el arbol de Git, la carpeta
 * del repositorio. Se elige una y se devuelve: si algun dia se leyeran las dos
 * -por ejemplo juntando sus resultados- cada perfil aparecería dos veces en la
 * ventana, una por cada origen.
 */
function dirPerfiles(app) {
  const empaquetado = path.join(process.resourcesPath || '', 'demo-profiles');
  if (fs.existsSync(empaquetado)) return empaquetado;
  return path.join(__dirname, '..', '..', 'demo-profiles');
}

/**
 * Los perfiles instalados, leidos de disco. Anadir uno es anadir una carpeta.
 *
 * UN PERFIL, UNA ENTRADA
 * ----------------------
 * El identificador es la clave, y se respeta como tal: si dos carpetas
 * declaran el mismo `id`, la segunda se descarta con un aviso en el registro
 * en vez de acabar como una tarjeta repetida en la ventana. Eso pasa mas
 * facil de lo que parece -una carpeta copiada para probar algo, un
 * `hospitality copia` que nadie borro-, y el sintoma que produce, dos opciones
 * iguales, no dice en ningun sitio de donde salio la segunda.
 *
 * Tambien se exige que el `id` coincida con el nombre de la carpeta: es lo que
 * garantiza que no puedan existir dos carpetas con el mismo id sin que una de
 * las dos este mal formada.
 */
function leerPerfiles(app) {
  const base = dirPerfiles(app);
  if (!fs.existsSync(base)) return [];
  const porId = new Map();
  for (const carpeta of fs.readdirSync(base)) {
    const ficha = path.join(base, carpeta, 'profile.json');
    if (!fs.existsSync(ficha)) continue;
    try {
      const p = JSON.parse(fs.readFileSync(ficha, 'utf8'));
      if (!p || p.id !== carpeta) {
        console.warn(`[DEMO] ${carpeta}/profile.json declara id "${p && p.id}": tiene que coincidir con la carpeta.`);
        continue;
      }
      if (porId.has(p.id)) {
        console.warn(`[DEMO] ${carpeta} repite el perfil "${p.id}": se ignora. ` +
                     `Ya lo aporto ${path.basename(porId.get(p.id).dir)}.`);
        continue;
      }
      /* Un perfil puede pedir que se elija GIRO antes de crearse. No es una
         lista suya: nombra un catalogo del producto -hoy solo `servicios`- y
         de ahi salen las opciones. Asi el gestor ofrece exactamente los giros
         que existen, ni uno mas, sin tener que enterarse de cuales son. */
      const giros = p.presets === 'servicios' ? presetsServicios.PRESETS : null;
      porId.set(p.id, {
        ...p,
        dir: path.join(base, carpeta),
        base: nombreDeBase(p.id),
        giros,
      });
    } catch (e) {
      console.error(`[DEMO] ${carpeta}/profile.json no se pudo leer:`, e.message);
    }
  }
  return [...porId.values()].sort((a, b) => (a.orden ?? 99) - (b.orden ?? 99));
}

/** Trocea un script por lineas GO, igual que el runner de migraciones. */
function lotes(sqlTexto) {
  return String(sqlTexto).replace(/\r\n/g, '\n')
    .split(/\n\s*GO\s*\n/gi).map(s => s.trim()).filter(Boolean);
}

/**
 * Lo que la base dice de si misma. Se lee ANTES de cualquier destruccion.
 *
 * Si la base no existe devuelve `null`, que no es lo mismo que "no es una
 * demo": una que no existe no hay que protegerla, hay que crearla.
 */
async function radiografia(masterPool, sql, nombre) {
  const existe = await masterPool.request()
    .input('n', sql.NVarChar(128), nombre)
    .query('SELECT DB_ID(@n) AS id');
  if (!existe.recordset[0] || existe.recordset[0].id == null) return null;

  const meta = {};
  let ventas = 0;
  try {
    const r = await masterPool.request().query(
      `SELECT clave, valor FROM [${nombre}].dbo.database_metadata;`);
    for (const f of r.recordset || []) meta[f.clave] = f.valor;
  } catch { /* sin la tabla, `meta` vacio: las guardas lo rechazaran */ }
  try {
    const r = await masterPool.request().query(
      `SELECT COUNT(*) AS n FROM [${nombre}].dbo.sales;`);
    ventas = Number(r.recordset[0]?.n ?? 0);
  } catch { /* sin la tabla, cero */ }
  /* `ventas` viaja para ENSENARLO en la ventana -saber que hay dentro antes de
     rehacer algo-, no para decidir nada. Ninguna guarda lo mira. */
  return { nombre, metadatos: meta, ventas, instancia: meta.demo_instance_id || null };
}

/**
 * La unica puerta a un DROP DATABASE de este modulo.
 *
 * Recibe el PERFIL, no un nombre: el nombre se compone de el. Y aun asi se
 * vuelve a comprobar todo contra la base real antes de tocarla, porque entre
 * componer el nombre y ejecutar el DROP alguien pudo renombrar una base.
 */
async function eliminarBase({ masterPool, sql, perfil, perfiles, instanciaLocal = null, log = () => {} }) {
  const nombre = nombreDeBase(perfil.id);
  const foto = await radiografia(masterPool, sql, nombre);
  if (!foto) return { ok: true, borrada: false, motivo: 'No existia.' };

  const veredicto = sePuedeDestruir({
    perfilId: perfil.id,
    nombre: foto.nombre,
    perfilesInstalados: perfiles,
    metadatos: foto.metadatos,
    instanciaLocal,
  });
  if (!veredicto.ok) {
    log(`[DEMO] NO se borra ${nombre}: ${veredicto.motivo}`);
    return { ok: false, borrada: false, motivo: veredicto.motivo };
  }

  /* El nombre NO se interpola desde nada que venga de fuera: sale de
     `nombreDeBase`, que solo produce `Wybix_Demo_<Perfil>`. Aun asi se
     comprueba una vez mas aqui, que es la linea inmediatamente anterior al
     DROP y la ultima oportunidad de pararlo. */
  if (nombre !== nombreDeBase(perfil.id)) throw new Error('Nombre alterado antes del DROP.');

  log(`[DEMO] cerrando conexiones y eliminando ${nombre}`);
  await masterPool.request().batch(
    `ALTER DATABASE [${nombre}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE;
     DROP DATABASE [${nombre}];`);
  return { ok: true, borrada: true };
}

/**
 * Crear la demo desde cero: plantilla, migraciones y semilla.
 *
 * `deps` trae lo que ya sabe hacer el producto, no copias:
 *   ensureServerReady  restaura template.bak y deja rol y permisos
 *   runMigrations      aplica lo pendiente, igual que al arrancar
 */
/**
 * La semilla que le toca a esta demo.
 *
 * Un perfil normal tiene UNA -`seed.sql`- y se acabo. Uno con giros tiene una
 * por giro, en su carpeta `seeds/`, y el nombre del archivo es el
 * identificador del giro. El identificador NO se interpola tal cual: se
 * resuelve antes contra el catalogo del producto, asi que lo que llega aqui
 * es siempre uno de los cinco que existen y nunca un trozo de ruta.
 */
function semillasDe(perfil, presetId) {
  if (!perfil.giros) return [path.join(perfil.dir, perfil.seed || 'seed.sql')];

  const giro = presetsServicios.exigir(presetId);
  const archivo = path.join(perfil.dir, perfil.seeds || 'seeds', `${giro.id}.sql`);
  if (!fs.existsSync(archivo)) {
    throw new Error(`El giro ${giro.id} no tiene semilla de demostracion: ${archivo}`);
  }

  /* Lo que TODOS los giros comparten -el marcador de demo, el alta del
     negocio, la caja- va una sola vez en `comun.sql`. Repetirlo en los cinco
     archivos habria sido cincuenta lineas identicas que se separan en cuanto
     alguien corrige una: la que corrigio queda bien y las otras cuatro no, y
     el sintoma es una demo que se comporta distinto que las demas sin que
     nadie sepa por que. */
  const comun = path.join(perfil.dir, 'comun.sql');
  return fs.existsSync(comun) ? [comun, archivo] : [archivo];
}

async function crearBase({ perfil, presetId = null, deps, log = () => {} }) {
  const { ensureServerReady, runMigrations, conectarBase, sql, servidor } = deps;
  const nombre = nombreDeBase(perfil.id);

  /* Se resuelve ANTES de tocar nada. Si el giro no existe, la demo no llega a
     crearse a medias: el fallo ocurre antes del primer CREATE DATABASE, no
     despues de haber restaurado la plantilla y aplicado 32 migraciones. */
  const semillas = semillasDe(perfil, presetId);

  log(`[DEMO] preparando ${nombre} desde la plantilla oficial`);
  await ensureServerReady({ role: 'principal', server: servidor, dbName: nombre });

  const pool = await conectarBase(servidor, nombre);
  try {
    log('[DEMO] aplicando migraciones');
    const r = await runMigrations({ pool, sql, migrationsDir: deps.migrationsDir });
    log(`[DEMO] migraciones aplicadas: ${(r.applied || []).length}`);

    log(`[DEMO] sembrando ${perfil.id}${presetId ? ` (${presetId})` : ''}`);

    for (const semilla of semillas) {
      if (!fs.existsSync(semilla)) throw new Error(`El perfil ${perfil.id} no tiene semilla: ${semilla}`);
      const cual = path.basename(semilla);
      const trozos = lotes(fs.readFileSync(semilla, 'utf8'));
      for (const [i, t] of trozos.entries()) {
        try {
          await pool.request().batch(t);
        } catch (e) {
          throw new Error(`La semilla ${cual} de ${perfil.id} fallo en el lote ${i + 1}/${trozos.length}: ${e.message}`);
        }
      }
    }

    /* Se comprueba que el marcador quedo puesto. Sin el, la demo que acabamos
       de crear no se podria restablecer ni eliminar despues: quedaria una
       base huerfana que el gestor se negaria a tocar. */
    const m = await pool.request().query(
      "SELECT clave, valor FROM dbo.database_metadata " +
      "WHERE clave IN ('is_demo','demo_instance_id','demo_preset');");
    const meta = {};
    for (const f of m.recordset || []) meta[f.clave] = f.valor;

    if (String(meta.is_demo).toLowerCase() !== 'true') {
      throw new Error(`La semilla de ${perfil.id} no dejo el marcador is_demo. ` +
        'Sin el, esta base no se podria restablecer ni eliminar.');
    }
    /* El identificador lo genera la semilla con NEWID(). Se lee aqui para que
       quien llama lo guarde en el registro local: es la unica forma de que
       despues coincidan los dos lados. */
    const instancia = String(meta.demo_instance_id || '');
    if (!PATRON_INSTANCIA.test(instancia)) {
      throw new Error(`La semilla de ${perfil.id} no dejo un demo_instance_id valido ` +
        `(${JSON.stringify(instancia)}). Sin el, esta base no se podria restablecer ni eliminar.`);
    }

    /* El giro tiene que haber quedado ESCRITO en la base, y no solo elegido en
       la ventana. Es lo que lee «Restablecer» para rehacer la misma demo sin
       volver a preguntar, y lo que lee la tarjeta para decir que estas a punto
       de abrir. Si la semilla se lo salto, la demo saldria bien hoy y se
       restableceria como otra cosa manana. */
    if (presetId && String(meta.demo_preset || '') !== String(presetId)) {
      throw new Error(`La semilla de ${perfil.id} no dejo anotado el giro ${presetId} ` +
        `(quedo ${JSON.stringify(meta.demo_preset || null)}). Sin el, restablecer no sabria ` +
        'cual rehacer.');
    }
    return { ok: true, base: nombre, instancia, preset: presetId };
  } finally {
    try { await pool.close(); } catch { /* noop */ }
  }
}

module.exports = { leerPerfiles, dirPerfiles, radiografia, eliminarBase, crearBase,
                   semillasDe, lotes };
