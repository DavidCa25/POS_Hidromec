'use strict';
/* Conversación, ayuda, navegación, pendientes y el estado del sistema. */
const { DESTINOS } = require('../lenguaje/intents');
const { normalizar } = require('../lenguaje/normalizar');

/* Cómo se hace cada cosa en Wybix: la pantalla y el paso clave. */
const COMO = [
  [/devoluci|devolver|reembolso|cancelar una venta|cancelo una venta/, '/dashboard/venta', 'En Venta, toca «Devolución», busca el ticket por folio y elige qué regresa. Pide autorización si tu usuario no tiene el permiso.'],
  [/factur|timbr/, '/dashboard/facturacion', 'En Facturación eliges la venta por folio, capturas los datos fiscales del cliente y timbras.'],
  [/corte|cerrar (?:la )?caja|arqueo/, '/dashboard/corte-dia', 'En Corte de caja cuentas el efectivo, Wybix lo compara con lo esperado y cierras el turno.'],
  [/compra|surti|factura de compra/, '/dashboard/registrarCompra', 'En Registrar compra eliges al proveedor, agregas los productos con su costo y guardas: la existencia sube sola.'],
  [/precio/, '/dashboard/inventario/precios', 'En Precios buscas el producto y cambias el precio; también puedes pedírmelo aquí: «sube la coca a 22».'],
  [/producto|articulo/, '/dashboard/inventario', 'En Inventario, «Nuevo producto». O dímelo aquí: «crea pay de queso a 45».'],
  [/cliente|credito/, '/dashboard/clientes', 'En Clientes, «Nuevo cliente». El crédito (fiado) se asigna en su ficha.'],
  [/proveedor/, '/dashboard/proveedores', 'En Proveedores, «Nuevo proveedor». Los pagos se registran en su estado de cuenta, o aquí: «págale 500 a Bimbo».'],
  [/gasto|egreso/, '/dashboard/egresos', 'En Gastos eliges el concepto, el monto y cómo se pagó. O dímelo aquí: «pagué 850 de luz».'],
  [/cambio a la caja|meto|entrada|saco|retiro|salida/, '/dashboard/venta', 'Desde Venta: «Entrada de efectivo» o «Retiro». O aquí: «mete 500 de cambio».'],
  [/conteo|inventario fisico|contar/, '/dashboard/conteo', 'En Conteo de inventario capturas lo que hay en físico y Wybix ajusta las diferencias.'],
  [/traspaso|transferencia|sucursal/, '/dashboard/traspasos', 'En Traspasos eliges la sucursal destino y los productos; la otra sucursal lo recibe.'],
  [/receta|ingrediente|formula/, '/dashboard/recetas', 'En Recetas eliges el producto y le agregas sus ingredientes con la cantidad que lleva cada uno.'],
  [/cita|agenda/, '/dashboard/agenda', 'En Agenda tocas el horario libre del profesional y eliges cliente y servicio. O aquí: «agenda a Laura mañana a las 5».'],
  [/mesa|comanda|cuenta/, '/dashboard/mesas', 'En Mesas abres la mesa, agregas lo que piden y «Enviar a cocina». La cuenta se cobra desde la misma mesa.'],
  [/oferta|descuento|promocion/, '/dashboard/inventario/ofertas', 'En Ofertas creas la promoción, eliges los productos y las fechas.'],
  [/usuario|permiso|cajero/, '/dashboard/usuarios', 'En Usuarios das de alta a la persona y eliges su rol y sus permisos.'],
  [/impresora|cajon|ticket|configur/, '/dashboard/configuracion', 'En Configuración, sección Equipo: impresora de tickets y cajón de dinero.'],
  [/import|excel/, '/dashboard/importador', 'En el Importador subes tu archivo de Excel y relacionas las columnas.'],
  [/respald/, '/dashboard/configuracion', 'En Configuración, Respaldos: activa el respaldo automático y elige la carpeta.'],
  [/propina/, '/dashboard/propinas', 'En Propinas ves lo que se juntó y haces el reparto.'],
  [/punto|lealtad|monedero/, '/dashboard/fidelizacion', 'En Fidelización eliges cómo se ganan y se canjean los puntos.'],
  [/reporte|venta.* mes|estadistic/, '/dashboard/estadisticas', 'En Estadísticas ves las ventas por día, por producto y por forma de pago. O pregúntame: «¿cómo voy este mes?».'],
];

/** La pantalla conectada por su nombre (sin las desconectadas). */
async function dispositivoDe(h, dicho) {
  const ds = await h.q('SELECT CONVERT(VARCHAR(36), id) AS id, nombre, superficie, config FROM dbo.dispositivos_locales WHERE revocado_en IS NULL;').catch(() => []);
  const d = h.llano(dicho);
  const x = ds.find((y) => h.llano(y.nombre) === d) || ds.find((y) => h.llano(y.nombre).includes(d));
  return x || { error: h.msg(ds.length ? `No encuentro la pantalla «${dicho}». Conectadas: ${ds.map((y) => y.nombre).join(', ')}.` : 'No hay pantallas conectadas.') };
}

