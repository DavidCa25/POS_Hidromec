/*
 * WYBIX · PANTALLAS OPERATIVAS — la carcasa que comparten todas las funciones.
 *
 * La base de datos es la verdad. La pantalla:
 *   1. pide su estado completo al abrir, al reconectar y cada tanto;
 *   2. escucha avisos del Host (Server-Sent Events) para no esperar;
 *   3. actua con POST y una clave por accion (Idempotency-Key): reintentar
 *      nunca hace dos veces lo mismo.
 *
 * SIN CONEXION, CON CRITERIO. Cada accion trae su modo del servidor:
 *   OFFLINE_SAFE     si no hay red, se guarda en la cola y se envia al volver;
 *   ONLINE_REQUIRED  si no hay red, se dice que hace falta y NO se guarda.
 * Si algo cambio mientras tanto, el servidor responde CONFLICTO y aqui se
 * dice «Esta informacion cambio mientras estabas sin conexion»: nada se
 * sobrescribe en silencio. Solo se guarda en el aparato lo que la funcion
 * necesita para seguir mirando (su ultimo estado), y se borra al salir.
 *
 * Por HTTP en la red local el navegador no da contexto seguro: no hay camara
 * para leer QR dentro de la pagina, ni cifrado del lado del cliente, ni
 * Service Worker. El QR del trabajador se lee con la camara de la tablet (abre
 * /w/TOKEN) o con un lector de codigos que teclea en el campo.
 *
 * Sin librerias y sin nada fuera del Host.
 */
