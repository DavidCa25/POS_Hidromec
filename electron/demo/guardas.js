/**
 * LAS CONDICIONES QUE UNA BASE TIENE QUE CUMPLIR PARA PODER BORRARSE.
 *
 * Este archivo existe para una sola cosa: que `Wybix_POS` no se pueda borrar
 * nunca, ni por un fallo, ni por un renombrado, ni por un parametro que llegue
 * de donde no debe.
 *
 * DEFENSA EN PROFUNDIDAD, NO UNA COMPROBACION
 * -------------------------------------------
 * Una sola condicion es una sola linea que alguien puede quitar sin darse
 * cuenta de lo que sostenia. Aqui hay cuatro, y son independientes entre si:
 *
 *   1. El nombre encaja en `Wybix_Demo_<Perfil>` y en nada mas.
 *   2. Ese perfil esta en el catalogo de perfiles instalados. No basta con que
 *      el nombre tenga la forma correcta: tiene que ser un perfil que existe.
 *   3. La base lleva el marcador `is_demo` en `database_metadata`. Lo escribe
 *      la semilla al crearla, y el producto normal no lo escribe jamas.
 *   4. El `demo_instance_id` de la base coincide con el que este gestor guarda
 *      en su configuracion local. No basta con ser UNA demo: tiene que ser
 *      ESTA demo, la que creo este gestor.
 *
 * Si una falla, no se borra. No hay bandera para saltarselas.
 *
 * LO QUE NO ES UNA CONDICION: CUANTO SE HA USADO
 * ----------------------------------------------
 * Hubo aqui una quinta regla que se negaba a tocar una base con mas de
 * doscientas ventas. Estaba mal pensada. Una demo se usa para capacitar a un
 * equipo entero, para una prueba de carga o para ensenarla trescientas veces
 * en una feria, y despues de todo eso sigue siendo desechable: para eso se
 * hizo. El volumen de trabajo que tenga encima no dice nada sobre de quien es.
 * De quien es lo dicen el nombre, el perfil, el marcador y el identificador.
 *
 * Y EL NOMBRE NO VIAJA
 * --------------------
 * El IPC no acepta un nombre de base: acepta un identificador de perfil. El
 * nombre se COMPONE aqui a partir de ese identificador. Asi no hay forma de
 * mandar `Wybix_POS` desde el renderer, ni escapando comillas ni de ninguna
 * otra: el renderer no tiene por donde decir un nombre.
 */

/** Lo que jamas se toca, este donde este y se llame como se llame. */
const PROHIBIDAS = new Set([
  'wybix_pos',
  'wybix_production',
  'wybix_template',
  'hidromec_database',
  'master', 'model', 'msdb', 'tempdb',
]);

/** El unico patron de nombre que puede pertenecer a una demo. */
const PATRON = /^Wybix_Demo_[A-Za-z][A-Za-z0-9]{1,30}$/;

/** El identificador de perfil que se acepta desde fuera. */
const PATRON_PERFIL = /^[a-z][a-z0-9-]{1,30}$/;

/** La forma de un identificador de instancia: un UUID, tal cual lo da SQL. */
const PATRON_INSTANCIA = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

/** El nombre de base que le corresponde a un perfil. Se compone, no se recibe. */
function nombreDeBase(perfilId) {
  if (!PATRON_PERFIL.test(String(perfilId || ''))) {
    throw new Error(`Identificador de perfil invalido: ${JSON.stringify(perfilId)}`);
  }
  // retail -> Retail ; punto-venta -> PuntoVenta
  const camel = String(perfilId).split('-')
    .map(p => p.charAt(0).toUpperCase() + p.slice(1))
    .join('');
  const nombre = `Wybix_Demo_${camel}`;
  if (!PATRON.test(nombre)) {
    throw new Error(`El perfil ${perfilId} no produce un nombre de base valido.`);
  }
  return nombre;
}

/**
 * Primera barrera: la forma del nombre.
 *
 * Se comprueba en minusculas contra la lista negra porque SQL Server no
 * distingue mayusculas en los nombres de base con la colacion habitual:
 * `wybix_pos` y `Wybix_POS` son la misma base.
 */
function nombreEsDeDemo(nombre) {
  const n = String(nombre || '');
  if (!n) return { ok: false, motivo: 'La base no tiene nombre.' };
  if (PROHIBIDAS.has(n.toLowerCase())) {
    return { ok: false, motivo: `${n} es una base del producto, no una demo.` };
  }
  if (!PATRON.test(n)) {
    return { ok: false, motivo: `${n} no encaja en Wybix_Demo_<Perfil>.` };
  }
  return { ok: true };
}

/**
 * Segunda barrera: el perfil existe.
 *
 * Un nombre bien formado no basta. `Wybix_Demo_Inventado` pasa el patron y no
 * corresponde a nada que este gestor haya creado.
 */
function perfilConocido(perfilId, perfilesInstalados) {
  const ids = (perfilesInstalados || []).map(p => (p && p.id) || p);
  return ids.includes(perfilId)
    ? { ok: true }
    : { ok: false, motivo: `No hay ningun perfil instalado que se llame ${perfilId}.` };
}

/**
 * Tercera barrera: lo que dice la propia base.
 *
 * `metadatos` es lo leido de `database_metadata`. Se pide ANTES de borrar.
 *
 * NO SE MIRA CUANTO SE HA USADO. Hubo una version de esto que se negaba a
 * tocar una base con muchas ventas, con la idea de que "una demo no acumula
 * tantas". Era un mal criterio: una demo se usa para capacitar a un equipo,
 * para aguantar una prueba de carga o para ensenarla trescientas veces, y
 * sigue siendo desechable. Lo que decide que una base sea descartable es de
 * QUIEN es, no cuanto trabajo tiene encima.
 */