module.exports = (h) => {
  const dispositivo = (dicho) => dispositivoDe(h, dicho);
  /** Estado de multisucursal desde la nube (sucursales, reglas). */
  async function estadoMulti() {
    const m = h.multi();
    if (!m) return { error: h.msg('Multisucursal necesita la caja vinculada con la nube.') };
    try { const e = await m.estado(); return e?.multisucursal ? { m, e } : { error: h.msg('Este negocio no tiene varias sucursales.') }; }
    catch (err) { return { error: h.msg(`No pude leer las sucursales: ${err.message}`) }; }
  }
  const sucursalDe = (e, dicho) => {
    const d = h.llano(dicho || '');
    return (e.sucursales || []).find((s) => h.llano(s.nombre) === d) || (e.sucursales || []).find((s) => h.llano(s.nombre).includes(d));
  };
  return {
  /* El saludo es el resumen del día (acciones/resumen.js): al abrir el chat
     la primera vez del día, y cada vez que lo saludan. */
  async saludo(_it, ctx) {
    return h.resumen.briefing(ctx);
  },

  async ayuda() {
    return h.msg('Soy Wybix. Conozco tu negocio: ventas, caja, inventario, compras, proveedores, clientes, gastos y más. Escríbeme como le hablarías a tu encargado, por ejemplo:', {
      opciones: [
        { etiqueta: '¿Cómo voy hoy?', texto: '¿Cómo voy hoy?' },
        { etiqueta: '¿Qué me falta comprar?', texto: '¿Qué me falta comprar?' },
        { etiqueta: '¿Quién me debe?', texto: '¿Quién me debe?' },
        { etiqueta: '¿Cuánto hay en caja?', texto: '¿Cuánto hay en caja?' },
        { etiqueta: 'Pagué 850 de luz', texto: 'Pagué 850 de luz' },
        { etiqueta: '¿Qué debo revisar?', texto: '¿Qué pendientes tengo?' },
      ] });
  },

  async 'ayuda.como'(it) {
    const texto = normalizar(it.texto || it.slots.destino?.texto || '').texto;
    const c = COMO.find(([re]) => re.test(texto));
    /* Explica y ofrece llevar; no navega solo (la persona preguntó cómo, no pidió ir). */
    if (c) return h.msg(c[2], { opciones: [{ etiqueta: 'Llévame ahí', intent: 'ir_a', params: { ruta: c[1] } }] });
    const d = it.slots.destino;
    if (d?.valor) return h.msg(`Eso está en ${d.texto}.`, { opciones: [{ etiqueta: `Ir a ${d.texto}`, intent: 'ir_a', params: { ruta: d.valor, etiqueta: d.texto } }] });
    return h.msg('Dime qué quieres hacer y te digo dónde, o abre «Recorridos» en Wybix Guide para verlo paso a paso.');
  },

  async ir_a(it) {
    const d = it.slots.destino;
    const dest = DESTINOS.find(([, ruta]) => ruta === d.valor);
    return h.ir(`Te llevo a ${dest ? dest[2] : d.texto}.`, d.valor);
  },

  async 'consulta.pendientes'(_it, ctx) {
    const hs = (await h.listarHallazgos(ctx)).slice(0, 5);
    if (!hs.length) return h.msg('Todo en orden por aquí. Te aviso si algo cambia.', { tono: 'exito' });
    return h.msg(`Tienes ${h.plural(hs.length, 'cosa')} por revisar. La más urgente primero:`, {
      opciones: hs.map((x) => ({ etiqueta: x.titulo, intent: 'hallazgo.ver', params: { id: x.id } })), tono: 'atencion' });
  },

  async 'sistema.estado'() {
    const s = await h.sistema();
    const datos = [];
    const mal = [];
    if (s.respaldo) {
      const cuando = s.respaldo.ultimo ? h.fechaCorta(s.respaldo.ultimo) : 'nunca';
      datos.push({ etiqueta: 'Respaldo', valor: s.respaldo.activo ? `automático · último ${cuando}` : 'apagado' });
      if (!s.respaldo.activo || s.respaldo.error) mal.push('el respaldo');
    }
    if (s.nube) {
      datos.push({ etiqueta: 'Nube', valor: !s.nube.activa ? 'no configurada' : s.nube.pendientes ? `${s.nube.pendientes} cambios por subir` : 'al día' });
      if (s.nube.activa && s.nube.error) mal.push('la nube');
    }
    if (s.licencia) {
      datos.push({ etiqueta: 'Licencia', valor: s.licencia.dias != null ? `${s.licencia.dias} días` : (s.licencia.modo || '—') });
      if (s.licencia.relojAtrasado) mal.push('la hora de la computadora');
    }
    if (s.impresora) { datos.push({ etiqueta: 'Impresora', valor: s.impresora.configurada ? 'configurada' : 'sin configurar' }); if (!s.impresora.configurada) mal.push('la impresora'); }
    if (s.disco) { datos.push({ etiqueta: 'Disco libre', valor: `${s.disco.libreGB} GB` }); if (s.disco.libreGB < 5) mal.push('el espacio en disco'); }
    return h.msg(mal.length ? `Hay que revisar ${mal.join(', ')}.` : 'Todo el sistema está en orden.', {
      datos, tono: mal.length ? 'atencion' : 'exito',
      opciones: mal.length ? [{ etiqueta: 'Abrir configuración', intent: 'ir_a', params: { ruta: '/dashboard/configuracion' } }] : [] });
  },

  /* =============================================== CONFIGURACIÓN HABLADA */
  async 'usuario.activar'(it, ctx) {
    const u = await h.uno('SELECT id, usuario, rol, active FROM dbo.users WHERE id = @id;', [h.id(h.v(it, 'usuario'))]);
    if (!u) return h.msg('No encontré a ese usuario.');
    const activo = !!h.v(it, 'activo');
    if (!!u.active === activo) return h.msg(`${u.usuario} ya está ${activo ? 'activo' : 'desactivado'}.`);
    if (!activo && Number(u.id) === Number(ctx.userId)) return h.msg('No puedes desactivar tu propio usuario.');
    if (!activo && u.rol === 'admin') {
      const otros = await h.uno("SELECT COUNT(*) AS n FROM dbo.users WHERE rol = 'admin' AND active = 1 AND id <> @id;", [h.id(u.id)]);
      if (!Number(otros?.n)) return h.msg('Debe quedar al menos un administrador activo.');
    }
    return h.msg('Esto voy a cambiar:', { plan: h.plan('usuario.activar', {
      titulo: `${activo ? 'Activar' : 'Desactivar'} a ${u.usuario}`,
      vista: [{ etiqueta: 'Usuario', valor: `${u.active ? 'activo' : 'desactivado'} → ${activo ? 'activo' : 'desactivado'}` }],
      avisos: activo ? [] : ['Ya no podrá entrar; su historial se queda.'],
      ejecutar: { api: 'electronAPI.usersSetActive', payload: { id: Number(u.id), active: activo } }, permiso: 'CONFIGURACION_ADMINISTRAR',
    }) });
  },

  async 'usuario.rol'(it, ctx) {
    const u = await h.uno('SELECT id, usuario, rol, active FROM dbo.users WHERE id = @id;', [h.id(h.v(it, 'usuario'))]);
    if (!u) return h.msg('No encontré a ese usuario.');
    const rol = h.v(it, 'rol');
    const nombre = { admin: 'Administrador', supervisor: 'Encargado', cajero: 'Cajero' };
    if (u.rol === rol) return h.msg(`${u.usuario} ya es ${nombre[rol].toLowerCase()}.`);
    if (u.rol === 'admin' && rol !== 'admin') {
      const otros = await h.uno("SELECT COUNT(*) AS n FROM dbo.users WHERE rol = 'admin' AND active = 1 AND id <> @id;", [h.id(u.id)]);
      if (!Number(otros?.n)) return h.msg('Debe quedar al menos un administrador.');
    }
    return h.msg('Esto voy a cambiar:', { plan: h.plan('usuario.rol', {
      titulo: `${u.usuario} · ${nombre[rol]}`, vista: [{ etiqueta: 'Puesto', valor: `${nombre[u.rol] || u.rol} → ${nombre[rol]}` }],
      avisos: ['Cambia lo que puede hacer: los permisos del puesto nuevo, más los que se le dieron aparte.'],
      ejecutar: { api: 'electronAPI.usersUpdateRole', payload: { id: Number(u.id), rol } }, permiso: 'CONFIGURACION_ADMINISTRAR',
    }) });
  },

  /* «Dale a Pedro permiso de devoluciones»: lo ajustable que tendrá, con ese cambio. */
  async 'usuario.permiso'(it) {
    const P = require('../../seguridad/permisos');
    const u = await h.uno('SELECT id, usuario, rol FROM dbo.users WHERE id = @id;', [h.id(h.v(it, 'usuario'))]);
    if (!u) return h.msg('No encontré a ese usuario.');
    const catalogo = [
      ...P.HACER.flatMap((g) => g.permisos.map((p) => ({ claves: [p.clave], nombre: p.nombre }))),
      ...P.VER.flatMap((v) => v.opciones.filter((o) => o.permisos.length).map((o) => ({ claves: o.permisos, nombre: `${v.nombre}: ${o.nombre}` }))),
    ];
    const dicho = h.llano(h.v(it, 'permisoTexto'));
    const p = catalogo.find((x) => h.llano(x.nombre) === dicho) || catalogo.find((x) => h.llano(x.nombre).includes(dicho) || dicho.includes(h.llano(x.nombre)))
      || (/costo/.test(dicho) && catalogo.find((x) => x.claves.includes('VER_COSTOS'))) || (/reporte|numeros|estadistica/.test(dicho) && catalogo.find((x) => x.claves.includes('REPORTES_VER')))
      || (/ventas de todos|todas las ventas/.test(dicho) && catalogo.find((x) => x.claves.includes('VER_VENTAS_TODOS')));
    if (!p) return h.msg(`No conozco el permiso «${h.v(it, 'permisoTexto')}». Algunos: ${catalogo.slice(0, 8).map((x) => x.nombre.toLowerCase()).join(', ')}.`);
    const extras = (await h.q("IF OBJECT_ID(N'dbo.user_permissions','U') IS NOT NULL SELECT permiso FROM dbo.user_permissions WHERE user_id = @id;", [h.id(u.id)]).catch(() => [])).map((r) => r.permiso);
    const tiene = new Set([...P.permisosDeUsuario(u.rol, extras)].filter((x) => P.AJUSTABLES.includes(x)));
    const quitar = !!h.v(it, 'quitar');
    const ya = p.claves.every((c) => tiene.has(c));
    if (quitar ? !p.claves.some((c) => tiene.has(c)) : ya) return h.msg(`${u.usuario} ${quitar ? 'no tiene' : 'ya tiene'} «${p.nombre}».`);
    for (const c of p.claves) { if (quitar) tiene.delete(c); else tiene.add(c); }
    return h.msg('Esto voy a cambiar:', { plan: h.plan('usuario.permiso', {
      titulo: `${u.usuario} · ${quitar ? 'sin' : 'con'} «${p.nombre}»`,
      vista: [{ etiqueta: p.nombre, valor: quitar ? 'sí → no' : 'no → sí' }],
      ejecutar: { api: 'electronAPI.usersSetPermissions', payload: { id: Number(u.id), tiene: [...tiene] } }, permiso: 'CONFIGURACION_ADMINISTRAR',
    }) });
  },

  async 'caja.alta'(it) {
    const nombre = String(h.v(it, 'nombre') || '').trim().slice(0, 100);
    const ya = await h.uno('SELECT TOP 1 name FROM dbo.registers WHERE name = @n;', [['n', h.sql.NVarChar(100), nombre]]);
    if (ya) return h.msg(`Ya existe «${ya.name}».`);
    const code = (nombre.match(/\d+/) || [])[0] ? `CAJA${(nombre.match(/\d+/) || [])[0]}` : h.llano(nombre).toUpperCase().replace(/[^A-Z0-9]+/g, '').slice(0, 20);
    return h.msg('Esta caja voy a agregar:', { plan: h.plan('caja.alta', {
      titulo: `Caja nueva · ${nombre}`, vista: [{ etiqueta: 'Caja', valor: nombre }, { etiqueta: 'Clave', valor: code }],
      avisos: ['Cada equipo elige su caja al abrir el turno.'],
      ejecutar: { api: 'electronAPI.registersAdd', payload: { code, name: nombre } }, permiso: 'CONFIGURACION_ADMINISTRAR',
    }) });
  },

  async 'caja.activar'(it) {
    const dicho = h.llano(h.v(it, 'cajaTexto'));
    const cajas = await h.q('SELECT id, name, is_active FROM dbo.registers;');
    const num = (dicho.match(/\d+/) || [])[0];
    const c = cajas.find((x) => h.llano(x.name) === dicho || h.llano(x.name) === `caja ${dicho}`) || (num && cajas.find((x) => (String(x.name).match(/\d+/) || [])[0] === num));
    if (!c) return h.msg(`No encuentro la caja «${h.v(it, 'cajaTexto')}».`);
    const activo = !!h.v(it, 'activo');
    if (!!c.is_active === activo) return h.msg(`${c.name} ya está ${activo ? 'activa' : 'desactivada'}.`);
    const abierta = !activo && await h.uno('SELECT TOP 1 1 AS x FROM dbo.cash_closures WHERE register_id = @r AND closed_at IS NULL;', [['r', h.sql.Int, c.id]]);
    if (abierta) return h.msg(`${c.name} tiene turno abierto: haz su corte antes de desactivarla.`);
    return h.msg('Esto voy a cambiar:', { plan: h.plan('caja.activar', {
      titulo: `${activo ? 'Activar' : 'Desactivar'} ${c.name}`, vista: [{ etiqueta: c.name, valor: `${c.is_active ? 'activa' : 'desactivada'} → ${activo ? 'activa' : 'desactivada'}` }],
      ejecutar: { api: 'electronAPI.registersSetActive', payload: { id: Number(c.id), is_active: activo } }, permiso: 'CONFIGURACION_ADMINISTRAR',
    }) });
  },

  /* «Enciende Servicios», «apaga la venta suelta». Socios, Propinas y
     Asistencia se encienden con sus preguntas (su propio canal). */
  async 'modulo.activar'(it) {
    const modulo = h.v(it, 'modulo'), activo = !!h.v(it, 'activo');
    const NOMBRE = { loyalty: 'Fidelización', servicios: 'Servicios', mesas: 'Mesas', comandas: 'Comandas', 'venta-suelta': 'Venta suelta', asistencia: 'Asistencia',
                     socios: 'Socios', propinas: 'Propinas', 'pago-servicios': 'Pago de servicios' };
    const actual = await h.uno('SELECT enabled FROM dbo.business_modules WHERE module_key = @k;', [['k', h.sql.NVarChar(40), modulo]]).catch(() => null);
    if (!!actual?.enabled === activo) return h.msg(`${NOMBRE[modulo]} ya está ${activo ? 'encendida' : 'apagada'}.`);
    if (modulo === 'pago-servicios' && activo) return h.msg('Pago de servicios requiere un contrato con el proveedor: se enciende desde Aplicaciones cuando esté listo.');
    if (modulo === 'socios' && activo) return h.ir('Socios se enciende con sus preguntas (quiénes son, de quién es cada cosa y cómo se reparte). Te llevo.', '/dashboard/aplicaciones');
    if (modulo === 'propinas' && activo) {
      const reparto = h.v(it, 'reparto') || 'PAREJO';
      return h.msg('Así voy a encender Propinas:', { plan: h.plan('modulo.activar', {
        titulo: 'Encender Propinas',
        vista: [{ etiqueta: 'Reparto', valor: { PAREJO: 'parejo entre quienes trabajaron', HORAS: 'por horas trabajadas', ATENDIO: 'a quien atendió' }[reparto] },
                { etiqueta: 'Sugeridas', valor: '10%, 15% y 20%' }, { etiqueta: 'Comisión de la terminal', valor: 'la absorbe el negocio' }],
        avisos: ['Lo cambias después en Propinas, o dime «las propinas se reparten por horas».'],
        ejecutar: { api: 'electronAPI.propinasActivar', payload: { reparto, sugeridas: [10, 15, 20], comisionPct: 0, comisionA: 'NEGOCIO' } }, permiso: 'CONFIGURACION_ADMINISTRAR',
      }) });
    }
    if (modulo === 'asistencia' && activo) {
      return h.msg('Así voy a encender Asistencia:', { plan: h.plan('modulo.activar', {
        titulo: 'Encender Asistencia',
        vista: [{ etiqueta: 'Retardos', valor: 'se marcan' }, { etiqueta: 'Tolerancia', valor: 'sí' }, { etiqueta: 'Checar para vender', valor: 'no' }],
        avisos: ['Las reglas se ajustan en Asistencia → Reglas.'],
        ejecutar: { api: 'electronAPI.asistenciaActivar', payload: { cuentaExtra: false, tolerancia: true, descansoPagado: false, diaLibreExtra: false, marcaRetardos: true, entradaParaVender: false } },
        permiso: 'CONFIGURACION_ADMINISTRAR',
      }) });
    }
    return h.msg('Esto voy a cambiar:', { plan: h.plan('modulo.activar', {
      titulo: `${activo ? 'Encender' : 'Apagar'} ${NOMBRE[modulo]}`, vista: [{ etiqueta: NOMBRE[modulo], valor: `${actual?.enabled ? 'encendida' : 'apagada'} → ${activo ? 'encendida' : 'apagada'}` }],
      avisos: activo ? [] : ['Lo registrado se queda; solo deja de verse y usarse.'],
      ejecutar: { api: 'electronAPI.modulosSet', args: [modulo, activo] }, permiso: 'CONFIGURACION_ADMINISTRAR',
    }) });
  },

  async 'negocio.giro'(it) {
    const giro = h.v(it, 'giro');
    return h.msg('Esto voy a cambiar:', { plan: h.plan('negocio.giro', {
      titulo: `Giro del negocio · ${giro}`, vista: [{ etiqueta: 'Giro', valor: giro }],
      avisos: ['Ajusta las sugerencias y ejemplos de Wybix a ese giro.'],
      ejecutar: { api: 'electronAPI.negocioGiroGuardar', payload: { giro } }, permiso: 'CONFIGURACION_ADMINISTRAR',
    }) });
  },

  async 'respaldo.ahora'() {
    return h.msg('Voy a hacer un respaldo:', { plan: h.plan('respaldo.ahora', {
      titulo: 'Respaldo ahora', vista: [{ etiqueta: 'Respaldo', valor: 'de toda la base, a la carpeta configurada' }],
      avisos: ['Puede tardar unos segundos; la caja sigue funcionando.'],
      ejecutar: { api: 'electronAPI.backupRunNow', args: [] }, permiso: 'CONFIGURACION_ADMINISTRAR',
    }) });
  },

  async 'respaldo.config'(it) {
    const cambios = {};
    if (h.v(it, 'hora') != null) cambios.time = h.v(it, 'hora');
    if (h.v(it, 'activo') != null) cambios.enabled = !!h.v(it, 'activo');
    if (h.v(it, 'retencion') != null) cambios.retentionDays = Math.max(1, Math.min(365, Number(h.v(it, 'retencion'))));
    const vista = [];
    if (cambios.enabled != null) vista.push({ etiqueta: 'Respaldo automático', valor: cambios.enabled ? 'encendido' : 'apagado' });
    if (cambios.time) vista.push({ etiqueta: 'Hora', valor: cambios.time });
    if (cambios.retentionDays) vista.push({ etiqueta: 'Se guardan', valor: `${cambios.retentionDays} días` });
    return h.msg('Así quedan los respaldos:', { plan: h.plan('respaldo.config', {
      titulo: 'Respaldos automáticos', vista,
      ejecutar: { api: 'electronAPI.backupSetConfig', args: [cambios] }, permiso: 'CONFIGURACION_ADMINISTRAR',
    }) });
  },

  /* «Avisa por WhatsApp cuando el pedido esté listo», «ya no avises de las membresías». */
  async 'whatsapp.config'(it) {
    const c = await h.whatsappConfig();
    if (!c || c.nube === false) return h.msg('Los avisos por WhatsApp necesitan la caja vinculada con la nube.');
    const actual = { pedidoListo: !!c.pedido_listo, membresia: !!c.membresia, diasAntes: Number(c.dias_antes) || 3, comoRenovar: c.como_renovar || 'Paga tu mensualidad en caja.' };
    const campo = h.v(it, 'campo'), valor = h.v(it, 'valor');
    if (actual[campo] === valor) return h.msg('Ya está así.');
    if (campo === 'diasAntes' && !(valor >= 1 && valor <= 15)) return h.msg('Elige de 1 a 15 días antes.');
    const N = { pedidoListo: 'Aviso de pedido listo', membresia: 'Aviso de membresía por vencer', diasAntes: 'Días antes de que venza' };
    const ver = (v) => (typeof v === 'boolean' ? (v ? 'sí' : 'no') : String(v));
    return h.msg('Esto voy a cambiar:', { plan: h.plan('whatsapp.config', {
      titulo: 'Avisos por WhatsApp', vista: [{ etiqueta: N[campo], valor: `${ver(actual[campo])} → ${ver(valor)}` }],
      ejecutar: { api: 'electronAPI.whatsappConfigGuardar', payload: { ...actual, [campo]: valor } }, permiso: 'CONFIGURACION_ADMINISTRAR',
    }) });
  },

  async 'aprobaciones.politica'(it) {
    const activas = !!h.v(it, 'activas');
    return h.msg('Esto voy a cambiar:', { plan: h.plan('aprobaciones.politica', {
      titulo: `${activas ? 'Encender' : 'Apagar'} las aprobaciones`,
      vista: [{ etiqueta: 'Aprobaciones', valor: activas ? 'se piden (PIN o app del dueño)' : 'ya no se piden' }],
      avisos: activas ? [] : ['Quien tenga el permiso hará esas operaciones sin pedir autorización. Queda en la bitácora.'],
      ejecutar: { api: 'electronAPI.aprobacionesCambiar', args: [activas] }, permiso: 'VENTAS_SUPERVISAR',
    }) });
  },

  async 'impuesto.crear'(it) {
    const nombre = String(h.v(it, 'nombre') || '').trim().slice(0, 80);
    const ya = await h.uno('SELECT TOP 1 nombre FROM dbo.CAT_impuestos WHERE nombre = @n;', [['n', h.sql.NVarChar(80), nombre]]).catch(() => null);
    if (ya) return h.msg(`Ya existe el impuesto «${ya.nombre}».`);
    const factor = h.v(it, 'factor') || 'Tasa', tasa = h.v(it, 'tasa'), cuota = h.v(it, 'cuota'), unidad = h.v(it, 'unidad'), clase = h.v(it, 'clase') || 'IEPS';
    return h.msg('Este impuesto voy a crear:', { plan: h.plan('impuesto.crear', {
      titulo: `Impuesto nuevo · ${nombre}`,
      vista: [{ etiqueta: 'Impuesto', valor: nombre }, { etiqueta: 'Tipo', valor: clase === 'LOCAL' ? 'Local' : 'IEPS' },
              { etiqueta: factor === 'Cuota' ? 'Cuota' : 'Tasa', valor: factor === 'Cuota' ? `${h.dinero(cuota)} por ${unidad || 'unidad'}` : `${Math.round(tasa * 10000) / 100}%` }],
      avisos: ['Para aplicarlo dime a qué productos: «ponle ' + nombre + ' a las papas».'],
      ejecutar: { api: 'electronAPI.impuestosGuardar', payload: { id: null, nombre, clase, factor, tasa, cuota, unidad, enBaseIva: clase === 'IEPS', nota: null, activo: true } },
      permiso: 'CONFIGURACION_ADMINISTRAR',
    }) });
  },

  /* ============================================ EMPRESAS Y SUCURSALES */
  async 'empresa.crear'(it) {
    const nombre = String(h.v(it, 'nombre') || '').trim().slice(0, 120);
    if (!nombre) return h.msg('¿Cómo se llama la empresa?');
    const giro = h.v(it, 'giro'), rfc = h.v(it, 'rfc');
    return h.msg('Esta empresa voy a crear:', { plan: h.plan('empresa.crear', {
      titulo: `Empresa nueva · ${nombre}`,
      vista: [{ etiqueta: 'Empresa', valor: nombre }, { etiqueta: 'Giro', valor: giro || 'lo eliges al entrar' }, ...(rfc ? [{ etiqueta: 'RFC', valor: rfc }] : [])],
      avisos: ['Es otra base de datos en esta computadora, con su propio catálogo, ventas y usuarios. Tarda un poco.'],
      ejecutar: { api: 'electronAPI.empresasCrear', payload: { nombre, giro, rfc } }, permiso: 'CONFIGURACION_ADMINISTRAR',
    }) });
  },

  async 'empresa.salir_grupo'() {
    return h.msg('Esto voy a hacer:', { plan: h.plan('empresa.salir_grupo', {
      titulo: 'Salir del grupo de empresas', vista: [{ etiqueta: 'Esta computadora', valor: 'deja de ver las empresas de otras computadoras' }],
      avisos: ['Para volver a entrar se necesita un código nuevo del grupo.'],
      ejecutar: { api: 'electronAPI.empresasEnlaceSalir', args: [] }, permiso: 'CONFIGURACION_ADMINISTRAR',
    }) });
  },

  async 'sucursal.crear'(it) {
    const nombre = String(h.v(it, 'nombre') || '').trim().slice(0, 80);
    const tipo = h.v(it, 'tipo') || 'BRANCH', desde = h.v(it, 'desde'), hasta = h.v(it, 'hasta');
    if (tipo === 'EVENT' && !desde) return h.msg('¿De qué día a qué día es el evento? Dímelo con «del 1 al 5 de mayo».');
    return h.msg(tipo === 'EVENT' ? 'Este evento voy a crear:' : 'Esta sucursal voy a crear:', { plan: h.plan('sucursal.crear', {
      titulo: `${tipo === 'EVENT' ? 'Evento' : 'Sucursal'} nueva · ${nombre}`,
      vista: [{ etiqueta: tipo === 'EVENT' ? 'Evento' : 'Sucursal', valor: nombre }, ...(desde ? [{ etiqueta: 'Fechas', valor: `${h.diaTexto(h.cuando(desde))} – ${h.diaTexto(h.cuando(hasta || desde))}` }] : [])],
      avisos: [tipo === 'EVENT' ? 'Después le mandas mercancía con un traspaso y al terminar recibes lo que sobró.' : 'Se une con el código que te da la nube en la otra computadora.'],
      ejecutar: { api: 'electronAPI.cloudCrearSucursal', payload: { nombre, tipo, starts_at: desde, ends_at: hasta || desde } }, permiso: 'CONFIGURACION_ADMINISTRAR',
    }) });
  },

  /* ======================================== PANTALLAS (Wybix Local Host) */
  async 'localhost.activar'(it) {
    const activo = !!h.v(it, 'activo');
    return h.msg('Esto voy a cambiar:', { plan: h.plan('localhost.activar', {
      titulo: `${activo ? 'Encender' : 'Apagar'} Wybix Local Host`, vista: [{ etiqueta: 'Pantallas y tablets', valor: activo ? 'se pueden conectar' : 'se desconectan' }],
      ejecutar: { api: 'wybix.localHost.activar', payload: { activo } }, permiso: 'CONFIGURACION_ADMINISTRAR',
    }) });
  },

  async 'localhost.renombrar'(it) {
    const d = await dispositivo(h.v(it, 'dispositivo'));
    if (d.error) return d.error;
    const nombre = String(h.v(it, 'nombre') || '').trim().slice(0, 60);
    return h.msg('Esto voy a cambiar:', { plan: h.plan('localhost.renombrar', {
      titulo: `Renombrar «${d.nombre}»`, vista: [{ etiqueta: 'Nombre', valor: `«${d.nombre}» → «${nombre}»` }],
      ejecutar: { api: 'wybix.localHost.renombrar', payload: { id: d.id, nombre } }, permiso: 'CONFIGURACION_ADMINISTRAR',
    }) });
  },

  async 'localhost.revocar'(it) {
    const d = await dispositivo(h.v(it, 'dispositivo'));
    if (d.error) return d.error;
    return h.msg('Esta pantalla voy a desconectar:', { plan: h.plan('localhost.revocar', {
      titulo: `Desconectar «${d.nombre}»`, vista: [{ etiqueta: 'Pantalla', valor: d.nombre }],
      avisos: ['Para volver a usarla hay que emparejarla otra vez con su código.'],
      ejecutar: { api: 'wybix.localHost.revocar', payload: { id: d.id } }, permiso: 'CONFIGURACION_ADMINISTRAR',
    }) });
  },

  async 'localhost.funcion'(it) {
    const d = await dispositivo(h.v(it, 'dispositivo'));
    if (d.error) return d.error;
    const superficie = h.v(it, 'superficie');
    const N = { WAITER: 'Mesero', PREPARATION: 'Preparación', INVENTORY_FLOOR: 'Inventario', TECHNICIAN: 'Técnico', CUSTOMER_STATUS: 'Estado de pedidos', STAFF_DAY: 'Mi jornada' };
    let stationId = null, todas = false;
    if (superficie === 'PREPARATION') {
      const dicha = h.llano(h.v(it, 'estacionTexto') || '');
      const ests = await h.q('SELECT id, nombre FROM dbo.prep_stations WHERE activa = 1;').catch(() => []);
      const e = ests.find((x) => dicha.includes(h.llano(x.nombre)));
      if (e) stationId = e.id; else if (ests.length === 1) stationId = ests[0].id; else todas = true;
    }
    if (d.superficie === superficie && !stationId) return h.msg(`«${d.nombre}» ya es de ${N[superficie].toLowerCase()}.`);
    let config = null; try { config = d.config ? JSON.parse(d.config) : null; } catch { config = null; }
    return h.msg('Esto voy a cambiar:', { plan: h.plan('localhost.funcion', {
      titulo: `«${d.nombre}» · ${N[superficie]}`, vista: [{ etiqueta: 'Función', valor: `${N[d.superficie] || d.superficie} → ${N[superficie]}${todas ? ' (todas las estaciones)' : ''}` }],
      ejecutar: { api: 'wybix.localHost.cambiarFuncion', payload: { id: d.id, superficie, stationId, todas, config } }, permiso: 'CONFIGURACION_ADMINISTRAR',
    }) });
  },

  async 'localhost.acceso_revocar'(it) {
    const u = await h.uno('SELECT id, usuario FROM dbo.users WHERE id = @id;', [h.id(h.v(it, 'usuario'))]);
    const a = u && await h.uno('SELECT TOP 1 id FROM dbo.trabajadores_acceso WHERE user_id = @u AND revocado_en IS NULL ORDER BY id DESC;', [['u', h.sql.Int, u.id]]).catch(() => null);
    if (!a) return h.msg(`${u?.usuario || 'Esa persona'} no tiene acceso a las pantallas.`);
    return h.msg('Este acceso voy a quitar:', { plan: h.plan('localhost.acceso_revocar', {
      titulo: `Quitar a ${u.usuario} de las pantallas`, vista: [{ etiqueta: 'Acceso', valor: 'QR y PIN dejan de servir' }],
      ejecutar: { api: 'wybix.localHost.revocarTrabajador', payload: { accesoId: Number(a.id) } }, permiso: 'CONFIGURACION_ADMINISTRAR',
    }) });
  },

  /* ==================================================== MULTISUCURSAL */
  async 'multi.publicar'() {
    return h.msg('Esto voy a hacer:', { plan: h.plan('multi.publicar', {
      titulo: 'Publicar el catálogo', vista: [{ etiqueta: 'Catálogo', valor: 'productos, precios y categorías de la matriz → sucursales' }],
      avisos: ['Las sucursales lo reciben en su siguiente sincronización.'],
      ejecutar: { api: 'electronAPI.multiPublicar', args: [] }, permiso: 'CONFIGURACION_ADMINISTRAR',
    }) });
  },

  async 'multi.recibir'() {
    return h.msg('Esto voy a hacer:', { plan: h.plan('multi.recibir', {
      titulo: 'Traer el catálogo de la matriz', vista: [{ etiqueta: 'Catálogo', valor: 'se actualiza con lo que publicó la matriz' }],
      ejecutar: { api: 'electronAPI.multiRecibir', args: [] }, permiso: 'INVENTARIO_OPERAR',
    }) });
  },

  async 'multi.reglas'(it) {
    const r = await estadoMulti();
    if (r.error) return r.error;
    const regla = h.v(it, 'regla'), valor = !!h.v(it, 'valor');
    const actual = { precios_sucursal: !!r.e.reglas?.precios_sucursal, productos_locales: r.e.reglas?.productos_locales !== false };
    if (actual[regla] === valor) return h.msg('Ya está así.');
    const N = { precios_sucursal: 'Las sucursales cambian sus precios', productos_locales: 'Las sucursales tienen productos propios' };
    return h.msg('Esto voy a cambiar:', { plan: h.plan('multi.reglas', {
      titulo: 'Reglas de las sucursales', vista: [{ etiqueta: N[regla], valor: `${actual[regla] ? 'sí' : 'no'} → ${valor ? 'sí' : 'no'}` }],
      ejecutar: { api: 'electronAPI.multiReglasGuardar', payload: { ...actual, [regla]: valor } }, permiso: 'CONFIGURACION_ADMINISTRAR',
    }) });
  },

  /* «En la sucursal Centro la coca cuesta 18» / «… no se vende la coca»: las excepciones de esa sucursal con ese cambio. */
  async 'multi.excepcion'(it) {
    const r = await estadoMulti();
    if (r.error) return r.error;
    const s = sucursalDe(r.e, h.v(it, 'sucursalTexto'));
    if (!s) return h.msg(`No encuentro la sucursal «${h.v(it, 'sucursalTexto')}». Hay: ${(r.e.sucursales || []).map((x) => x.nombre).join(', ')}.`);
    const p = await h.uno('SELECT id, nombre, price, LOWER(CONVERT(VARCHAR(36), uuid)) AS uuid FROM dbo.products WHERE id = @id;', [h.id(h.v(it, 'producto'))]);
    if (!p) return h.msg('No encontré ese producto.');
    let items = [];
    try { items = await r.m.excepciones(String(s.id)); } catch { items = []; }
    const actual = items.find((x) => String(x.product_uuid).toLowerCase() === p.uuid) || { product_uuid: p.uuid, price: null, available: true };
    const nuevo = { product_uuid: p.uuid, price: h.v(it, 'precio') ?? actual.price ?? null, available: h.v(it, 'disponible') ?? actual.available !== false };
    const lista = [...items.filter((x) => String(x.product_uuid).toLowerCase() !== p.uuid).map((x) => ({ product_uuid: x.product_uuid, price: x.price, available: x.available !== false })), nuevo];
    return h.msg('Esto voy a cambiar:', { plan: h.plan('multi.excepcion', {
      titulo: `${p.nombre} en ${s.nombre}`,
      vista: h.v(it, 'precio') != null ? [{ etiqueta: 'Precio en esa sucursal', valor: `${h.dinero(actual.price ?? p.price)} → ${h.dinero(nuevo.price)}` }]
        : [{ etiqueta: 'Se vende en esa sucursal', valor: `${actual.available !== false ? 'sí' : 'no'} → ${nuevo.available ? 'sí' : 'no'}` }],
      ejecutar: { api: 'electronAPI.multiExcepcionesGuardar', payload: { locationId: String(s.id), items: lista } }, permiso: 'CONFIGURACION_ADMINISTRAR',
    }) });
  },

  async 'multi.traspaso'(it) {
    const r = await estadoMulti();
    if (r.error) return r.error;
    const s = sucursalDe(r.e, h.v(it, 'sucursalTexto'));
    if (!s) return h.msg(`No encuentro la sucursal «${h.v(it, 'sucursalTexto')}».`);
    const lineas = [];
    for (const x of h.v(it, 'renglones') || []) {
      const p = await h.uno('SELECT id, nombre, stock, LOWER(CONVERT(VARCHAR(36), uuid)) AS uuid FROM dbo.products WHERE id = @id;', [h.id(x.productId)]);
      if (p) lineas.push({ p, qty: Number(x.cantidad) });
    }
    if (!lineas.length) return h.msg('¿Qué le mandas?');
    const falta = lineas.find((l) => Number(l.p.stock) < l.qty);
    return h.msg('Este traspaso voy a mandar:', { plan: h.plan('multi.traspaso', {
      titulo: `Traspaso a ${s.nombre}`, vista: lineas.map((l) => ({ etiqueta: l.p.nombre, valor: `${h.num(l.qty)} (hay ${h.num(l.p.stock)})` })),
      avisos: [...(falta ? [`De ${falta.p.nombre} solo hay ${h.num(falta.p.stock)}.`] : []), 'Sale de tu inventario ahora; entra al de la sucursal cuando lo reciba.'],
      ejecutar: { api: 'electronAPI.multiTraspasoEnviar', payload: { toLocationId: String(s.id), toNombre: s.nombre, lineas: lineas.map((l) => ({ product_uuid: l.p.uuid, qty: l.qty })), nota: 'Desde Wybix' } },
      permiso: 'INVENTARIO_OPERAR',
    }) });
  },

  /* «Recibe el traspaso de la matriz»: lo que llegó completo (si llegó distinto, se recibe en Traspasos). */
  async 'multi.recibir_traspaso'(it) {
    const r = await estadoMulti();
    if (r.error) return r.error;
    let porRecibir = [];
    try { ({ porRecibir = [] } = await r.m.sincronizarTraspasos()); } catch (e) { return h.msg(`No pude leer los traspasos: ${e.message}`); }
    const d = h.llano(h.v(it, 'sucursalTexto') || '');
    const filtrados = d ? porRecibir.filter((x) => h.llano(x.from_nombre || '').includes(d)) : porRecibir;
    /* «De la matriz» cuando la matriz se llama distinto: si solo hay uno, es ese. */
    const xs = filtrados.length ? filtrados : porRecibir.length === 1 ? porRecibir : [];
    if (!xs.length) return h.msg('No hay traspasos por recibir.');
    if (xs.length > 1) return h.msg(`Hay ${xs.length} por recibir: ${xs.map((x) => x.from_nombre).join(', ')}. Dime de cuál.`);
    const t = xs[0];
    return h.msg('Este traspaso voy a recibir:', { plan: h.plan('multi.recibir_traspaso', {
      titulo: `Recibir traspaso de ${t.from_nombre || 'otra sucursal'}`, vista: (t.lines || []).map((l) => ({ etiqueta: l.nombre, valor: h.num(l.qty) })),
      avisos: ['Se recibe completo. Si llegó distinto, recíbelo en Traspasos con lo que de verdad llegó.'],
      ejecutar: { api: 'electronAPI.multiTraspasoRecibir', payload: { traspaso: t, recibido: {} } }, permiso: 'INVENTARIO_OPERAR',
    }) });
  },

  async 'multi.cancelar_traspaso'(it) {
    const r = await estadoMulti();
    if (r.error) return r.error;
    const s = sucursalDe(r.e, h.v(it, 'sucursalTexto'));
    if (!s) return h.msg(`No encuentro la sucursal «${h.v(it, 'sucursalTexto')}».`);
    const t = await h.uno(`SELECT TOP 1 LOWER(CONVERT(VARCHAR(36), uuid)) AS id, created_at FROM dbo.stock_transfers
                            WHERE kind = 'BRANCH_OUT' AND status = 'SENT' AND LOWER(CONVERT(VARCHAR(36), event_location_uuid)) = @s ORDER BY created_at DESC;`,
      [['s', h.sql.VarChar(36), String(s.id).toLowerCase()]]).catch(() => null);
    if (!t) return h.msg(`No hay traspaso pendiente a ${s.nombre}.`);
    return h.msg('Este traspaso voy a cancelar:', { plan: h.plan('multi.cancelar_traspaso', {
      titulo: `Cancelar traspaso a ${s.nombre}`, vista: [{ etiqueta: 'Enviado', valor: `${h.diaTexto(t.created_at)} ${h.horaTexto(t.created_at)}` }],
      avisos: ['La mercancía vuelve a tu inventario.'],
      ejecutar: { api: 'electronAPI.multiTraspasoCancelar', payload: { id: t.id } }, permiso: 'INVENTARIO_OPERAR',
    }) });
  },

  async 'multi.alcance'(it) {
    const u = await h.uno('SELECT id, usuario, CAST(corporate AS BIT) AS corporate FROM dbo.users WHERE id = @id;', [h.id(h.v(it, 'usuario'))]);
    if (!u) return h.msg('No encontré a ese usuario.');
    if (u.corporate) return h.msg(`${u.usuario} viene de la matriz: se administra allá.`);
    let scope = ['*'], texto = 'todas las sucursales';
    if (!h.v(it, 'todas')) {
      const r = await estadoMulti();
      if (r.error) return r.error;
      const s = sucursalDe(r.e, h.v(it, 'sucursalTexto'));
      if (!s) return h.msg(`No encuentro la sucursal «${h.v(it, 'sucursalTexto')}».`);
      scope = [String(s.id).toLowerCase()]; texto = s.nombre;
    }
    return h.msg('Esto voy a cambiar:', { plan: h.plan('multi.alcance', {
      titulo: `${u.usuario} · sucursales`, vista: [{ etiqueta: 'Puede entrar a', valor: texto }],
      ejecutar: { api: 'electronAPI.multiUsuarioAlcance', payload: { userId: Number(u.id), scope } }, permiso: 'CONFIGURACION_ADMINISTRAR',
    }) });
  },

  /* «Desconecta el pago de servicios»: borra proveedor y credenciales. */
  async 'servicios_pago.desconectar'() {
    return h.msg('Esto voy a hacer:', { plan: h.plan('servicios_pago.desconectar', {
      titulo: 'Desconectar pago de servicios y recargas', vista: [{ etiqueta: 'Proveedor', valor: 'se borra junto con sus credenciales' }],
      avisos: ['Para volver a usarlo hay que capturar las credenciales otra vez en su pantalla.'],
      ejecutar: { api: 'electronAPI.servicesClear', args: [] }, permiso: 'CONFIGURACION_ADMINISTRAR',
    }) });
  },
  };
};
