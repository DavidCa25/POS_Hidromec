'use strict';
/**
 * PACK HOSPITALITY: cafeterías, restaurantes, panaderías. Se activa con la
 * capacidad `hospitality` (la misma que enciende recetas y producción). No
 * cambia ninguna regla de core: agrega las suyas.
 */
const { dinero, cant, mes } = require('../formato');

const reglas = [
  {
    /* «Food cost»: qué parte del precio sin IVA se va en ingredientes. */
    id: 'hosp.receta.costo_alto', version: 1, dominio: 'costos', severidad: 'aviso', verPermiso: 'VER_COSTOS',
    requiere: { capacidades: ['hospitality'] },
    sensores: ['margenes'], umbrales: { pctMaximo: { def: 40, min: 10, max: 90 } },
    supera: ['core.costos.margen_bajo'],
    evaluar({ margenes }, u) {
      return margenes.filter((x) => x.modo === 'RECIPE' && x.costo != null && x.base > 0 && x.ingredientesSinCosto === 0)
        .map((x) => ({ x, pct: Math.round((x.costo / x.base) * 1000) / 10 }))
        .filter(({ pct, x }) => pct > u.pctMaximo && pct < 100 && x.vendidos30 > 0)
        .map(({ x, pct }) => {
          const sugerido = Math.ceil((x.costo / (u.pctMaximo / 100)) * (1 + x.tasa));
          return {
            entidad: { tipo: 'producto', id: x.id, nombre: x.nombre },
            severidad: pct > u.pctMaximo + 15 ? 'importante' : 'aviso',
            impacto: (x.costo - x.base * u.pctMaximo / 100) * x.vendidos30,
            titulo: `Los ingredientes de ${x.nombre} se comen ${pct}% del precio`,
            detalle: `La receta cuesta ${dinero(x.costo)} y el precio sin IVA es ${dinero(x.base)}. Tu tope es ${u.pctMaximo}%: el precio sería ${dinero(sugerido)} o la receta más barata.`,
            evidencia: [{ etiqueta: 'Costo de la receta', valor: dinero(x.costo) }, { etiqueta: 'Precio sin IVA', valor: dinero(x.base) },
                        { etiqueta: 'Ingredientes', valor: `${pct}%` }, { etiqueta: 'Precio sugerido', valor: dinero(sugerido) }],
            acciones: [{ etiqueta: `Subir a ${dinero(sugerido)}`, intent: 'producto.precio', params: { productId: x.id, nombre: x.nombre, precio: sugerido }, principal: true },
                       { etiqueta: 'Ver la receta', intent: 'ir_a', params: { ruta: '/dashboard/recetas' } }],
          };
        });
    },
  },
  {
    id: 'hosp.receta.sin_costo', version: 1, dominio: 'datos', severidad: 'aviso', verPermiso: 'VER_COSTOS',
    requiere: { capacidades: ['hospitality'] },
    sensores: ['margenes'],
    evaluar({ margenes }, _u, ctx) {
      const sin = margenes.filter((x) => x.modo === 'RECIPE' && x.ingredientesSinCosto > 0 && x.vendidos30 > 0);
      if (!sin.length) return [];
      return [{
        periodo: mes(ctx.ahora),
        titulo: `${sin.length} receta${sin.length === 1 ? '' : 's'} con ingredientes sin costo`,
        detalle: 'No puedo calcular cuánto te cuestan. Registra la compra de esos ingredientes y el costo se llena solo.',
        evidencia: sin.slice(0, 5).map((x) => ({ etiqueta: x.nombre, valor: `${x.ingredientesSinCosto} ingrediente${x.ingredientesSinCosto === 1 ? '' : 's'} sin costo` })),
        acciones: [{ etiqueta: 'Ver recetas', intent: 'ir_a', params: { ruta: '/dashboard/recetas' }, principal: true }],
      }];
    },
  },
  {
    id: 'hosp.produccion.faltantes', version: 1, dominio: 'produccion', severidad: 'critico',
    requiere: { capacidades: ['hospitality'] },
    sensores: ['produccion'],
    evaluar({ produccion }, _u, ctx) {
      if (!produccion.planeadas || !produccion.faltan.length) return [];
      return [{
        periodo: new Date(ctx.ahora).toISOString().slice(0, 10),
        titulo: `No alcanza para la producción de hoy`,
        detalle: `Faltan ${produccion.faltan.length} ingrediente${produccion.faltan.length === 1 ? '' : 's'} para las ${produccion.planeadas} tanda${produccion.planeadas === 1 ? '' : 's'} planeada${produccion.planeadas === 1 ? '' : 's'}.`,
        evidencia: produccion.faltan.slice(0, 6).map((f) => ({ etiqueta: f.nombre, valor: `faltan ${cant(f.falta, f.uom)} (hay ${cant(f.hay, f.uom)})` })),
        acciones: [{ etiqueta: 'Registrar compra', intent: 'ir_a', params: { ruta: '/dashboard/registrarCompra' }, principal: true },
                   { etiqueta: 'Ver producción', intent: 'ir_a', params: { ruta: '/dashboard/produccion' } }],
      }];
    },
  },
];

module.exports = { id: 'hospitality', reglas };
