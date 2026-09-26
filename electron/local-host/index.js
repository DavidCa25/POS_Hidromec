/**
 * WYBIX LOCAL HOST — PANTALLAS OPERATIVAS.
 *
 * La computadora principal del negocio sirve, dentro de la red del local,
 * pantallas de UNA funcion para tablets, telefonos y PCs sin Wybix instalado:
 * Preparacion (Cocina/Barra), Mesero, Mi jornada, Tecnico, Inventario y
 * Estado de pedidos. Sin Internet: el router solo tiene que repartir
 * direcciones.
 *
 *   Tablet --HTTP LAN--> Local Host (este proceso) --> procedimientos --> SQL
 *
 * La tablet NUNCA habla con SQL Server ni ve una credencial de SQL.
 *
 * TRES COSAS SEPARADAS
 *   dispositivo   la tablet emparejada y su funcion (repositorio.js)
 *   superficie    que es esa funcion: que ve y que hace (superficies/*)
 *   trabajador    quien la usa ahora, por QR o PIN (trabajadores.js)
 *
 * QUIEN ES EL HOST
 *   Solo una computadora por base: la instalacion `principal` con el
 *   arriendo `local_host_lease` y encendido en Configuracion. Ver
 *   docs/local-host.md.
 *
 * PUERTO 7427, fijo y documentado. `WYBIX_LOCAL_HOST_PUERTO` solo para pruebas.
 */
const os = require('os');
const QRCode = require('qrcode');
const sesion = require('../seguridad/sesion');
const repositorio = require('./repositorio');
const dominio = require('../lib/kds-dominio');
const red = require('./red');
const firewall = require('./firewall');
const { crearServidor } = require('./servidor');
const { crearEventos } = require('./eventos');
const { crearCapacidades } = require('./capacidades');
const { crearTrabajadores } = require('./trabajadores');
const { crearAuditoria } = require('./auditoria');
const { crearSeguimiento } = require('./seguimiento');
const { crearRegistro } = require('./superficies/registro');
const { nuevoSecreto, MINUTOS_EMPAREJAR } = require('./credenciales');

const PUERTO = Number(process.env.WYBIX_LOCAL_HOST_PUERTO) || 7427;
const LATIDO_MS = 30_000;
const REINTENTO_MS = 30_000;
const INTERNET_MS = 60_000;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Las superficies que existen. Cada modulo aporta las suyas; el registro
 * decide cuales se ofrecen segun las capacidades del negocio.
 */
function registrarSuperficies(registro, { dominios }) {
  const hospitality = () => {
    if (!dominios.hospitality) throw Object.assign(new Error('Hospitality no está disponible.'), { negocio: true, http: 409 });
    return dominios.hospitality;
  };
  registro.registrar(require('./superficies/preparacion')({ dominio }));
  registro.registrar(require('./superficies/mesero')({ hospitality }));
  registro.registrar(require('./superficies/cliente')());
  registro.registrar(require('./superficies/jornada')());
  registro.registrar(require('./superficies/tecnico')());
  registro.registrar(require('./superficies/inventario')());
}