(() => {
  'use strict';

  const WX = (window.WX = window.WX || { superficies: {} });
  WX.superficies = WX.superficies || {};

  const CAIDA_MS = 8000;
  const REVISION_MS = 30000;
  const SILENCIO_PROPIO_MS = 2500;

  // ------------------------------------------------------------ estado
  const s = {
    modo: 'cargando',            // cargando | emparejar | entrar-qr | sin-credencial | revocado | sin-funcion | lista
    estado: null,                // respuesta de /api/s/estado
    con: 'CONECTADO',            // CONECTADO | RECONECTANDO | SIN_CONEXION | RECUPERANDO
    desdeCache: null,            // hora de los datos cuando se muestra la cache
    ajustes: false,
    franja: null,                // { tipo, texto }
    error: null,
    ui: {},                      // estado de pantalla por funcion (no se guarda)
    entrar: { pestaña: 'qr', persona: null, pin: '', personas: null, error: null, ocupado: false },
  };
  let es = null;
  let caidaTimer = null;
  let desconectado = false;
  let primeraConexion = true;
  let toastTimer = null;
  let refrescoTimer = null;
  let ultimaAccionPropia = 0;
  let hoja = null;

  // ------------------------------------------------------ utilidades
  function el(tag, attrs = {}, ...hijos) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') n.className = v;
      else if (k === 'text') n.textContent = v;
      else if (k === 'value') n.value = v;
      else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v === true ? '' : v);
    }
    for (const h of hijos.flat(9)) if (h != null && h !== false) n.append(h.nodeType ? h : document.createTextNode(String(h)));
    return n;
  }

  /* crypto.randomUUID pide contexto seguro; getRandomValues no. */
  function uuid() {
    const b = crypto.getRandomValues(new Uint8Array(16));
    b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
    const h = [...b].map(x => x.toString(16).padStart(2, '0')).join('');
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
  }

  const dinero = (n) => `$${Number(n || 0).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const horaAhora = () => new Date().toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });
  const iniciales = (n) => String(n || '?').trim().split(/\s+/).slice(0, 2).map(x => x[0]).join('').toUpperCase();
  function saludo() {
    const h = new Date().getHours();
    return h < 12 ? 'Buenos días' : h < 19 ? 'Buenas tardes' : 'Buenas noches';
  }

  // ---------------------------------------------------- almacenamiento
  /* localStorage puede fallar (modo privado): la pantalla sigue sin el. */
  const almacen = {
    leer(k, def) { try { const v = localStorage.getItem(k); return v == null ? def : JSON.parse(v); } catch { return def; } },
    guardar(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* sin almacenamiento */ } },
    borrar(k) { try { localStorage.removeItem(k); } catch { /* noop */ } },
  };
  const pref = Object.assign({ sonido: true, volumen: 0.7, tema: 'auto', silencioHasta: 0 }, almacen.leer('wx_pref', {}));
  const guardarPref = () => almacen.guardar('wx_pref', pref);

  function aplicarTema() {
    if (pref.tema === 'auto') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', pref.tema);
  }

  // --------------------------------------------------------- sonido
  /* Generado aqui (WebAudio): ningun archivo. El navegador deja sonar solo
     despues de un toque: por eso «Activar sonido». */
  let audio = null;
  function contextoAudio() {
    if (!audio) { const C = window.AudioContext || window.webkitAudioContext; if (!C) return null; audio = new C(); }
    return audio;
  }
  const sonidoListo = () => !!audio && audio.state === 'running';
  function desbloquearAudio() {
    const c = contextoAudio();
    if (c && c.state !== 'running') c.resume().then(pintar, () => {});
  }
  function tono() {
    if (!sonidoListo()) return;
    const c = audio;
    const t0 = c.currentTime + 0.02;
    const vol = Math.max(0, Math.min(1, Number(pref.volumen))) * 0.35;
    [[880, 0], [1318.5, 0.16]].forEach(([f, d]) => {
      const o = c.createOscillator();
      const g = c.createGain();
      o.type = 'sine'; o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t0 + d);
      g.gain.exponentialRampToValueAtTime(Math.max(0.0002, vol), t0 + d + 0.015);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + d + 0.32);
      o.connect(g).connect(c.destination);
      o.start(t0 + d); o.stop(t0 + d + 0.36);
    });
  }
  function sonar() {
    if (!pref.sonido || Date.now() < (pref.silencioHasta || 0)) return;
    if (Date.now() - ultimaAccionPropia < SILENCIO_PROPIO_MS) return;   // no suena lo que yo mismo hice
    tono();
  }

  // --------------------------------------------------------------- red
  const cola = {
    leer: () => almacen.leer('wx_cola', []),
    guardar: (x) => almacen.guardar('wx_cola', x),
  };

  async function api(ruta, { method = 'GET', body, headers = {} } = {}) {
    const r = await fetch(ruta, {
      method,
      headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), 'X-Wx-Cola': String(cola.leer().length), ...headers },
      body: body ? JSON.stringify(body) : undefined,
      credentials: 'same-origin',
      cache: 'no-store',
    });
    let datos = null;
    try { datos = await r.json(); } catch { /* sin cuerpo */ }
    return { status: r.status, datos: datos || {} };
  }

  const tipoActual = () => s.estado?.superficie?.tipo || null;
  const quienActual = () => (s.estado?.sesion ? `${s.estado.sesion.persona.nombre}|${s.estado.sesion.inicio}` : 'dispositivo');
  const claveCache = () => `wx_cache_${s.estado?.dispositivo?.id || 'x'}`;

  function limpiarPrivado() {
    /* Al salir un trabajador: nada suyo se queda en la tablet. */
    almacen.borrar(claveCache());
    s.ui = {};
    cerrarHoja();
  }

  /**
   * El estado completo, de la base. `modo`:
   *   'inicio'   primera carga;
   *   'recupera' al reconectar o en la revision periodica.
   */
  async function sincronizar(modo = 'recupera') {
    let r;
    try { r = await api('/api/s/estado'); }
    catch {
      marcarCaida();
      /* Sin red: lo ultimo que se vio, si es de esta misma persona. */
      const c = almacen.leer(claveCache(), null);
      if (c && s.estado && c.tipo === tipoActual() && c.quien === quienActual()) {
        s.estado = { ...s.estado, datos: c.datos };
        s.desdeCache = c.hora;
      }
      pintar();
      return false;
    }
    if (r.status === 401) { cerrarEventos(); limpiarPrivado(); s.modo = 'sin-credencial'; pintar(); return false; }
    if (r.status === 409 && ['SIN_FUNCION', 'FUNCION_APAGADA'].includes(r.datos.codigo)) {
      cerrarEventos(); s.modo = 'sin-funcion'; s.error = r.datos.error; pintar(); return false;
    }
    if (r.status !== 200) { s.error = r.datos.error || 'Wybix no respondió.'; pintar(); return false; }

    const antes = s.estado;
    const cambioSuperficie = antes && antes.superficie?.tipo !== r.datos.superficie?.tipo;
    const salioTrabajador = antes?.sesion && !r.datos.sesion;
    if (cambioSuperficie || salioTrabajador) limpiarPrivado();
    s.estado = r.datos;
    s.desdeCache = null;
    s.error = null;
    s.modo = 'lista';
    if (r.datos.datos) almacen.guardar(claveCache(), { tipo: tipoActual(), quien: quienActual(), datos: r.datos.datos, hora: horaAhora() });
    const m = WX.superficies[tipoActual()];
    if (m?.alSincronizar) m.alSincronizar(ctx(), modo, antes);
    pintar();
    if (!r.datos.requiereTrabajador) abrirEventos();
    else cerrarEventos();
    if (modo !== 'inicio') void procesarCola();
    return true;
  }

  function refrescar(ms = 350) {
    clearTimeout(refrescoTimer);
    refrescoTimer = setTimeout(() => void sincronizar('recupera'), ms);
  }

  function marcarCaida() {
    if (s.con === 'CONECTADO' || s.con === 'RECUPERANDO') s.con = 'RECONECTANDO';
    clearTimeout(caidaTimer);
    caidaTimer = setTimeout(() => { if (s.con !== 'CONECTADO') { s.con = 'SIN_CONEXION'; pintar(); } }, CAIDA_MS);
    pintar();
  }

  function abrirEventos() {
    if (es) return;
    es = new EventSource('/api/s/eventos');
    es.addEventListener('hola', async () => {
      clearTimeout(caidaTimer);
      const volvio = desconectado || s.con !== 'CONECTADO';
      desconectado = false;
      if (!primeraConexion && volvio) {
        /* Al volver: se valida todo de nuevo (credencial, sesion), se manda la
           cola y se recupera el estado. La base manda. */
        s.con = 'RECUPERANDO'; pintar();
        await procesarCola();
        await sincronizar('recupera');
      }
      primeraConexion = false;
      s.con = 'CONECTADO';
      pintar();
    });
    es.addEventListener('evento', (e) => {
      const ev = leerEvento(e);
      if (!ev) return;
      const m = WX.superficies[tipoActual()];
      const resuelto = m?.alEvento ? m.alEvento(ev, ctx()) : false;
      if (ev.sonar) sonar();
      if (resuelto) pintar(); else refrescar();
    });
    es.addEventListener('sesion', (e) => {
      const d = leerEvento(e) || {};
      cerrarEventos();
      limpiarPrivado();
      s.franja = { tipo: 'aviso', texto: ({
        INACTIVIDAD: 'Tu sesión se cerró por inactividad. Vuelve a entrar.',
        CADUCADA: 'La sesión terminó por hoy.',
        REVOCADA: 'Tu acceso cambió. Pide un QR nuevo o vuelve a entrar.',
        OTRA_SESION: 'Otra persona entró en esta tablet.',
        FUNCION: 'La función de esta tablet cambió.',
        SALIR: null,
      })[d.motivo] || null };
      void sincronizar('recupera');
    });
    es.addEventListener('funcion', () => { cerrarEventos(); limpiarPrivado(); void sincronizar('recupera'); });
    es.addEventListener('revocado', () => { cerrarEventos(); limpiarPrivado(); cola.guardar([]); s.modo = 'revocado'; pintar(); });
    es.onerror = () => {
      desconectado = true;
      marcarCaida();
      if (es && es.readyState === EventSource.CLOSED) {
        es = null;
        setTimeout(async () => { if (await sincronizar('recupera')) abrirEventos(); }, 3000);
      }
    };
  }

  function cerrarEventos() { if (es) { es.close(); es = null; } }
  function leerEvento(e) { try { return JSON.parse(e.data); } catch { return null; } }

  // ------------------------------------------------------------- cola
  async function procesarCola() {
    let pendientes = cola.leer();
    if (!pendientes.length) return;
    const yo = quienActual();
    const ajenas = pendientes.filter(x => x.quien !== yo);
    if (ajenas.length && s.estado && !s.estado.requiereTrabajador) {
      /* Lo que hizo otra persona no se envia con la sesion de esta: se dice. */
      pendientes = pendientes.filter(x => x.quien === yo);
      cola.guardar(pendientes);
      s.franja = { tipo: 'aviso', texto: `Se descartaron ${ajenas.length} acción(es) sin enviar de otra sesión.` };
    }
    let enviadas = 0, conflictos = 0;
    for (const a of [...pendientes]) {
      if (a.quien !== yo) continue;
      let r;
      try {
        r = await api(`/api/s/accion/${a.nombre}`, { method: 'POST', body: a.datos,
          headers: { 'Idempotency-Key': a.clave, 'X-Wx-Diferida': '1', 'X-Wx-Creado': a.creado } });
      } catch { break; }   // sigue sin red: se reintenta despues
      if (r.status === 401) break;
      const resto = cola.leer().filter(x => x.clave !== a.clave);
      cola.guardar(resto);
      if (r.status === 200) enviadas++;
      else if (r.datos.codigo === 'CONFLICTO') conflictos++;
      else s.franja = { tipo: 'caida', texto: `No se pudo enviar una acción guardada: ${r.datos.error || 'error'}` };
    }
    if (conflictos) s.franja = { tipo: 'aviso', texto: 'Esta información cambió mientras estabas sin conexión. Revísala antes de seguir.' };
    else if (enviadas) s.franja = { tipo: 'ok', texto: enviadas === 1 ? 'Se envió 1 acción guardada sin conexión.' : `Se enviaron ${enviadas} acciones guardadas sin conexión.` };
    if (enviadas || conflictos) refrescar(50);
    pintar();
  }

  /**
   * Una accion de la funcion. Devuelve el resultado, `{ encolada: true }` si
   * se guardo para despues, o null si no se pudo (y ya se dijo por que).
   */
  async function accion(nombre, datos = {}, { ok = null } = {}) {
    desbloquearAudio();
    const def = (s.estado?.superficie?.acciones || []).find(a => a.nombre === nombre);
    if (!def) { avisar('Esta pantalla no puede hacer eso.'); return null; }
    const clave = uuid();
    const creado = new Date().toISOString();
    let r;
    try {
      r = await api(`/api/s/accion/${nombre}`, { method: 'POST', body: datos, headers: { 'Idempotency-Key': clave, 'X-Wx-Creado': creado } });
    } catch {
      marcarCaida();
      if (def.modo === 'OFFLINE_SAFE') {
        cola.guardar([...cola.leer(), { clave, nombre, datos, creado, superficie: tipoActual(), quien: quienActual() }]);
        avisar('Guardado sin conexión. Se enviará cuando vuelva la red.');
        pintar();
        return { encolada: true };
      }
      avisar('Esto necesita conexión con Wybix. Vuelve a intentarlo cuando regrese la red.');
      return null;
    }
    if (r.status === 200) {
      ultimaAccionPropia = Date.now();
      if (ok) avisar(ok);
      refrescar(80);
      return r.datos.resultado || {};
    }
    if (r.status === 401 && r.datos.codigo === 'SIN_TRABAJADOR') { limpiarPrivado(); void sincronizar('recupera'); return null; }
    if (r.status === 401) { s.modo = 'sin-credencial'; pintar(); return null; }
    if (r.datos.codigo === 'CONFLICTO') { s.franja = { tipo: 'aviso', texto: r.datos.error }; refrescar(50); pintar(); return null; }
    avisar(r.datos.error || 'No se pudo completar.');
    return null;
  }

  async function consulta(nombre, params = {}) {
    const q = new URLSearchParams(Object.entries(params).filter(([, v]) => v != null && v !== '')).toString();
    try {
      const r = await api(`/api/s/consulta/${nombre}${q ? `?${q}` : ''}`);
      if (r.status === 200) return r.datos;
      if (r.status === 401) { void sincronizar('recupera'); return null; }
      avisar(r.datos.error || 'No se pudo consultar.');
    } catch { marcarCaida(); avisar('Sin conexión con Wybix.'); }
    return null;
  }

  // ------------------------------------------------------- trabajador
  async function entrarConQr(texto) {
    s.entrar.error = null; s.entrar.ocupado = true; pintar();
    try {
      const r = await api('/api/trabajador/entrar', { method: 'POST', body: { qr: String(texto || '').trim() } });
      s.entrar.ocupado = false;
      if (r.status === 200) { s.entrar = { pestaña: 'qr', persona: null, pin: '', personas: null, error: null, ocupado: false }; s.franja = null; await sincronizar('inicio'); return true; }
      s.entrar.error = r.datos.error || 'No se pudo entrar.';
    } catch { s.entrar.ocupado = false; s.entrar.error = 'Sin conexión con Wybix.'; }
    pintar();
    return false;
  }

  async function entrarConPin() {
    const e = s.entrar;
    if (!e.persona || e.pin.length < 4) return;
    e.error = null; e.ocupado = true; pintar();
    try {
      const r = await api('/api/trabajador/entrar', { method: 'POST', body: { accesoId: e.persona, pin: e.pin } });
      e.ocupado = false; e.pin = '';
      if (r.status === 200) { s.entrar = { pestaña: 'pin', persona: null, pin: '', personas: null, error: null, ocupado: false }; s.franja = null; await sincronizar('inicio'); return; }
      e.error = r.datos.error || 'PIN incorrecto.';
    } catch { e.ocupado = false; e.error = 'Sin conexión con Wybix.'; }
    pintar();
  }

  async function salir(descartar = false) {
    /* Lo pendiente de esta persona se intenta enviar antes de salir. Si sigue
       sin red, se pregunta: salir lo descarta (no se puede mandar despues con
       la sesion de otra persona). */
    if (!descartar && cola.leer().some(x => x.quien === quienActual())) {
      await procesarCola();
      const aun = cola.leer().filter(x => x.quien === quienActual()).length;
      if (aun) {
        abrirHoja(() => [
          el('div', { class: 'hoja__cab' }, el('div', {},
            el('h2', { text: `${aun} acción(es) sin enviar` }),
            el('p', { text: 'No hay conexión con Wybix. Si sales ahora, se pierden.' }))),
          el('div', { class: 'acciones' },
            el('button', { type: 'button', class: 'btn btn--grande', text: 'Quedarme', onclick: cerrarHoja }),
            el('button', { type: 'button', class: 'btn btn--grande btn--aviso', text: 'Salir y descartar',
              onclick: () => { cola.guardar(cola.leer().filter(x => x.quien !== quienActual())); cerrarHoja(); void salir(true); } })),
        ]);
        return;
      }
    }
    try { await api('/api/trabajador/salir', { method: 'POST' }); } catch { /* sin red: la sesion caduca sola */ }
    cerrarEventos();
    limpiarPrivado();
    s.franja = null;
    await sincronizar('recupera');
  }

  // ----------------------------------------------------------- toast
  function avisar(texto) {
    document.querySelector('.toast')?.remove();
    const t = el('div', { class: 'toast', role: 'status', text: texto });
    document.body.append(t);
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.remove(), 3800);
  }

  // ------------------------------------------------------------- hoja
  function abrirHoja(render) {
    hoja = { render };
    pintarHoja();
  }
  function cerrarHoja() {
    hoja = null;
    document.querySelector('.hoja-fondo')?.remove();
  }
  function pintarHoja() {
    document.querySelector('.hoja-fondo')?.remove();
    if (!hoja) return;
    const foco = document.activeElement?.id;
    const fondo = el('div', { class: 'hoja-fondo', onclick: (e) => { if (e.target === fondo) cerrarHoja(); } },
      el('section', { class: 'hoja', role: 'dialog', 'aria-modal': 'true' }, ...hoja.render()));
    document.body.append(fondo);
    if (foco) document.getElementById(foco)?.focus();
  }

  // ------------------------------------------------ contexto de funcion
  function ctx() {
    const tipo = tipoActual();
    return {
      el, dinero, iniciales, saludo, uuid,
      estado: s.estado,
      datos: s.estado?.datos,
      sesion: s.estado?.sesion,
      dispositivo: s.estado?.dispositivo,
      ui: (s.ui[tipo] = s.ui[tipo] || {}),
      sinConexion: s.con !== 'CONECTADO',
      desdeCache: s.desdeCache,
      accion, consulta, avisar, pintar, refrescar,
      hoja: abrirHoja, cerrarHoja, pintarHoja,
      sonar,
      franja: (tipo, texto) => { s.franja = texto ? { tipo, texto } : null; },
    };
  }

  // ------------------------------------------------------------ pintar
  const $app = document.getElementById('app');

  function pantallaAviso(titulo, texto, ...extra) {
    return el('section', { class: 'aviso-pantalla' },
      el('span', { class: 'marca', text: 'Wybix · Pantalla operativa' }),
      el('h1', { text: titulo }),
      texto ? el('p', { text: texto }) : null,
      ...extra);
  }

  function pintar() {
    const foco = document.activeElement;
    const clave = foco?.dataset?.clave || (foco?.id && $app.contains(foco) ? `#${foco.id}` : null);
    const pos = foco && 'selectionStart' in foco ? foco.selectionStart : null;
    /* Las funciones de trabajador usan la carcasa B (banda + barra inferior):
       la pagina entera es suya, sin el margen de la carcasa de estacion. */
    $app.classList.toggle('app--trabajador', s.modo === 'lista' && s.estado?.superficie?.familia === 'TRABAJADOR');
    /* La pantalla publica (TV) es oscura siempre: un solo aspecto. */
    const publica = s.modo === 'lista' && s.estado?.superficie?.familia === 'PUBLICA';
    $app.classList.toggle('app--publica', publica);
    document.body.classList.toggle('es-publica', publica);
    $app.replaceChildren(...vista().filter(Boolean));
    if (clave) {
      const n = clave.startsWith('#') ? document.getElementById(clave.slice(1)) : $app.querySelector(`[data-clave="${CSS.escape(clave)}"]`);
      if (n) { n.focus(); if (pos != null && 'setSelectionRange' in n) { try { n.setSelectionRange(pos, pos); } catch { /* noop */ } } }
    }
  }

  function vista() {
    const m = location.pathname.match(/^\/pair\/([A-Za-z0-9_-]{40,60})$/);
    if (s.modo === 'emparejar' && m) {
      const salida = el('p', { class: 'error', role: 'alert' });
      const boton = el('button', { type: 'button', class: 'btn btn--primario', text: 'Conectar esta pantalla' });
      boton.addEventListener('click', () => emparejar(m[1], boton, salida));
      return [pantallaAviso('Conectar a Wybix',
        'Esta tablet tendrá una sola función, la que eligieron en Wybix. No puede cobrar ni administrar.', boton, salida)];
    }
    if (s.modo === 'sin-credencial') {
      return [pantallaAviso('Esta pantalla no está conectada',
        'En la computadora principal, abre Configuración → Dispositivos locales y escanea el código con esta tablet.')];
    }
    if (s.modo === 'revocado') {
      return [pantallaAviso('Esta pantalla se desconectó',
        'La desconectaron desde Wybix. Para volver a usarla, genera un código nuevo en Dispositivos locales.')];
    }
    if (s.modo === 'sin-funcion') {
      return [pantallaAviso('Esta pantalla no tiene función', s.error,
        el('button', { type: 'button', class: 'btn', text: 'Cambiar función', onclick: () => abrirCambioFuncion() }))];
    }
    if (s.modo === 'entrar-qr') return [pantallaAviso('Entrando…', null)];
    if (s.modo !== 'lista' || !s.estado) return [pantallaAviso('Conectando con Wybix…', null)];

    const tipo = tipoActual();
    const mod = WX.superficies[tipo];
    const c = ctx();
    const cuerpo = s.estado.requiereTrabajador ? vistaEntrar() : (mod ? mod.render(c) : [el('p', { text: 'Esta función todavía no tiene pantalla.' })]);
    if (mod?.publica) return [...franjas(), ...[].concat(cuerpo)];
    if (s.estado.superficie.familia === 'TRABAJADOR') {
      return [cabeceraTrabajador(mod), el('div', { class: 'trab__cuerpo' }, ...franjas(), ...[].concat(cuerpo)), barraTrabajador(mod)];
    }
    return [cabecera(mod), ...franjas(), s.ajustes ? vistaAjustes() : null, ...[].concat(cuerpo)];
  }

  /*
   * CARCASA B (aprobada) PARA LAS FUNCIONES DE TRABAJADOR.
   * Una banda oscura con quien esta y como va su dia; el trabajo en medio;
   * una barra inferior al alcance del pulgar. Mi jornada, Tecnico, Mesero e
   * Inventario comparten esta carcasa; cada uno pone su contenido.
   */
  function cabeceraTrabajador(mod) {
    const e = s.estado;
    const persona = e.sesion?.persona;
    const c = ctx();
    const prog = persona && mod?.progreso ? mod.progreso(c) : null;
    const pendientes = cola.leer().filter(x => x.quien === quienActual()).length;
    const con = { CONECTADO: 'Red local', RECONECTANDO: 'Reconectando…', SIN_CONEXION: 'Sin conexión', RECUPERANDO: 'Recuperando…' }[s.con];
    const clase = { CONECTADO: 'ok', RECONECTANDO: 'reconectando', SIN_CONEXION: 'caida', RECUPERANDO: 'recuperando' }[s.con];
    const segmentos = prog && prog.total > 0 && prog.total <= 12
      ? el('div', { class: 'trab__prog', 'aria-hidden': 'true' }, ...Array.from({ length: prog.total }, (_, i) => el('i', { class: i < prog.hechas ? 'h' : '' })))
      : prog && prog.total > 12 ? el('div', { class: 'trab__barra', 'aria-hidden': 'true' }, el('i', { class: `p${Math.round(10 * prog.hechas / prog.total)}` })) : null;
    return el('header', { class: 'trab__cab' },
      el('div', { class: 'trab__fila' },
        el('span', { class: 'trab__av', 'aria-hidden': 'true' },
          persona ? iniciales(persona.nombre) : el('i', { class: `ico ico-${mod?.icono || 'gear'}` })),
        el('div', { class: 'trab__quien' },
          el('h1', { text: persona ? String(persona.nombre).split(/\s+/)[0] : e.superficie.nombre }),
          el('small', { id: 'hora', text: `${e.superficie.nombre} · ${e.dispositivo.nombre}` })),
        el('span', { class: `con trab__con es-${clase}`, role: 'status', text: con }),
        pendientes ? el('span', { class: 'trab__cola', text: `${pendientes} sin enviar` }) : null),
      segmentos,
      prog?.texto ? el('p', { class: 'trab__texto', text: prog.texto }) : null);
  }

  function barraTrabajador(mod) {
    const c = ctx();
    const tabs = !s.estado.requiereTrabajador && mod?.pestanas ? mod.pestanas(c) : [];
    return el('nav', { class: 'trab__barra-inf', 'aria-label': 'Navegación' },
      ...tabs.map(t => el('button', { type: 'button', class: t.activa ? 'on' : '', 'aria-current': t.activa ? 'page' : null, onclick: t.onclick },
        el('i', { class: `ico ico-${t.icono}`, 'aria-hidden': 'true' }), t.texto)),
      el('button', { type: 'button', onclick: () => { desbloquearAudio(); abrirHoja(() => [
        el('div', { class: 'hoja__cab' }, el('div', {}, el('h2', { text: 'Ajustes' })),
          el('button', { type: 'button', class: 'btn btn--chico', text: 'Cerrar', onclick: cerrarHoja })),
        vistaAjustes()]); } },
        el('i', { class: 'ico ico-gear', 'aria-hidden': 'true' }), 'Ajustes'),
      s.estado.sesion ? el('button', { type: 'button', onclick: () => void salir() },
        el('i', { class: 'ico ico-sign-out', 'aria-hidden': 'true' }), 'Salir') : null);
  }

  function textoConexion() {
    return {
      CONECTADO: 'Red local · Conectada',
      RECONECTANDO: 'Reconectando con Wybix…',
      SIN_CONEXION: 'Sin conexión con Wybix',
      RECUPERANDO: 'Recuperando…',
    }[s.con];
  }

  function cabecera(mod) {
    const e = s.estado;
    const titulo = mod?.titulo ? mod.titulo(ctx()) : e.superficie.nombre;
    const pendientes = cola.leer().filter(x => x.quien === quienActual()).length;
    const clase = { CONECTADO: 'ok', RECONECTANDO: 'reconectando', SIN_CONEXION: 'caida', RECUPERANDO: 'recuperando' }[s.con];
    return el('header', { class: 'cab' },
      el('div', { class: 'cab__titulo' },
        el('span', { class: 'cab__marca', text: e.superficie.nombre }),
        el('h1', { text: titulo }),
        el('span', { class: 'cab__sub', id: 'hora', text: `${horaAhora()} · ${e.dispositivo.nombre}` })),
      el('span', { class: `con es-${clase}`, role: 'status', text: textoConexion() }),
      pendientes ? el('span', { class: 'cola', text: `${pendientes} sin enviar` }) : null,
      el('div', { class: 'cab__acciones' },
        e.sesion ? el('span', { class: 'quien' },
          el('span', { class: 'avatar', 'aria-hidden': 'true', text: iniciales(e.sesion.persona.nombre) }),
          e.sesion.persona.nombre,
          el('button', { type: 'button', class: 'btn btn--chico', text: 'Salir', onclick: () => void salir() })) : null,
        el('button', { type: 'button', class: 'btn btn--chico', 'aria-expanded': String(s.ajustes), text: 'Ajustes',
          onclick: () => { desbloquearAudio(); s.ajustes = !s.ajustes; pintar(); } })));
  }

  function franjas() {
    const out = [];
    if (s.con === 'SIN_CONEXION') {
      out.push(el('div', { class: 'franja franja--caida', role: 'alert' },
        el('p', { text: s.desdeCache ? `Sin conexión con Wybix. Mostrando lo que había a las ${s.desdeCache}.` : 'Sin conexión con Wybix. Lo que ves puede no estar al día.' })));
    }
    const mod = WX.superficies[tipoActual()];
    if (pref.sonido && !sonidoListo() && s.estado?.superficie?.sonido && !s.estado?.requiereTrabajador && mod?.conSonido !== false) {
      out.push(el('div', { class: 'franja franja--aviso' },
        el('p', { text: 'El sonido de avisos está apagado hasta que toques la pantalla.' }),
        el('button', { type: 'button', class: 'btn btn--chico btn--primario', text: 'Activar sonido', onclick: () => desbloquearAudio() })));
    }
    if (s.franja?.texto) {
      out.push(el('div', { class: `franja franja--${s.franja.tipo === 'ok' ? 'ok' : s.franja.tipo === 'caida' ? 'caida' : 'aviso'}`, role: 'status' },
        el('p', { text: s.franja.texto }),
        el('button', { type: 'button', class: 'btn btn--chico', text: 'Entendido', onclick: () => { s.franja = null; pintar(); } })));
    }
    if (s.error) out.push(el('div', { class: 'franja franja--caida', role: 'alert' }, el('p', { text: s.error })));
    return out;
  }

  function vistaAjustes() {
    const silenciado = Date.now() < (pref.silencioHasta || 0);
    return el('section', { class: 'ajustes', 'aria-label': 'Ajustes de esta pantalla' },
      el('h2', { text: 'Esta pantalla' }),
      el('div', { class: 'ajustes__fila' },
        el('label', {},
          el('input', { type: 'checkbox', id: 'sonido', checked: pref.sonido, onchange: (e) => { pref.sonido = e.target.checked; guardarPref(); desbloquearAudio(); pintar(); pintarHoja(); } }),
          'Sonido de avisos'),
        el('label', {}, 'Volumen',
          el('input', { type: 'range', id: 'volumen', min: '0', max: '1', step: '0.05', value: String(pref.volumen),
            oninput: (e) => { pref.volumen = Number(e.target.value); guardarPref(); } })),
        el('button', { type: 'button', class: 'btn btn--chico', text: 'Probar sonido',
          onclick: () => { const c = contextoAudio(); if (c) c.resume().then(() => { tono(); pintar(); pintarHoja(); }, () => {}); } }),
        el('button', { type: 'button', class: 'btn btn--chico', text: silenciado ? 'Quitar silencio' : 'Silenciar 1 hora',
          onclick: () => { pref.silencioHasta = silenciado ? 0 : Date.now() + 3600_000; guardarPref(); pintar(); pintarHoja(); } })),
      el('div', { class: 'ajustes__fila' },
        el('span', { text: 'Tema' }),
        el('div', { class: 'seg', role: 'group', 'aria-label': 'Tema' },
          ...[['auto', 'Automático'], ['light', 'Claro'], ['dark', 'Oscuro']].map(([v, t]) =>
            el('button', { type: 'button', 'aria-pressed': String(pref.tema === v), text: t,
              onclick: () => { pref.tema = v; guardarPref(); aplicarTema(); pintar(); pintarHoja(); } }))),
        el('button', { type: 'button', class: 'btn btn--chico', text: 'Cambiar función', onclick: () => abrirCambioFuncion() })),
      el('small', { text: 'Cambiar la función pide el PIN de un administrador.' }));
  }

  // ------------------------------------------------ entrar (trabajador)
  function vistaEntrar() {
    const e = s.entrar;
    const conPin = !!s.estado?.entrar?.pin;
    if (e.pestaña === 'pin' && conPin && !e.personas) {
      e.personas = [];
      api('/api/trabajador/personas').then(r => { e.personas = r.datos.personas || []; pintar(); }).catch(() => {});
    }
    const pestañas = conPin ? el('div', { class: 'entrar__tabs', role: 'group', 'aria-label': 'Cómo entrar' },
      el('button', { type: 'button', 'aria-pressed': String(e.pestaña === 'qr'), text: 'Escanear QR', onclick: () => { e.pestaña = 'qr'; e.error = null; pintar(); } }),
      el('button', { type: 'button', 'aria-pressed': String(e.pestaña === 'pin'), text: 'Usar PIN', onclick: () => { e.pestaña = 'pin'; e.error = null; e.personas = null; pintar(); } })) : null;

    let cuerpo;
    if (e.pestaña === 'pin' && conPin) {
      const puntos = el('div', { class: 'pin-puntos', 'aria-label': `${e.pin.length} dígitos` },
        ...Array.from({ length: Math.max(4, e.pin.length) }, (_, i) => el('i', { class: i < e.pin.length ? 'lleno' : '' })));
      const tecla = (t) => el('button', { type: 'button', text: t === '<' ? '⌫' : t, 'aria-label': t === '<' ? 'Borrar' : t,
        onclick: () => { if (t === '<') e.pin = e.pin.slice(0, -1); else if (e.pin.length < 8) e.pin += t; pintar(); } });
      cuerpo = [
        el('div', { class: 'personas' }, ...(e.personas || []).map(p =>
          el('button', { type: 'button', class: 'persona', 'aria-pressed': String(e.persona === p.id),
            onclick: () => { e.persona = p.id; e.pin = ''; e.error = null; pintar(); } },
            el('span', { class: 'avatar', 'aria-hidden': 'true', text: iniciales(p.nombre) }), p.nombre))),
        e.persona ? puntos : null,
        e.persona ? el('div', { class: 'teclado' }, ...['1', '2', '3', '4', '5', '6', '7', '8', '9', '<', '0'].map(tecla),
          el('button', { type: 'button', text: 'OK', 'aria-label': 'Entrar', disabled: e.pin.length < 4 || e.ocupado, onclick: () => void entrarConPin() })) : null,
      ];
    } else {
      const campo = el('input', { class: 'campo', id: 'qr', type: 'text', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false',
        placeholder: 'Escanea o pega tu código', 'aria-label': 'Tu código',
        onkeydown: (ev) => { if (ev.key === 'Enter') void entrarConQr(ev.target.value); } });
      cuerpo = [
        el('p', { class: 'nota-pie', text: 'Abre la cámara de la tablet y apunta a tu QR: se abre Wybix y entras. Con un lector de códigos, escanéalo aquí.' }),
        campo,
        el('button', { type: 'button', class: 'btn btn--primario btn--grande', text: e.ocupado ? 'Entrando…' : 'Entrar', disabled: e.ocupado,
          onclick: () => void entrarConQr(document.getElementById('qr')?.value) }),
      ];
    }
    return [el('section', { class: 'entrar' },
      el('div', {},
        el('h2', { class: 'reposo__hola', text: 'Hola. ¿Quién eres?' }),
        el('p', { class: 'nota-pie', text: `${s.estado.superficie.nombre} · ${s.estado.dispositivo.nombre}` })),
      pestañas, ...cuerpo,
      e.error ? el('p', { class: 'error', role: 'alert', text: e.error }) : null)];
  }

  // ------------------------------------------------- cambiar la funcion
  async function abrirCambioFuncion() {
    let r;
    try { r = await api('/api/dispositivo/funciones'); } catch { avisar('Sin conexión con Wybix.'); return; }
    if (r.status !== 200) { avisar(r.datos.error || 'No se pudo.'); return; }
    const f = { elegida: null, estacion: null, admin: null, pin: '', error: null, ...r.datos };
    const render = () => {
      const fun = f.funciones.find(x => x.tipo === f.elegida);
      return [
        el('div', { class: 'hoja__cab' },
          el('div', {}, el('h2', { text: 'Cambiar función' }), el('p', { text: 'Esta tablet dejará de ser lo que es ahora. Lo autoriza un administrador.' })),
          el('button', { type: 'button', class: 'btn btn--chico', text: 'Cerrar', onclick: cerrarHoja })),
        el('div', { class: 'seccion' }, el('h3', { text: 'Nueva función' }),
          el('div', { class: 'opciones' }, ...f.funciones.map(x =>
            el('button', { type: 'button', class: 'opcion', 'aria-pressed': String(f.elegida === x.tipo), disabled: x.tipo === f.actual && !x.requiereEstacion,
              text: x.tipo === f.actual ? `${x.nombre} (actual)` : x.nombre, onclick: () => { f.elegida = x.tipo; pintarHoja(); } })))),
        fun?.requiereEstacion ? el('div', { class: 'seccion' }, el('h3', { text: 'Estación' }),
          el('div', { class: 'opciones' }, ...f.estaciones.map(x =>
            el('button', { type: 'button', class: 'opcion', 'aria-pressed': String(f.estacion === x.id), text: x.nombre, onclick: () => { f.estacion = x.id; pintarHoja(); } })),
            el('button', { type: 'button', class: 'opcion', 'aria-pressed': String(f.estacion === 'todas'), text: 'Todas', onclick: () => { f.estacion = 'todas'; pintarHoja(); } }))) : null,
        el('div', { class: 'seccion' }, el('h3', { text: 'Autoriza' }),
          f.autorizan.length ? el('div', { class: 'personas' }, ...f.autorizan.map(p =>
            el('button', { type: 'button', class: 'persona', 'aria-pressed': String(f.admin === p.id), onclick: () => { f.admin = p.id; pintarHoja(); } },
              el('span', { class: 'avatar', text: iniciales(p.nombre) }), p.nombre)))
            : el('p', { class: 'vacio-chico', text: 'Ningún administrador tiene PIN. Asígnalo en Wybix → Dispositivos locales → Personas.' }),
          f.admin ? el('input', { class: 'campo', id: 'pin-admin', type: 'password', inputmode: 'numeric', autocomplete: 'off', placeholder: 'PIN del administrador',
            value: f.pin, oninput: (e) => { f.pin = e.target.value.replace(/\D/g, '').slice(0, 8); } }) : null),
        f.error ? el('p', { class: 'error', role: 'alert', text: f.error }) : null,
        el('button', { type: 'button', class: 'btn btn--primario btn--grande', text: 'Cambiar',
          disabled: !f.elegida || !f.admin || (fun?.requiereEstacion && !f.estacion),
          onclick: async () => {
            const q = await api('/api/dispositivo/funcion', { method: 'POST', body: {
              superficie: f.elegida, accesoId: f.admin, pin: f.pin,
              stationId: f.estacion === 'todas' ? null : f.estacion, todas: f.estacion === 'todas' } }).catch(() => null);
            if (!q) { f.error = 'Sin conexión con Wybix.'; pintarHoja(); return; }
            if (q.status !== 200) { f.error = q.datos.error || 'No se pudo cambiar.'; f.pin = ''; pintarHoja(); return; }
            cerrarHoja(); cerrarEventos(); limpiarPrivado(); s.ajustes = false;
            avisar('Listo: esta tablet cambió de función.');
            await sincronizar('inicio');
          } }),
      ];
    };
    abrirHoja(render);
  }

  // --------------------------------------------------------- emparejar
  async function emparejar(token, boton, salida) {
    desbloquearAudio();
    boton.disabled = true;
    salida.textContent = '';
    try {
      const r = await api('/api/pair', { method: 'POST', body: { token } });
      if (r.status === 200) { history.replaceState(null, '', '/'); await arrancar(); return; }
      salida.textContent = r.datos.error || 'No se pudo conectar esta pantalla.';
    } catch {
      salida.textContent = 'No hay conexión con Wybix. Revisa que la tablet esté en la misma red.';
    }
    boton.disabled = false;
  }

  // ------------------------------------------------------------ reloj
  function tic() {
    if (s.modo !== 'lista') return;
    const h = document.getElementById('hora');
    if (h && s.estado) h.textContent = `${horaAhora()} · ${s.estado.dispositivo.nombre}`;
    const m = WX.superficies[tipoActual()];
    if (m?.tic && !s.estado?.requiereTrabajador) m.tic(ctx());
  }

  /* Pantalla encendida: solo en contexto seguro. Por HTTP en la LAN no existe
     y se configura en la tablet (docs). No se insiste. */
  async function mantenerEncendida() {
    try { if ('wakeLock' in navigator && document.visibilityState === 'visible') await navigator.wakeLock.request('screen'); }
    catch { /* no disponible aqui */ }
  }

  async function arrancar() {
    s.modo = 'cargando';
    pintar();
    await sincronizar('inicio');
    void mantenerEncendida();
  }

  WX.iniciar = function iniciar() {
    aplicarTema();
    const w = location.pathname.match(/^\/w\/([A-Za-z0-9_-]{40,60})$/);
    if (/^\/pair\//.test(location.pathname)) { s.modo = 'emparejar'; pintar(); }
    else if (w) {
      /* El QR personal abrio esta URL con la camara de la tablet: se entra y
         se quita el token de la barra de direcciones. */
      s.modo = 'entrar-qr'; pintar();
      history.replaceState(null, '', '/');
      (async () => {
        const r = await api('/api/s/estado').catch(() => null);
        if (!r || r.status === 401) { s.modo = 'sin-credencial'; pintar(); return; }
        s.estado = r.datos; s.modo = 'lista';
        if (!(await entrarConQr(w[1]))) pintar();
      })();
    } else void arrancar();

    setInterval(tic, 1000);
    setInterval(() => { if (s.modo === 'lista' && s.con === 'CONECTADO') void sincronizar('recupera'); }, REVISION_MS);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && s.modo === 'lista') { void sincronizar('recupera'); void mantenerEncendida(); }
    });
    window.addEventListener('online', () => { if (s.modo === 'lista') { void procesarCola(); refrescar(100); } });
    document.addEventListener('pointerdown', desbloquearAudio, { passive: true });
  };

  WX.ctx = ctx;
})();
