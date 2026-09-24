/**
 * EL IPC DEL GESTOR. Solo se registra en el build interno.
 *
 * LO QUE ESTE CANAL NO ACEPTA
 * ---------------------------
 * Un nombre de base de datos. Nunca. Las tres operaciones reciben un
 * IDENTIFICADOR DE PERFIL -"retail", "hospitality"- y el nombre se compone a
 * partir de el en `guardas.nombreDeBase`. Asi no hay forma de pedir desde la
 * ventana que se borre `Wybix_POS`: no existe el parametro por el que
 * decirlo.
 *
 * Y el perfil se valida contra los perfiles instalados en disco, no contra
 * una expresion regular: un identificador con la forma correcta que no
 * corresponda a ninguna carpeta se rechaza igual.
 *
 * LO QUE SE LE PASA A LAS GUARDAS
 * ------------------------------
 * El identificador de instancia sale del REGISTRO LOCAL, nunca del renderer.
 * La ventana no tiene por donde mandarlo, igual que no tiene por donde mandar
 * un nombre de base: si pudiera, la cuarta guarda seria un campo de texto.
 */
const { leerPerfiles, radiografia, eliminarBase, crearBase } = require('./gestor');
const { sePuedeAbrir } = require('./guardas');
const { limpiarDatos, olvidarConfiguracion } = require('./index');
const registro = require('./registro');