function crearLocalHost({ sql, poolPromise, machineId, machineName = os.hostname(), esPrincipal, leerConfig, guardarConfig, dominios = {}, log = (m) => console.log(`[LOCAL HOST] ${m}`) }) {
  const pool = () => poolPromise;
  const repo = repositorio.crear({ poolPromise, sql });
  const registro = crearRegistro();
  registrarSuperficies(registro, { dominios });
  const capacidades = crearCapacidades({ pool, log });
  const trabajadores = crearTrabajadores({ pool, sql, log });
  const auditoria = crearAuditoria({ pool, sql, log });

  const estado = {
    /** APAGADO | NO_PRINCIPAL | SIN_TABLAS | OTRO_HOST | PUERTO_OCUPADO | ACTIVO | ERROR */
    fase: 'APAGADO',
    puerto: PUERTO,
    dueno: null,
    error: null,
    internet: null,
    internetEn: null,
  };
  let servidor = null;
  let eventos = null;
  let srvApi = null;
  let latido = null;
  let reintento = null;
  let relojInternet = null;
  /* Lo que cada tablet dice de si misma al pedir: su cola sin conexion. */
  const reportes = new Map();

  const activoEnConfig = () => !!leerConfig()?.localHost?.activo;

  function direcciones() {
    return red.interfacesLan().map(i => ({ ...i, url: `http://${i.ip}:${PUERTO}` }));
  }

  async function revisarInternet() {
    estado.internet = await red.hayInternet().catch(() => false);
    estado.internetEn = new Date().toISOString();
  }

  function escuchar() {
    return new Promise((resolve, reject) => {
      eventos = crearEventos({ dominio, pool, sql, log });
      trabajadores.alCerrarSesion(({ sesionId, motivo }) => eventos?.cerrarSesion(sesionId, motivo));
      srvApi = crearServidor({
        repo, registro, capacidades, trabajadores, auditoria, pool, sql, eventos, dominios, log,
        seguimiento: crearSeguimiento({ pool, sql }),
        alPedir: (d, req) => {
          const cola = Number(req.headers['x-wx-cola']);
          reportes.set(d.id, { cola: Number.isFinite(cola) ? cola : (reportes.get(d.id)?.cola ?? 0), en: new Date().toISOString() });
        },
      });
      const onError = (e) => { srvApi.servidor.off('listening', onOk); reject(e); };
      const onOk = () => { srvApi.servidor.off('error', onError); resolve(); };
      srvApi.servidor.once('error', onError);
      srvApi.servidor.once('listening', onOk);
      /* 0.0.0.0: la tablet llega por la IP de la red local. El firewall, con
         la regla de «subred local», deja fuera lo que no es del local. */
      srvApi.servidor.listen(PUERTO, '0.0.0.0');
      servidor = srvApi.servidor;
    });
  }

  async function apagarServidor() {
    clearInterval(latido); latido = null;
    if (eventos) { eventos.detener(); eventos = null; }
    if (servidor) {
      const s = servidor; servidor = null; srvApi = null;
      await new Promise(r => { s.close(() => r()); s.closeAllConnections?.(); setTimeout(r, 1500); });
    }
  }

  async function intentar() {
    clearTimeout(reintento); reintento = null;
    if (!activoEnConfig()) { estado.fase = 'APAGADO'; return; }
    if (!esPrincipal()) { estado.fase = 'NO_PRINCIPAL'; return; }

    let a;
    try {
      a = await repo.tomarArriendo({ machineId: machineId(), machineName, direccion: direcciones()[0]?.ip || null, puerto: PUERTO });
    } catch (e) {
      /* Una base sin la migracion 0044 no es un error del negocio. */
      estado.fase = /local_host_lease/i.test(e.message) ? 'SIN_TABLAS' : 'ERROR';
      estado.error = estado.fase === 'ERROR' ? 'No se pudo hablar con la base.' : null;
      log(`arriendo: ${e.message}`);
      reintento = setTimeout(() => void intentar(), REINTENTO_MS);
      return;
    }
    estado.dueno = a.dueno;
    if (!a.mio) {
      estado.fase = 'OTRO_HOST';
      reintento = setTimeout(() => void intentar(), REINTENTO_MS);
      return;
    }

    if (!servidor) {
      try {
        await escuchar();
        await eventos.iniciar();
      } catch (e) {
        await apagarServidor();
        await repo.soltarArriendo(machineId()).catch(() => {});
        estado.fase = e.code === 'EADDRINUSE' ? 'PUERTO_OCUPADO' : 'ERROR';
        estado.error = e.code === 'EADDRINUSE'
          ? `Otro programa usa el puerto ${PUERTO}.`
          : 'No se pudo encender el Local Host.';
        log(`escuchar: ${e.code || e.message}`);
        reintento = setTimeout(() => void intentar(), REINTENTO_MS);
        return;
      }
      log(`escuchando en ${PUERTO} · ${direcciones().map(d => d.ip).join(', ') || 'sin red local'}`);
    }
    estado.fase = 'ACTIVO';
    estado.error = null;

    clearInterval(latido);
    latido = setInterval(async () => {
      try {
        const r = await repo.tomarArriendo({ machineId: machineId(), machineName, direccion: direcciones()[0]?.ip || null, puerto: PUERTO });
        if (!r.mio) {
          /* Otro equipo se quedo con el arriendo: se deja de servir. Nunca dos Hosts. */
          log('se perdió el arriendo; el Local Host se apaga');
          estado.dueno = r.dueno;
          await apagarServidor();
          estado.fase = 'OTRO_HOST';
          reintento = setTimeout(() => void intentar(), REINTENTO_MS);
        }
      } catch (e) {
        log(`latido: ${e.message}`);
      }
    }, LATIDO_MS);
  }

  async function iniciar() {
    await revisarInternet();
    relojInternet = setInterval(() => void revisarInternet(), INTERNET_MS);
    await intentar();
  }

  async function detener({ soltar = true } = {}) {
    clearTimeout(reintento); reintento = null;
    clearInterval(relojInternet); relojInternet = null;
    const eraMio = !!servidor;
    await apagarServidor();
    if (soltar && eraMio) await repo.soltarArriendo(machineId()).catch(() => {});
  }

  async function activar(activo) {
    const cfg = leerConfig() || {};
    guardarConfig({ ...cfg, localHost: { ...(cfg.localHost || {}), activo: !!activo } });
    if (activo) await intentar();
    else { clearTimeout(reintento); await apagarServidor(); await repo.soltarArriendo(machineId()).catch(() => {}); estado.fase = 'APAGADO'; }
    return instantanea();
  }

  function instantanea() {
    const dirs = direcciones();
    return {
      fase: estado.fase,
      activo: estado.fase === 'ACTIVO',
      encendidoEnConfig: activoEnConfig(),
      puerto: PUERTO,
      direcciones: dirs,
      /* La red local y el Internet son cosas distintas: se informan aparte. */
      lan: dirs.length > 0,
      internet: estado.internet,
      internetRevisadoEn: estado.internetEn,
      dueno: estado.fase === 'OTRO_HOST' ? estado.dueno : null,
      error: estado.error,
    };
  }

  async function superficiesDisponibles() {
    return registro.disponibles(await capacidades.leer(true)).map(d => registro.publica(d));
  }

  async function dispositivos() {
    const [lista, sesiones] = await Promise.all([repo.listarDispositivos(), trabajadores.sesionesAbiertas().catch(() => new Map())]);
    const vivos = eventos ? eventos.conectados() : new Map();
    return lista.map(d => {
      const id = String(d.id).toLowerCase();
      const def = registro.obtener(d.superficie || 'PREPARATION');
      const s = sesiones.get(id);
      let config = {};
      try { config = d.config ? JSON.parse(d.config) : {}; } catch { config = {}; }
      return {
        id,
        nombre: d.nombre,
        superficie: d.superficie || 'PREPARATION',
        superficieNombre: def?.nombre || d.superficie,
        familia: def?.familia || null,
        estacion: d.todas ? null : d.estacion,
        stationId: d.station_id,
        todas: !!d.todas,
        config,
        emparejadoEn: d.emparejado_en,
        ultimoContacto: d.ultimo_contacto,
        ultimaIp: d.ultima_ip,
        revocado: !!d.revocado_en,
        revocadoEn: d.revocado_en,
        enLinea: !d.revocado_en && vivos.has(id),
        sesion: s ? { nombre: s.nombre, inicio: s.inicio, ultimaActividad: s.ultimaActividad, via: s.via } : null,
        colaPendiente: reportes.get(id)?.cola ?? 0,
      };
    });
  }

  /** Valida y normaliza la funcion pedida desde la administracion. */
  async function funcionPedida({ superficie = 'PREPARATION', stationId, todas, config }) {
    const caps = await capacidades.leer(true);
    const def = registro.obtener(superficie);
    if (!def) return { error: 'Esa función no existe.' };
    if (!def.disponible(caps)) return { error: `«${def.nombre}» no está encendida en este negocio.` };
    const st = Number(stationId);
    if (def.requiereEstacion && !todas) {
      if (!(Number.isInteger(st) && st > 0)) return { error: 'Elige la estación de esta pantalla.' };
      const ests = await repo.estaciones();
      if (!ests.some(e => Number(e.id) === st)) return { error: 'Esa estación no existe o está apagada.' };
    }
    const cfg = {};
    if (def.tipo === 'WAITER' && Array.isArray(config?.areas)) cfg.areas = config.areas.map(Number).filter(n => Number.isInteger(n) && n > 0).slice(0, 50);
    if (def.tipo === 'CUSTOMER_STATUS') {
      if (config?.mostrarMesa === true) cfg.mostrarMesa = true;
      if (config?.sonido === true) cfg.sonido = true;
      if (Number(config?.minutosListo) > 0) cfg.minutosListo = Math.min(60, Number(config.minutosListo));
      if (typeof config?.mensaje === 'string' && config.mensaje.trim()) cfg.mensaje = config.mensaje.trim().slice(0, 80);
    }
    return {
      def,
      stationId: def.requiereEstacion && !todas ? st : null,
      todas: def.requiereEstacion ? !!todas : false,
      config: Object.keys(cfg).length ? cfg : null,
    };
  }

  async function emparejar({ superficie, stationId, todas, nombre, config, userId }) {
    if (!activoEnConfig()) await activar(true);
    if (estado.fase !== 'ACTIVO') return { ok: false, error: textoDeFase(estado.fase) };
    const dir = direcciones()[0];
    if (!dir) return { ok: false, error: 'Esta computadora no está conectada a una red local.' };
    const f = await funcionPedida({ superficie, stationId, todas, config });
    if (f.error) return { ok: false, error: f.error };
    const n = String(nombre || '').trim().slice(0, 80) || `Pantalla · ${f.def.nombre}`;
    const token = nuevoSecreto();
    await repo.crearEmparejamiento({ token, superficie: f.def.tipo, stationId: f.stationId, todas: f.todas, nombre: n, config: f.config, userId });
    const url = `${dir.url}/pair/${token}`;
    const qr = await QRCode.toDataURL(url, { margin: 1, width: 360, errorCorrectionLevel: 'M' });
    return { ok: true, url, qr, expiraEnMinutos: MINUTOS_EMPAREJAR, expiraEn: new Date(Date.now() + MINUTOS_EMPAREJAR * 60_000).toISOString() };
  }

  async function cambiarFuncion({ id, superficie, stationId, todas, config, userId }) {
    if (!UUID.test(String(id || ''))) return { ok: false, error: 'Dispositivo no válido.' };
    const f = await funcionPedida({ superficie, stationId, todas, config });
    if (f.error) return { ok: false, error: f.error };
    const ok = await repo.cambiarFuncion({ id, superficie: f.def.tipo, stationId: f.stationId, todas: f.todas, config: f.config, userId });
    if (!ok) return { ok: false, error: 'Ese dispositivo ya no está conectado.' };
    eventos?.cambioDeFuncion(id);
    await trabajadores.cerrarSesionesDeDispositivo(id, 'FUNCION');
    srvApi?.olvidar();
    await auditoria.registrar({ disp: { id }, def: f.def, sesion: { persona: { userId } } }, 'CAMBIO_FUNCION', { entidad: 'DISPOSITIVO', entidadId: id, detalle: `desde Wybix -> ${f.def.tipo}` });
    return { ok: true };
  }

  async function revocar(id, userId) {
    if (!UUID.test(String(id || ''))) return { ok: false, error: 'Pantalla no válida.' };
    const ok = await repo.revocar(id, userId);
    await trabajadores.cerrarSesionesDeDispositivo(id, 'REVOCADA').catch(() => {});
    /* Inmediato: se vacia la cache de credenciales y se corta su conexion. */
    srvApi?.olvidar();
    eventos?.cerrarDe(id);
    return { ok };
  }

  /** El QR personal: `http://IP:PUERTO/w/TOKEN`. La camara de la tablet lo abre. */
  async function qrTrabajador(persona, porUsuario) {
    const { accesoId, token } = await trabajadores.generarQr(persona, porUsuario);
    const dir = direcciones()[0];
    const url = dir ? `${dir.url}/w/${token}` : null;
    const qr = await QRCode.toDataURL(url || token, { margin: 1, width: 320, errorCorrectionLevel: 'M' });
    return { accesoId, qr, conDireccion: !!dir };
  }

  /** Una caja de este equipo acaba de cambiar algo: no hace falta esperar al sondeo. */
  function avisar() { eventos?.revisarYa(); }

  function registrarIpc(ipcMain) {
    const bien = (data) => ({ success: true, data });
    const mal = (error) => ({ success: false, error });
    const envolver = (fn) => async (...a) => {
      try { return await fn(...a); }
      catch (e) { log(`ipc: ${e.message}`); return mal(e.negocio ? e.message : 'No se pudo completar la operación.'); }
    };
    const persona = (p = {}) => ({ userId: Number(p.userId) || null, professionalId: p.userId ? null : (Number(p.professionalId) || null) });

    ipcMain.handle('localhost:estado', sesion.proteger('localhost:estado', envolver(async () => {
      const [lista, estaciones, superficies, areas] = await Promise.all([
        dispositivos().catch(() => []),
        repo.estaciones().catch(() => []),
        superficiesDisponibles().catch(() => []),
        /* Las areas del salon: el mesero puede quedar limitado a algunas. */
        pool().then(p => p.request().query('SELECT id, nombre FROM dbo.salon_areas ORDER BY orden, nombre;')).then(r => r.recordset || []).catch(() => []),
      ]);
      return bien({ ...instantanea(), dispositivos: lista, estaciones, superficies, areas });
    })));

    ipcMain.handle('localhost:activar', sesion.proteger('localhost:activar', envolver(async (_e, p = {}) =>
      bien(await activar(!!p.activo)))));

    ipcMain.handle('localhost:emparejar', sesion.proteger('localhost:emparejar', envolver(async (_e, p = {}, s) => {
      const r = await emparejar({ superficie: p.superficie, stationId: p.stationId, todas: !!p.todas, nombre: p.nombre, config: p.config, userId: s?.userId ?? null });
      return r.ok ? bien(r) : mal(r.error);
    })));

    ipcMain.handle('localhost:cambiar-funcion', sesion.proteger('localhost:cambiar-funcion', envolver(async (_e, p = {}, s) => {
      const r = await cambiarFuncion({ id: p.id, superficie: p.superficie, stationId: p.stationId, todas: !!p.todas, config: p.config, userId: s?.userId ?? null });
      return r.ok ? bien(true) : mal(r.error);
    })));

    ipcMain.handle('localhost:renombrar', sesion.proteger('localhost:renombrar', envolver(async (_e, p = {}) => {
      const n = String(p.nombre || '').trim();
      if (!UUID.test(String(p.id || '')) || !n) return mal('Escribe un nombre.');
      const ok = await repo.renombrar(p.id, n);
      srvApi?.olvidar();
      return ok ? bien(true) : mal('Ese dispositivo ya no está conectado.');
    })));

    ipcMain.handle('localhost:revocar', sesion.proteger('localhost:revocar', envolver(async (_e, p = {}, s) => {
      const r = await revocar(p.id, s?.userId ?? null);
      return r.ok ? bien(true) : mal(r.error || 'Esa pantalla ya estaba desconectada.');
    })));

    ipcMain.handle('localhost:trabajadores', sesion.proteger('localhost:trabajadores', envolver(async () =>
      bien(await trabajadores.listarPersonas()))));

    ipcMain.handle('localhost:trabajador-qr', sesion.proteger('localhost:trabajador-qr', envolver(async (_e, p = {}, s) =>
      bien(await qrTrabajador(persona(p), s?.userId ?? null)))));

    ipcMain.handle('localhost:trabajador-pin', sesion.proteger('localhost:trabajador-pin', envolver(async (_e, p = {}, s) => {
      const r = await trabajadores.fijarPin(persona(p), String(p.pin ?? ''), s?.userId ?? null);
      return r.ok ? bien({ accesoId: r.accesoId }) : mal(r.error);
    })));

    ipcMain.handle('localhost:trabajador-revocar', sesion.proteger('localhost:trabajador-revocar', envolver(async (_e, p = {}, s) => {
      const ok = await trabajadores.revocarAcceso(Number(p.accesoId), s?.userId ?? null);
      return ok ? bien(true) : mal('Ese acceso ya estaba revocado.');
    })));

    /* Diagnostico para quien administra: resumen util, sin detalles tecnicos. */
    ipcMain.handle('localhost:diagnostico', sesion.proteger('localhost:diagnostico', envolver(async () => bien({
      ...instantanea(),
      conectados: eventos ? [...eventos.conectados().entries()].map(([id, n]) => ({ id, conexiones: n })) : [],
      fuentes: eventos ? eventos.fuentes() : [],
      errores: srvApi ? srvApi.errores() : [],
      actividad: await auditoria.recientes(30).catch(() => []),
    }))));

    ipcMain.handle('localhost:red', sesion.proteger('localhost:red', envolver(async () => {
      await revisarInternet();
      return bien({ direcciones: direcciones(), lan: direcciones().length > 0, internet: estado.internet });
    })));

    /* Leer el firewall no cambia nada. */
    ipcMain.handle('localhost:firewall', sesion.proteger('localhost:firewall', envolver(async () =>
      bien(await firewall.diagnosticar(PUERTO)))));

    /* Crear la regla: solo cuando la persona lo pide (la pantalla confirma
       antes), y Windows vuelve a preguntar con su propio aviso de administrador. */
    ipcMain.handle('localhost:firewall-abrir', sesion.proteger('localhost:firewall-abrir', envolver(async () => {
      const r = await firewall.abrir(PUERTO);
      return r.ok ? bien(await firewall.diagnosticar(PUERTO)) : mal(r.error);
    })));

    /* ---- inventario desde el piso: lo que reportan las tablets ---- */
    ipcMain.handle('inventario:reportes', sesion.proteger('inventario:reportes', envolver(async (_e, p = {}) => {
      const r = await (await pool()).request().input('e', sql.NVarChar(10), p.estado === 'TODOS' ? null : 'PENDIENTE').query(`
        SELECT TOP 200 r.id, r.tipo, r.cantidad, r.stock_al_reportar, r.nota, r.estado, r.reportado_en,
               p.id AS product_id, p.nombre, p.part_number, p.stock AS stock_actual,
               COALESCE(u.usuario, '') AS reporto, d.nombre AS dispositivo
          FROM dbo.inventario_reportes r
          JOIN dbo.products p ON p.id = r.product_id
          LEFT JOIN dbo.users u ON u.id = r.user_id
          LEFT JOIN dbo.dispositivos_locales d ON d.id = r.dispositivo_id
         WHERE @e IS NULL OR r.estado = @e
         ORDER BY r.id DESC;`);
      return bien(r.recordset || []);
    })));

    /* Aplicar un conteo reportado usa el MISMO ajuste que la pantalla Conteo. */
    ipcMain.handle('inventario:reporte-resolver', sesion.proteger('inventario:reporte-resolver', envolver(async (_e, p = {}, s) => {
      const id = Number(p.id);
      const accion = p.accion === 'APLICAR' ? 'APLICAR' : 'DESCARTAR';
      const tx = new sql.Transaction(await pool());
      await tx.begin();
      try {
        const r = await new sql.Request(tx).input('id', sql.Int, id).query(
          'SELECT id, product_id, tipo, cantidad, estado FROM dbo.inventario_reportes WITH (UPDLOCK, ROWLOCK) WHERE id = @id;');
        const f = r.recordset?.[0];
        if (!f) { await tx.rollback(); return mal('Ese reporte ya no existe.'); }
        if (f.estado !== 'PENDIENTE') { await tx.rollback(); return mal('Ese reporte ya se resolvió.'); }
        if (accion === 'APLICAR') {
          if (f.tipo !== 'CONTEO') { await tx.rollback(); return mal('Un faltante no se aplica: se atiende y se descarta.'); }
          await new sql.Request(tx).input('product_id', sql.Int, f.product_id).input('fisico', sql.Decimal(12, 2), f.cantidad)
            .input('user_id', sql.Int, s?.userId ?? null).execute('sp_inventory_count_apply');
        }
        await new sql.Request(tx).input('id', sql.Int, id).input('e', sql.NVarChar(10), accion === 'APLICAR' ? 'APLICADO' : 'DESCARTADO')
          .input('u', sql.Int, s?.userId ?? null)
          .query('UPDATE dbo.inventario_reportes SET estado = @e, resuelto_en = SYSUTCDATETIME(), resuelto_por = @u WHERE id = @id;');
        await tx.commit();
      } catch (e) { await tx.rollback().catch(() => {}); throw e; }
      eventos?.revisarYa();
      return bien(true);
    })));
  }

  return {
    iniciar, detener, activar, instantanea, dispositivos, emparejar, cambiarFuncion, revocar, avisar, registrarIpc,
    qrTrabajador, trabajadores, registro, capacidades, auditoria, superficiesDisponibles, PUERTO,
  };
}

function textoDeFase(fase) {
  return {
    APAGADO: 'Wybix Local Host está apagado.',
    NO_PRINCIPAL: 'Las pantallas se conectan desde la computadora principal del negocio.',
    SIN_TABLAS: 'Falta actualizar la base de datos. Reinicia Wybix en la computadora principal.',
    OTRO_HOST: 'Otra computadora ya atiende las pantallas de este negocio.',
    PUERTO_OCUPADO: `Otro programa usa el puerto ${PUERTO}.`,
    ERROR: 'No se pudo encender el Local Host.',
  }[fase] || 'Wybix Local Host no está disponible.';
}

module.exports = { crearLocalHost, PUERTO, textoDeFase };
