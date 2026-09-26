/**
 * WAITER — el mesero toma la orden en la mesa, con una tablet o un telefono
 * del negocio. Se identifica y ve el salon: sus mesas, las libres y el estado
 * de lo que ya pidio.
 *
 * NO es un segundo flujo de Hospitality: abrir mesa y enviar a preparacion
 * llaman a las MISMAS funciones que usan Touch y Venta (electron/ipc/salon.js
 * -> enviarOrden / abrirCuenta), con el mismo procedimiento, la misma
 * impresion de comandas y el mismo aviso al KDS. La Barra recibe el Latte y la
 * Cocina el Sandwich porque asi lo decide `product_prep_station`, como siempre.
 *
 * VE: mesas (de las areas que tenga permitidas este dispositivo), su estado,
 * total y comandas; el menu (nombre, precio, categoria, disponible y
 * opciones: SIN costos); la cuenta de una mesa y en que va cada cosa.
 * HACE: ABRIR_MESA, ENVIAR. Nada mas: cobrar sigue en Caja. PAY no existe
 * aqui; cuando se habilite sera una accion con su propio paquete
 * (VENTAS_OPERAR + permiso de cobro en tablet), no un boton escondido.
 *
 * Las dos acciones piden conexion: una orden encolada sin conexion llegaria a
 * cocina minutos tarde y sin que nadie lo supiera.
 */
const { negocio, prohibido, entero, decimal, texto, UUID } = require('./comun');

const MENU_MS = 30_000;

