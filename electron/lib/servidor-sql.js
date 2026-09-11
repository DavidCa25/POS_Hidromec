// servidor-sql.js
// Como se escribe un servidor de SQL Server, en UN solo sitio.
//
// EL FALLO QUE LO ORIGINA
// -----------------------
// El asistente de Caja Secundaria hacia esto, sin mirar lo que habia escrito
// la persona:
//
//     server: serverIp + '\\SQLEXPRESS'
//
// Quien escribia solo la IP tenia suerte. Quien escribia lo mismo que acababa
// de probar con `sqlcmd` -`192.168.100.211\SQLEXPRESS`, que es lo natural-
// terminaba con esto guardado en `db-config.json`:
//
//     "192.168.100.211\\SQLEXPRESS\\SQLEXPRESS"
//
// Un servidor imposible. Y como nadie validaba la cadena antes de usarla, la
// aplicacion entraba en su bucle de reintentos: 20 intentos de 3 segundos, un
// minuto entero delante de una persona, para terminar diciendo "verifica la IP
// y el firewall" cuando la IP y el firewall estaban perfectos.
//
// POR QUE UN MODULO Y NO UN ARREGLO EN EL ASISTENTE
// -------------------------------------------------
// Porque la cadena se construia en un sitio y se DESARMABA en otros tres, cada
// uno con su propio `split`:
//
//     db.js            buildServerName(host, instance)
//     lib/host.js      servidorEsLocal()       -> split('\\')[0].split(',')[0]
//     lib/red-principal.js  instanciaDe()      -> split('\\')[1].split(',')[0]
//
// Cuatro reglas separadas para una sola gramatica. Arreglar solo el asistente
// habria dejado las otras tres libres de volver a divergir. Aqui hay UNA
// gramatica, y los demas la usan.
//
// LA GRAMATICA
// ------------
//     [tcp:]host[\instancia][,puerto]
//
// El orden importa y no es negociable: la instancia va antes que el puerto.
// `192.168.1.10,1433\SQLEXPRESS` no es una forma rara, es invalida.
//
// Modulo puro: ni Electron, ni SQL, ni disco. Se puede ejercitar entero desde
// una prueba.

const INSTANCIA_POR_DEFECTO = 'SQLEXPRESS';
const PUERTO_POR_DEFECTO = 1433;