function registrar({ ipcMain, app, sql, setup, runMigrations, migrationsDir, servidor, abrirApp, soltarApp, log = console.log }) {
  const perfiles = () => leerPerfiles(app);

  /** Como se llama en pantalla el giro con el que se creo una demo. */
  function nombreDeGiro(perfil, presetId) {
    if (!perfil.giros || !presetId) return null;
    const g = perfil.giros.find(x => x.id === presetId);
    /* Si la base dice un giro que este binario ya no conoce, se ensena el
       identificador tal cual en vez de esconderlo: «TALLER_VIEJO» dice algo,
       y un hueco en blanco no dice nada. */
    return g ? g.nombre : presetId;
  }

  /** El perfil pedido, o un error si no es uno de los instalados. */
  function perfilDe(id) {
    const p = perfiles().find(x => x.id === id);
    if (!p) throw new Error(`No hay ningun perfil instalado que se llame ${JSON.stringify(id)}.`);
    return p;
  }

  const maestro = () => setup.connectMaster(servidor);

  const deps = {
    ensureServerReady: setup.ensureServerReady,
    conectarBase: setup.connectDb,
    runMigrations, migrationsDir, sql, servidor,
  };

  /** Que hay ahora mismo en la maquina. Es de solo lectura. */
  ipcMain.handle('demo:estado', async () => {
    try {
      const pool = await maestro();
      const lista = [];
      for (const p of perfiles()) {
        const foto = await radiografia(pool, sql, p.base);
        lista.push({
          id: p.id, nombre: p.nombre, descripcion: p.descripcion, icono: p.icono,
          prueba: p.prueba || [], base: p.base,
          /* Los giros que ofrece este perfil, o `null` si no pide ninguno.
             La ventana no lleva su propia lista: la recibe. */
          giros: p.giros ? p.giros.map(g => ({
            id: g.id, nombre: g.nombre, ejemplos: g.ejemplos, icono: g.icono,
          })) : null,
          /* Con que giro se creo la que ya existe. Es lo que permite que la
             tarjeta diga que estas a punto de abrir, y lo que «Restablecer»
             rehace sin volver a preguntar. */
          preset: foto?.metadatos?.demo_preset || null,
          presetNombre: nombreDeGiro(p, foto?.metadatos?.demo_preset),
          existe: !!foto,
          esDemo: !!foto && String(foto.metadatos?.is_demo).toLowerCase() === 'true',
          creada: foto?.metadatos?.demo_created_at || null,
          ventas: foto?.ventas ?? 0,
          /* Si el gestor no la tiene registrada, Restablecer y Eliminar van a
             negarse. Mas vale decirlo en la ventana que al pulsar el boton. */
          registrada: !!foto && registro.leer(app, p.id) === (foto.instancia || null)
                      && !!foto.instancia,
        });
      }
      await pool.close();
      return { success: true, data: { perfiles: lista, datos: app.getPath('userData') } };
    } catch (e) {
      log('[DEMO] estado:', e.message);
      return { success: false, error: e.message };
    }
  });

  /**
   * Crear. Un perfil con giros EXIGE que se elija uno.
   *
   * No hay giro por omision y no se recuerda el anterior. Las dos cosas
   * producen el mismo fallo: crear una demo creyendo que es un taller y
   * encontrarse una barberia, o al reves, que es exactamente lo que no puede
   * pasar delante de un cliente. Si falta, se dice y no se crea nada.
   */
  ipcMain.handle('demo:crear', async (_e, { perfilId, presetId } = {}) => {
    try {
      const p = perfilDe(perfilId);
      if (p.giros && !presetId) {
        return { success: false, error: 'Elige el giro antes de crear la demostración.',
                 motivo: 'FALTA_GIRO' };
      }

      const pool = await maestro();
      const foto = await radiografia(pool, sql, p.base);
      await pool.close();
      if (foto) return { success: false, error: `${p.base} ya existe. Usa Restablecer.` };

      const r = await crearBase({ perfil: p, presetId: p.giros ? presetId : null, deps, log });
      registro.anotar(app, p.id, { instancia: r.instancia, base: r.base });
      return { success: true, data: { base: p.base, preset: r.preset || null } };
    } catch (e) {
      log('[DEMO] crear:', e.message);
      return { success: false, error: e.message };
    }
  });

  /**
   * Restablecer = tirar la base y rehacerla.
   *
   * No se borra tabla por tabla: regenerar entero es lo unico que garantiza
   * que el perfil vuelve EXACTAMENTE a su estado inicial. Un DELETE selectivo
   * deja identidades avanzadas, filas huerfanas y configuraciones a medias.
   */
  ipcMain.handle('demo:restablecer', async (_e, { perfilId } = {}) => {
    try {
      const p = perfilDe(perfilId);

      /* Antes de tirar la base: si Wybix la tiene abierta, se suelta. Una
         ventana conectada a una base que se acaba de borrar no se entera y
         sigue en pantalla como si nada. */
      if (typeof soltarApp === 'function') soltarApp(p.base);

      const pool = await maestro();

      /* El giro, ANTES de tirar la base: despues ya no hay de donde leerlo.
         Restablecer rehace LA MISMA demo -mismo giro, datos limpios- y por eso
         no vuelve a preguntar: quien pulsa Restablecer quiere su taller otra
         vez desde cero, no elegir de nuevo. Para cambiar de giro estan
         Eliminar y Crear, que dejan claro que lo de dentro se va. */
      const antes = await radiografia(pool, sql, p.base);
      const giroPrevio = antes?.metadatos?.demo_preset || null;
      if (p.giros && !giroPrevio) {
        await pool.close();
        return {
          success: false,
          motivo: 'SIN_GIRO_ANOTADO',
          error: `${p.base} no tiene anotado su giro, así que no se sabe cuál rehacer. ` +
                 'Elimínala y créala otra vez eligiendo el giro.',
        };
      }

      const r = await eliminarBase({
        masterPool: pool, sql, perfil: p, perfiles: perfiles(),
        instanciaLocal: registro.leer(app, p.id), log,
      });
      await pool.close();
      if (!r.ok) return { success: false, error: r.motivo };

      /* La base nueva trae un identificador nuevo: el registro se reescribe.
         Si esto fallara, la demo quedaria creada y sin anotar, y el propio
         gestor se negaria a tocarla despues. Por eso se anota antes de
         responder que salio bien. */
      const nueva = await crearBase({
        perfil: p, presetId: p.giros ? giroPrevio : null, deps, log });
      registro.anotar(app, p.id, { instancia: nueva.instancia, base: nueva.base });
      return { success: true, data: { base: p.base, preset: nueva.preset || null } };
    } catch (e) {
      log('[DEMO] restablecer:', e.message);
      return { success: false, error: e.message };
    }
  });

  /**
   * ABRIR: arrancar Wybix contra la demo que ya existe.
   *
   * NO la crea ni la rehace. Apunta la configuracion de esta instalacion
   * -la AISLADA, porque `userData` ya se movio antes de que nada leyera una
   * ruta- a la base de la demo y arranca la aplicacion como lo haria el
   * asistente al terminar una instalacion normal. Por eso no vuelve a pedir
   * el alta del negocio: la semilla ya creo usuario y configuracion, y
   * `bootMainApp` solo abre lo que ya esta hecho.
   *
   * Si la base no existe se dice y ya: crear es otro boton, y hacerlo aqui
   * convertiria "abrir" en una operacion que escribe una base de datos sin
   * que nadie lo haya pedido.
   */
  ipcMain.handle('demo:abrir', async (_e, { perfilId } = {}) => {
    try {
      if (typeof abrirApp !== 'function') {
        return { success: false, error: 'Esta version no sabe abrir demos.' };
      }
      const p = perfilDe(perfilId);
      const pool = await maestro();
      const foto = await radiografia(pool, sql, p.base);
      await pool.close();

      if (!foto) return { success: false, error: `${p.base} no existe todavia. Créala primero.` };

      const veredicto = sePuedeAbrir({
        perfilId: p.id,
        nombre: foto.nombre,
        perfilesInstalados: perfiles(),
        metadatos: foto.metadatos,
      });
      if (!veredicto.ok) {
        log(`[DEMO] NO se abre ${p.base}: ${veredicto.motivo}`);
        return { success: false, error: veredicto.motivo };
      }

      log(`[DEMO] abriendo Wybix contra ${p.base}`);
      await abrirApp({ base: p.base, servidor, perfilId: p.id });
      return { success: true, data: { base: p.base } };
    } catch (e) {
      log('[DEMO] abrir:', e.message);
      return { success: false, error: e.message };
    }
  });

  /**
   * Eliminar = la base y lo que la demo dejo en la maquina.
   *
   * Los datos locales se limpian SOLO si ya no queda ninguna demo: son
   * comunes a todas -una sola carpeta-, y vaciarlos con otra demo viva la
   * dejaria sin configuracion.
   */
  ipcMain.handle('demo:eliminar', async (_e, { perfilId } = {}) => {
    try {
      const p = perfilDe(perfilId);
      if (typeof soltarApp === 'function') soltarApp(p.base);

      const pool = await maestro();
      const r = await eliminarBase({
        masterPool: pool, sql, perfil: p, perfiles: perfiles(),
        instanciaLocal: registro.leer(app, p.id), log,
      });
      if (!r.ok) { await pool.close(); return { success: false, error: r.motivo }; }
      registro.olvidar(app, p.id);

      /* Y la configuracion local que apuntaba a ESA base. Sin esto, la
         siguiente demo -de otro perfil- arrancaba sobre la configuracion de
         la que se acaba de borrar. */
      olvidarConfiguracion(app, p.base, { log });

      let quedan = 0;
      for (const otro of perfiles()) {
        if (otro.id === p.id) continue;
        if (await radiografia(pool, sql, otro.base)) quedan++;
      }
      await pool.close();

      const local = quedan === 0 ? limpiarDatos(app, { log }) : { ok: true, borrada: false };
      return { success: true, data: { base: p.base, datosLimpiados: !!local.borrada, quedan } };
    } catch (e) {
      log('[DEMO] eliminar:', e.message);
      return { success: false, error: e.message };
    }
  });

  log(`[DEMO] gestor interno activo. Perfiles: ${perfiles().map(p => p.id).join(', ') || '(ninguno)'}`);
}

module.exports = { registrar };