module.exports = function mesero({ hospitality }) {
  let menuCache = null;
  let menuEn = 0;

  async function menu() {
    if (menuCache && Date.now() - menuEn < MENU_MS) return menuCache;
    const r = await hospitality().leerMenu();
    if (!r.success) throw new Error(r.error || 'menu');
    const [categorias = [], productos = [], grupos = [], opciones = [], relaciones = []] = r.sets || [];
    const gruposDe = new Map();
    for (const x of relaciones) {
      if (!gruposDe.has(x.product_id)) gruposDe.set(x.product_id, []);
      gruposDe.get(x.product_id).push(x.group_id);
    }
    menuCache = {
      categorias: categorias.map(c => ({ id: c.category_id, nombre: c.category_name })),
      productos: productos.map(p => ({
        id: p.id, nombre: p.product_name, precio: Number(p.price), categoriaId: p.category_id,
        disponible: Number(p.available_units) > 0, grupos: gruposDe.get(p.id) || [],
        decimal: !!p.allow_decimal_qty,
      })),
      grupos: grupos.map(g => ({
        id: g.id, nombre: g.name, min: g.min_select, max: g.max_select, requerido: !!g.required,
        opciones: opciones.filter(o => o.group_id === g.id).map(o => ({
          id: o.id, nombre: o.name, delta: Number(o.price_delta), disponible: Number(o.available_units) > 0,
        })),
      })),
    };
    menuEn = Date.now();
    return menuCache;
  }

  const areasPermitidas = (ctx) => {
    const a = ctx.disp.config?.areas;
    return Array.isArray(a) && a.length ? new Set(a.map(Number)) : null;
  };

  async function salon(ctx) {
    const r = await hospitality().leerSalon();
    if (!r.success) throw new Error(r.error || 'salon');
    const [areas = [], mesas = []] = r.sets || [];
    const permitidas = areasPermitidas(ctx);
    const cu = await (await ctx.pool()).request()
      .query("SELECT id, abierta_por FROM dbo.hosp_cuentas WHERE estado IN ('ABIERTA', 'POR_COBRAR');");
    const duenos = new Map((cu.recordset || []).map(f => [f.id, f.abierta_por]));
    const yo = ctx.sesion.persona.userId;
    const nombreArea = new Map(areas.map(a => [a.id, a.nombre]));
    const visibles = mesas.filter(m => !permitidas || permitidas.has(Number(m.area_id)));
    return {
      areas: areas.filter(a => !permitidas || permitidas.has(Number(a.id))).map(a => ({ id: a.id, nombre: a.nombre })),
      mesas: visibles.map(m => ({
        id: m.id, nombre: m.nombre, areaId: m.area_id, area: nombreArea.get(m.area_id) || null,
        estado: m.estado, cuentaId: m.cuenta_id || null,
        total: Number(m.total || 0), lineas: Number(m.lineas || 0),
        pendientes: Number(m.comandas_pendientes || 0), listas: Number(m.comandas_listas || 0),
        minutos: m.minutos ?? null,
        mia: m.cuenta_id != null && duenos.get(m.cuenta_id) === yo,
      })),
    };
  }

  async function mesaVisible(ctx, { mesaId = null, cuentaId = null }) {
    const s = await salon(ctx);
    const m = s.mesas.find(x => (mesaId && x.id === mesaId) || (cuentaId && x.cuentaId === cuentaId));
    if (!m) throw prohibido('Esa mesa no está en tus áreas.');
    return m;
  }

  return {
    tipo: 'WAITER',
    familia: 'TRABAJADOR',
    nombre: 'Mesero',
    descripcion: 'Tomar órdenes en la mesa y enviarlas a preparación',
    icono: 'fork-knife',
    identidad: 'TRABAJADOR',
    paquetes: ['VENTAS_OPERAR'],
    sesion: { inactividadMin: 60 },
    sonido: 'Cuando algo de tus mesas está listo para servir',
    fuentes: ['cuentas', 'comandas'],
    disponible: (c) => c.mesas,

    async estado(ctx) {
      const s = await salon(ctx);
      const mias = s.mesas.filter(m => m.mia);
      const siguiente = mias.find(m => m.listas > 0) || mias.sort((a, b) => (b.minutos ?? 0) - (a.minutos ?? 0))[0] || null;
      return {
        ...s,
        puedeCobrar: false,
        reposo: {
          asignadas: mias.length,
          ocupadas: s.mesas.filter(m => m.estado !== 'LIBRE').length,
          libres: s.mesas.filter(m => m.estado === 'LIBRE').length,
          siguiente: siguiente ? { mesaId: siguiente.id, nombre: siguiente.nombre, listas: siguiente.listas } : null,
        },
      };
    },

    consultas: {
      menu: () => menu(),
      async cuenta(ctx, q) {
        const cuentaId = entero(q.id);
        if (!cuentaId) throw negocio('Falta la cuenta.', { http: 400 });
        await mesaVisible(ctx, { cuentaId });
        const r = await hospitality().leerCuenta(cuentaId);
        if (!r.success) throw negocio(r.error || 'No se pudo leer la cuenta.');
        const [cab = [], lineas = [], opciones = []] = r.sets || [];
        const c = cab[0];
        if (!c) throw negocio('Esa cuenta ya no existe.', { http: 404 });
        /* Lo cancelado no se cobra ni se muestra como pendiente. */
        const ls = lineas.filter(l => l.estado !== 'CANCELADA').map(l => {
          const ops = opciones.filter(o => o.linea_id === l.id);
          const precio = Number(l.precio_unitario) + ops.reduce((t, o) => t + Number(o.price_delta) * Number(o.quantity), 0);
          return {
            id: l.id, nombre: l.nombre, cantidad: Number(l.cantidad), nota: l.nota || null,
            opciones: ops.map(o => (o.quantity > 1 ? `${o.quantity}× ` : '') + o.option_name),
            importe: Math.round(precio * Number(l.cantidad) * 100) / 100,
            prep: l.comanda_estado || null, estacion: l.estacion || null,
          };
        });
        return {
          cuenta: { id: c.id, titulo: c.titulo, area: c.area, minutos: c.minutos, estado: c.estado ?? null },
          lineas: ls,
          total: Math.round(ls.reduce((t, l) => t + l.importe, 0) * 100) / 100,
        };
      },
    },

    acciones: {
      ABRIR_MESA: {
        modo: 'ONLINE_REQUIRED',
        async ejecutar(ctx, d) {
          const mesaId = entero(d?.mesaId);
          if (!mesaId) throw negocio('Falta la mesa.', { http: 400 });
          await mesaVisible(ctx, { mesaId });
          const r = await hospitality().abrirCuenta({ mesaId }, ctx.sesion.persona.userId);
          if (!r.success) throw negocio(r.error);
          const cuentaId = r.data?.[0]?.id;
          return { mesaId, cuentaId, auditoria: { entidad: 'MESA', entidadId: mesaId, detalle: `cuenta ${cuentaId}` } };
        },
      },
      ENVIAR: {
        modo: 'ONLINE_REQUIRED',
        async ejecutar(ctx, d) {
          const cuentaId = entero(d?.cuentaId);
          const entrada = Array.isArray(d?.lineas) ? d.lineas : [];
          if (!cuentaId || !entrada.length || entrada.length > 60) throw negocio('No hay nada que enviar.', { http: 400 });
          const mesa = await mesaVisible(ctx, { cuentaId });
          const m = await menu();
          const prods = new Map(m.productos.map(p => [p.id, p]));
          const grupos = new Map(m.grupos.map(g => [g.id, g]));

          /* Lo mismo que valida la caja, del lado del servidor: el producto
             existe y se vende, las opciones son de SUS grupos, y los grupos
             obligatorios estan. El precio lo pone la base, no la tablet. */
          const lineas = entrada.map((l) => {
            const p = prods.get(entero(l?.productId));
            if (!p) throw negocio('Uno de los productos ya no está en el menú.');
            const cantidad = decimal(l?.cantidad, { min: 0.01, max: 99 });
            if (!cantidad || (!p.decimal && !Number.isInteger(cantidad))) throw negocio(`Revisa la cantidad de ${p.nombre}.`, { http: 400 });
            if (!UUID.test(String(l?.origen || ''))) throw negocio('Falta el identificador de la línea.', { http: 400 });
            const ops = Array.isArray(l?.opciones) ? l.opciones : [];
            const porGrupo = new Map();
            const opciones = ops.map((o) => {
              const id = entero(o?.optionId);
              const g = p.grupos.map(x => grupos.get(x)).find(x => x?.opciones.some(y => y.id === id));
              if (!g) throw negocio(`Una opción no corresponde a ${p.nombre}.`, { http: 400 });
              const quantity = entero(o?.quantity ?? 1, { min: 1, max: 20 }) || 1;
              porGrupo.set(g.id, (porGrupo.get(g.id) || 0) + quantity);
              return { optionId: id, quantity };
            });
            for (const gid of p.grupos) {
              const g = grupos.get(gid);
              const n = porGrupo.get(gid) || 0;
              if (g && (g.requerido || g.min > 0) && n < Math.max(1, g.min || 0)) throw negocio(`${p.nombre}: falta elegir ${g.nombre}.`, { http: 400 });
              if (g && g.max > 0 && n > g.max) throw negocio(`${p.nombre}: demasiadas opciones en ${g.nombre}.`, { http: 400 });
            }
            return { productId: p.id, cantidad, nota: texto(l?.nota, 200), opciones, origen: String(l.origen) };
          });

          const r = await hospitality().enviarOrden({ cuentaId, lineas }, ctx.sesion.persona.userId);
          if (!r.success) throw negocio(r.error);
          ctx.avisarCambio?.();
          const comandas = (r.data?.comandas || []).map(k => ({ id: k.id, estacion: k.estacion }));
          return {
            cuentaId, comandas,
            auditoria: { entidad: 'MESA', entidadId: mesa.id, detalle: `${lineas.length} línea(s) a ${comandas.map(k => k.estacion).join(', ') || 'sin estación'}` },
          };
        },
      },
    },

    async evento(cambio, ctx) {
      if (cambio.fuente === 'cuentas') return { tipo: 'TABLE_UPDATED', id: cambio.fila.mesa_id || cambio.fila.id };
      if (cambio.fuente !== 'comandas') return null;
      /* Listo para servir, en una mesa MIA: eso si suena. */
      if (cambio.fila.estado === 'LISTA' && cambio.anterior !== 'LISTA') {
        const dueno = await cambio.duenoCuenta();
        if (dueno != null && dueno === ctx.sesion?.persona?.userId) {
          return { tipo: 'ORDER_READY', id: cambio.fila.cuenta_id, sonar: true };
        }
      }
      return { tipo: 'ORDER_UPDATED', id: cambio.fila.cuenta_id };
    },
  };
};