/** Nombre de host, FQDN o IPv4. Sin espacios, sin barras, sin comas. */
const RE_HOST = /^[A-Za-z0-9._-]+$/;
/** Nombre de instancia de SQL Server. */
const RE_INSTANCIA = /^[A-Za-z0-9_$#-]+$/;

/**
 * Desarma una cadena de servidor. NO adivina nada: solo dice que hay.
 *
 * @returns {{ok:boolean, error?:string, protocolo:string|null, host:string,
 *            instancia:string|null, puerto:number|null}}
 */
function analizarServidor(texto) {
  const bruto = String(texto ?? '').trim();
  const fallo = (error) => ({ ok: false, error, protocolo: null, host: '', instancia: null, puerto: null });

  if (!bruto) return fallo('Falta la direccion del servidor.');
  if (/\s/.test(bruto)) return fallo(`"${bruto}" tiene espacios: escribe la direccion sin espacios.`);

  // ------------------------------------------------------------- protocolo
  // `tcp:` es el unico que Wybix entiende. `np:` (canalizaciones con nombre)
  // y `lpc:` existen, pero no es lo que usa una caja secundaria por LAN, y
  // aceptarlos en silencio solo serviria para fallar mas tarde y peor.
  let protocolo = null;
  let resto = bruto;
  const m = /^([A-Za-z]+):(.*)$/.exec(bruto);
  if (m) {
    const p = m[1].toLowerCase();
    if (p !== 'tcp') {
      return fallo(`"${m[1]}:" no es un protocolo admitido. Usa "tcp:" o escribe solo la direccion.`);
    }
    protocolo = 'tcp';
    resto = m[2];
    if (!resto) return fallo('Despues de "tcp:" falta la direccion del servidor.');
  }

  // ---------------------------------------------------------------- puerto
  const partesComa = resto.split(',');
  if (partesComa.length > 2) {
    return fallo(`"${bruto}" trae el puerto repetido. Escribe la direccion con un solo puerto.`);
  }
  let puerto = null;
  if (partesComa.length === 2) {
    const t = partesComa[1].trim();
    if (!/^\d+$/.test(t)) return fallo(`"${partesComa[1]}" no es un puerto valido.`);
    puerto = Number(t);
    if (puerto < 1 || puerto > 65535) return fallo(`El puerto ${puerto} esta fuera de rango (1-65535).`);
  }

  // ------------------------------------------------------------- instancia
  // Aqui es donde aparecia el fallo real: dos barras.
  const partesBarra = partesComa[0].split('\\');
  if (partesBarra.length > 2) {
    return fallo(
      `"${bruto}" trae la instancia dos veces (${partesBarra.slice(1).join(', ')}). ` +
      'Escribe la direccion una sola vez, por ejemplo 192.168.1.10 o 192.168.1.10\\SQLEXPRESS.');
  }

  const host = partesBarra[0].trim();
  if (!host) return fallo(`"${bruto}" no dice a que equipo conectarse.`);
  if (!RE_HOST.test(host)) return fallo(`"${host}" no es una IP ni un nombre de equipo valido.`);

  let instancia = null;
  if (partesBarra.length === 2) {
    instancia = partesBarra[1].trim();
    if (!instancia) return fallo(`"${bruto}" termina en "\\" sin nombre de instancia.`);
    if (!RE_INSTANCIA.test(instancia)) return fallo(`"${instancia}" no es un nombre de instancia valido.`);
  }

  return { ok: true, protocolo, host, instancia, puerto };
}

/**
 * La forma canonica con la que Wybix se conecta y que guarda en disco.
 *
 * LA UNICA REGLA QUE ANADE ALGO
 * -----------------------------
 * Si la persona no dijo NI instancia NI puerto, se asume `\SQLEXPRESS`, que es
 * la instancia que instala Wybix. En cualquier otro caso se respeta lo escrito
 * al pie de la letra:
 *
 *   - ya trae instancia  -> no se toca (aqui estaba el fallo)
 *   - ya trae puerto     -> tampoco se anade instancia. Con puerto explicito
 *                           la conexion va directa a ese puerto y el nombre de
 *                           instancia sobra; anadirlo obligaria ademas a que el
 *                           SQL Browser respondiera para nada.
 *   - ya trae `tcp:`     -> se conserva el prefijo
 *
 * @returns {{ok:boolean, error?:string, server?:string, ...}}
 */
function normalizarServidor(texto, opciones = {}) {
  const r = analizarServidor(texto);
  if (!r.ok) return r;

  const instanciaDefecto = opciones.instanciaPorDefecto ?? INSTANCIA_POR_DEFECTO;
  const instancia = (r.instancia === null && r.puerto === null) ? instanciaDefecto : r.instancia;

  let server = r.host;
  if (instancia) server += `\\${instancia}`;
  if (r.puerto !== null) server += `,${r.puerto}`;
  if (r.protocolo) server = `${r.protocolo}:${server}`;

  return {
    ok: true,
    server,
    host: r.host,
    instancia: instancia ?? null,
    puerto: r.puerto,
    protocolo: r.protocolo,
    // Para poder decir "se completo con la instancia predeterminada" sin que
    // quien llama tenga que deducirlo comparando cadenas.
    completado: r.instancia === null && r.puerto === null,
  };
}

/**
 * ¿Se puede intentar conectar con esto?
 *
 * Existe aparte de `normalizarServidor` porque se usa en un sitio donde NO se
 * quiere corregir nada: antes del bucle de reintentos. Una cadena rota no
 * mejora esperando tres segundos veinte veces.
 */
function validarServidor(texto) {
  const r = analizarServidor(texto);
  return r.ok ? { ok: true } : { ok: false, error: r.error };
}

/** El host, sin instancia, sin puerto y sin protocolo. */
function hostDe(texto) {
  const r = analizarServidor(texto);
  return r.ok ? r.host : '';
}

/** El nombre de instancia, o cadena vacia si la cadena no lo dice. */
function instanciaDe(texto) {
  const r = analizarServidor(texto);
  return r.ok ? (r.instancia || '') : '';
}

/** Arma una cadena desde sus piezas (lo que hacia `buildServerName` en db.js). */
function componerServidor(host, instancia, puerto) {
  const h = String(host ?? '').trim();
  if (!h) return '';
  let s = h;
  const i = String(instancia ?? '').trim();
  if (i) s += `\\${i}`;
  const p = String(puerto ?? '').trim();
  if (p) s += `,${p}`;
  return s;
}

module.exports = {
  INSTANCIA_POR_DEFECTO,
  PUERTO_POR_DEFECTO,
  analizarServidor,
  normalizarServidor,
  validarServidor,
  hostDe,
  instanciaDe,
  componerServidor,
};