function contenidoEsDeDemo(metadatos) {
  const m = metadatos || {};
  if (String(m.is_demo).toLowerCase() !== 'true') {
    return {
      ok: false,
      motivo: 'La base no lleva el marcador is_demo. Si de verdad es una demo, ' +
              'creala otra vez con el gestor; si no lo es, no se toca.',
    };
  }
  if (!PATRON_INSTANCIA.test(String(m.demo_instance_id || ''))) {
    return {
      ok: false,
      motivo: 'La base no lleva un identificador de instancia valido. ' +
              'No la creo este gestor, o se creo con una version anterior.',
    };
  }
  return { ok: true };
}

/**
 * Cuarta barrera: esta demo la creo ESTE gestor.
 *
 * La semilla genera un UUID al crear la base y el gestor lo guarda en su
 * configuracion local. Para destruir algo tienen que coincidir los dos.
 *
 * Que anade sobre el marcador: el marcador dice "esto es una demo", y el
 * identificador dice "esta demo en concreto es la mia". Sin el, bastaria con
 * escribir `is_demo = true` a mano en cualquier base con nombre de demo para
 * volverla destruible. Con el, hace falta ademas acertar un UUID que solo
 * esta en dos sitios y que nadie escribe a mano.
 *
 * Si no hay registro local se NIEGA. Es deliberado: preferimos que una base
 * de demostracion se quede sin poder borrarse desde el gestor -se borra a
 * mano, y su nombre es conocido- a que el gestor adopte una base que no sabe
 * de donde salio.
 */
function instanciaCoincide(idLocal, metadatos) {
  const enBase = String((metadatos || {}).demo_instance_id || '');
  if (!idLocal) {
    return {
      ok: false,
      motivo: 'Este gestor no tiene registrada esa demo. Si la creo otra ' +
              'instalacion o se perdio su configuracion local, borrala a mano: ' +
              'el gestor no toca bases que no sabe de donde salieron.',
    };
  }
  if (String(idLocal) !== enBase) {
    return {
      ok: false,
      motivo: 'El identificador de la demo no coincide con el que guarda este ' +
              'gestor. Esa base no es la que este gestor creo.',
    };
  }
  return { ok: true };
}

/**
 * ABRIR NO ES DESTRUIR, Y NO PIDE LO MISMO.
 *
 * Para abrir una demo se exige que sea una demo -nombre derivado del perfil,
 * perfil instalado, marcador `is_demo`- y nada mas. NO se exige que la creara
 * este gestor.
 *
 * La diferencia no es un descuido. Destruir es irreversible y por eso pide la
 * prueba de propiedad: el identificador de instancia. Abrir solo apunta la
 * configuracion a una base y arranca; si esa demo la creo otra instalacion, lo
 * peor que pasa es que se vea. Exigir el identificador aqui dejaria demos
 * perfectamente sanas imposibles de mirar, que es molestia sin seguridad a
 * cambio.
 *
 * Lo que NO se afloja: sigue sin poder abrirse nada que no sea una demo. Una
 * base del producto no pasa la primera barrera, igual que para destruirla.
 */
function sePuedeAbrir({ perfilId, nombre, perfilesInstalados, metadatos }) {
  const esperado = (() => { try { return nombreDeBase(perfilId); } catch { return null; } })();
  if (!esperado) {
    return { ok: false, motivo: `Identificador de perfil invalido: ${JSON.stringify(perfilId)}` };
  }
  if (nombre !== esperado) {
    return {
      ok: false,
      motivo: `El nombre no corresponde al perfil: se esperaba ${esperado} y llego ${nombre}.`,
    };
  }
  for (const paso of [
    () => nombreEsDeDemo(nombre),
    () => perfilConocido(perfilId, perfilesInstalados),
    () => contenidoEsDeDemo(metadatos),
  ]) {
    const r = paso();
    if (!r.ok) return r;
  }
  return { ok: true };
}

/**
 * Las cuatro juntas. Es la unica puerta por la que pasa una operacion
 * destructiva, y devuelve el PRIMER motivo por el que no se puede.
 */
function sePuedeDestruir({ perfilId, nombre, perfilesInstalados, metadatos, instanciaLocal }) {
  const esperado = (() => { try { return nombreDeBase(perfilId); } catch { return null; } })();
  if (!esperado) {
    return { ok: false, motivo: `Identificador de perfil invalido: ${JSON.stringify(perfilId)}` };
  }
  if (nombre !== esperado) {
    return {
      ok: false,
      motivo: `El nombre no corresponde al perfil: se esperaba ${esperado} y llego ${nombre}.`,
    };
  }
  for (const paso of [
    () => nombreEsDeDemo(nombre),
    () => perfilConocido(perfilId, perfilesInstalados),
    () => contenidoEsDeDemo(metadatos),
    () => instanciaCoincide(instanciaLocal, metadatos),
  ]) {
    const r = paso();
    if (!r.ok) return r;
  }
  return { ok: true };
}

module.exports = {
  PATRON, PATRON_PERFIL, PATRON_INSTANCIA, PROHIBIDAS,
  nombreDeBase, nombreEsDeDemo, perfilConocido, contenidoEsDeDemo,
  instanciaCoincide, sePuedeDestruir, sePuedeAbrir,
};
