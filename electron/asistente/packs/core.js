'use strict';
/**
 * PACK CORE: lo que vale para cualquier giro (inventario, costos, compras,
 * caja, calidad de datos). Las reglas solo leen hechos de los sensores y
 * devuelven hallazgos con su evidencia; los textos son plantillas con los
 * números reales, nunca texto generado.
 */
const { dinero, cant, fechaCorta, mes } = require('../formato');

const ir = (etiqueta, ruta, principal = false) => ({ etiqueta, intent: 'ir_a', params: { ruta }, principal });

const reglas = [
  {
    id: 'core.inventario.agotado', version: 1, dominio: 'inventario', severidad: 'critico',
    sensores: ['reorden'], ruta: '/dashboard/registrarCompra',
    supera: ['core.inventario.se_acaba'],
    evaluar({ reorden }) {
      return reorden.filter((x) => x.dias <= 0 && x.promDiario > 0 && x.modo === 'DIRECT').map((x) => ({
        entidad: { tipo: 'producto', id: x.id, nombre: x.nombre },
        titulo: `Se acabó ${x.nombre}`,
        detalle: `Vendes unos ${cant(x.promDiario, x.uom)} al día y ya no hay existencia.`,
        evidencia: [{ etiqueta: 'Existencia', valor: cant(x.stock, x.uom) }, { etiqueta: 'Vendes al día', valor: cant(x.promDiario, x.uom) },
                    ...(x.sugerido ? [{ etiqueta: 'Comprar para 30 días', valor: cant(x.sugerido, x.uom) }] : [])],
        acciones: [ir('Registrar compra', '/dashboard/registrarCompra', true)],
      }));
    },
  },
  {
    id: 'core.inventario.se_acaba', version: 1, dominio: 'inventario', severidad: 'importante',
    sensores: ['reorden'], umbrales: { dias: { def: 3, min: 1, max: 14 } },
    evaluar({ reorden }, u) {
      return reorden.filter((x) => x.dias > 0 && x.dias <= u.dias).map((x) => {
        const quien = x.limita ? `${x.limita.nombre} (para ${x.nombre})` : x.nombre;
        return {
          entidad: { tipo: 'producto', id: x.limita ? `ing:${x.limita.nombre}` : x.id, nombre: quien },
          severidad: x.dias <= 1 ? 'critico' : 'importante',
          titulo: x.dias <= 1 ? `Mañana te quedas sin ${quien}` : `${quien} se acaba en ${x.dias} días`,
          detalle: x.limita
            ? `Con lo que hay de ${x.limita.nombre} alcanzan ${cant(x.stock, 'pza')} de ${x.nombre}; vendes unas ${cant(x.promDiario, 'pza')} al día.`
            : `Quedan ${cant(x.stock, x.uom)} y vendes unos ${cant(x.promDiario, x.uom)} al día.`,
          evidencia: [{ etiqueta: 'Quedan', valor: cant(x.stock, x.uom) }, { etiqueta: 'Al día', valor: cant(x.promDiario, x.uom) },
                      ...(x.sugerido ? [{ etiqueta: 'Comprar para 30 días', valor: cant(x.sugerido, x.uom) }] : [])],
          acciones: [ir('Registrar compra', '/dashboard/registrarCompra', true)],
        };
      });
    },
  },
  {
    id: 'core.inventario.sin_movimiento', version: 1, dominio: 'inventario', severidad: 'aviso',
    sensores: ['sinMovimiento'], umbrales: { dias: { def: 60, min: 15, max: 365 } },
    evaluar({ sinMovimiento }, u, ctx) {
      const limite = ctx.ahora - u.dias * 86_400_000;
      const dormidos = sinMovimiento.filter((x) => {
        const ref = Date.parse(x.ultimaVenta || x.alta || '') || 0;
        return ref && ref < limite;
      }).sort((a, b) => b.stock * b.costo - a.stock * a.costo);
      if (!dormidos.length) return [];
      const valor = dormidos.reduce((a, x) => a + x.stock * x.costo, 0);
      return [{
        periodo: mes(ctx.ahora), impacto: valor / 10,
        titulo: `${dormidos.length} producto${dormidos.length === 1 ? '' : 's'} sin venderse en ${u.dias} días`,
        detalle: valor > 0 ? `Tienes ${dinero(valor)} de inventario parado. Una oferta o un combo los mueve.` : 'Están ocupando lugar sin venderse.',
        evidencia: dormidos.slice(0, 5).map((x) => ({ etiqueta: x.nombre, valor: `${cant(x.stock, 'pza')}${x.ultimaVenta ? ` · última ${fechaCorta(x.ultimaVenta)}` : ' · nunca vendido'}` })),
        acciones: [ir('Crear una oferta', '/dashboard/inventario/ofertas', true), ir('Ver inventario', '/dashboard/inventario')],
      }];
    },
  },
  {
    id: 'core.costos.precio_bajo_costo', version: 1, dominio: 'costos', severidad: 'critico', verPermiso: 'VER_COSTOS',
    sensores: ['margenes'], supera: ['core.costos.margen_bajo', 'hosp.receta.costo_alto'],
    evaluar({ margenes }) {
      return margenes.filter((x) => x.ganancia != null && x.ganancia < 0).map((x) => ({
        entidad: { tipo: 'producto', id: x.id, nombre: x.nombre },
        impacto: Math.abs(x.ganancia) * Math.max(1, x.vendidos30),
        titulo: `${x.nombre} se vende con pérdida`,
        detalle: `Cuesta ${dinero(x.costo)} y lo vendes en ${dinero(x.base)} sin IVA: pierdes ${dinero(-x.ganancia)} en cada uno.`,
        evidencia: [{ etiqueta: 'Precio final', valor: dinero(x.precio) }, { etiqueta: 'Sin IVA', valor: dinero(x.base) },
                    { etiqueta: 'Costo', valor: dinero(x.costo) }, { etiqueta: 'Vendidos en 30 días', valor: String(x.vendidos30) }],
        acciones: [{ etiqueta: 'Cambiar el precio', intent: 'producto.precio', params: { productId: x.id, nombre: x.nombre }, principal: true }],
      }));
    },
  },
  {
    id: 'core.costos.margen_bajo', version: 1, dominio: 'costos', severidad: 'aviso', verPermiso: 'VER_COSTOS',
    sensores: ['margenes'], umbrales: { pctMinimo: { def: 30, min: 0, max: 300 } },
    evaluar({ margenes }, u) {
      return margenes.filter((x) => x.pctSobreCosto != null && x.pctSobreCosto >= 0 && x.pctSobreCosto < u.pctMinimo && x.vendidos30 > 0)
        .map((x) => {
          const sugerido = Math.ceil(x.costo * (1 + u.pctMinimo / 100) * (1 + x.tasa));
          return {
            entidad: { tipo: 'producto', id: x.id, nombre: x.nombre },
            impacto: (x.costo * u.pctMinimo / 100 - x.ganancia) * x.vendidos30,
            titulo: `${x.nombre} deja poca ganancia`,
            detalle: `Ganas ${x.pctSobreCosto}% sobre el costo y tu mínimo es ${u.pctMinimo}%. Para llegar, el precio sería ${dinero(sugerido)}.`,
            evidencia: [{ etiqueta: 'Precio final', valor: dinero(x.precio) }, { etiqueta: 'Costo', valor: dinero(x.costo) },
                        { etiqueta: 'Ganancia', valor: `${dinero(x.ganancia)} · ${x.pctSobreCosto}%` }, { etiqueta: 'Precio sugerido', valor: dinero(sugerido) }],
            acciones: [{ etiqueta: `Subir a ${dinero(sugerido)}`, intent: 'producto.precio', params: { productId: x.id, nombre: x.nombre, precio: sugerido }, principal: true }],
          };
        });
    },
  },
  {
    id: 'core.datos.sin_costo', version: 1, dominio: 'datos', severidad: 'aviso', verPermiso: 'VER_COSTOS',
    sensores: ['margenes'],
    evaluar({ margenes }, _u, ctx) {
      const sin = margenes.filter((x) => x.costo == null && x.modo === 'DIRECT' && x.vendidos30 > 0)
        .sort((a, b) => b.vendidos30 - a.vendidos30);
      if (!sin.length) return [];
      return [{
        periodo: mes(ctx.ahora),
        titulo: `${sin.length} producto${sin.length === 1 ? '' : 's'} que vendes no tiene${sin.length === 1 ? '' : 'n'} costo`,
        detalle: 'Sin costo no puedo decirte cuánto ganas con ellos. Se llena solo al registrar su compra.',
        evidencia: sin.slice(0, 5).map((x) => ({ etiqueta: x.nombre, valor: `${x.vendidos30} vendidos en 30 días` })),
        acciones: [ir('Registrar una compra', '/dashboard/registrarCompra', true)],
      }];
    },
  },
  {
    id: 'core.compras.costo_subio', version: 1, dominio: 'compras', severidad: 'importante', verPermiso: 'VER_COSTOS',
    sensores: ['compras'], umbrales: { pctSubida: { def: 8, min: 1, max: 100 } },
    evaluar({ compras }, u) {
      return compras.filter((x) => x.vendible && x.costoAnterior > 0 && x.costoUltima > x.costoAnterior * (1 + u.pctSubida / 100) && x.precio > 0)
        .map((x) => {
          const base = x.precio / (1 + x.tasa);
          const pctAntes = x.costoAnterior > 0 ? (base / x.costoAnterior - 1) : 0;
          const sugerido = Math.ceil(x.costoUltima * (1 + pctAntes) * (1 + x.tasa));
          const subio = Math.round((x.costoUltima / x.costoAnterior - 1) * 100);
          if (sugerido <= x.precio) return null;
          return {
            entidad: { tipo: 'producto', id: x.id, nombre: x.nombre }, periodo: (x.fecha || '').slice(0, 10),
            titulo: `${x.nombre} te costó ${subio}% más`,
            detalle: `Pasó de ${dinero(x.costoAnterior)} a ${dinero(x.costoUltima)}. Para ganar lo mismo que antes, el precio sería ${dinero(sugerido)}.`,
            evidencia: [{ etiqueta: 'Costo anterior', valor: dinero(x.costoAnterior) }, { etiqueta: 'Costo nuevo', valor: dinero(x.costoUltima) },
                        { etiqueta: 'Precio hoy', valor: dinero(x.precio) }, { etiqueta: 'Precio sugerido', valor: dinero(sugerido) }],
            acciones: [{ etiqueta: `Subir a ${dinero(sugerido)}`, intent: 'producto.precio', params: { productId: x.id, nombre: x.nombre, precio: sugerido }, principal: true }],
          };
        }).filter(Boolean);
    },
  },
  {
    id: 'core.caja.descuadres', version: 1, dominio: 'caja', severidad: 'importante', verPermiso: 'VER_NUMEROS_DIA',
    sensores: ['cortes'], umbrales: { minimo: { def: 20, min: 1, max: 5000 }, veces: { def: 2, min: 1, max: 10 } },
    evaluar({ cortes }, u, ctx) {
      const malos = cortes.filter((c) => Math.abs(c.diferencia) >= u.minimo);
      if (malos.length < u.veces) return [];
      const neto = malos.reduce((a, c) => a + c.diferencia, 0);
      return [{
        periodo: mes(ctx.ahora), impacto: Math.abs(neto),
        titulo: `${malos.length} cortes descuadrados en 2 semanas`,
        detalle: `${neto < 0 ? 'Faltaron' : 'Sobraron'} ${dinero(Math.abs(neto))} en total. Revisa retiros, devoluciones y aperturas de cajón sin venta.`,
        evidencia: malos.slice(0, 5).map((c) => ({ etiqueta: `${fechaCorta(c.fecha)}${c.usuario ? ' · ' + c.usuario : ''}`, valor: dinero(c.diferencia) })),
        acciones: [ir('Ver cierre del día', '/dashboard/cierre-dia', true)],
      }];
    },
  },
];

module.exports = { id: 'core', reglas };
