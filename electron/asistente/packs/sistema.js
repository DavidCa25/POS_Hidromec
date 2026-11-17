'use strict';
/**
 * EL DOCTOR TÉCNICO: el equipo, no el negocio. Respaldo, nube, licencia,
 * reloj, impresora y disco. Mismo motor y mismo contrato que las reglas del
 * negocio; dominio `sistema`. Nada de esto actúa solo: dice qué pasa y lleva
 * a la pantalla donde se arregla.
 *
 * El sensor `sistema` lo arma el proceso principal (electron/asistente/index.js).
 */
const { fechaCorta } = require('../formato');

const DIA = 86_400_000;
const ir = (etiqueta, ruta) => ({ etiqueta, intent: 'ir_a', params: { ruta }, principal: true });

const reglas = [
  {
    id: 'sistema.respaldo', version: 1, dominio: 'sistema', severidad: 'importante', verPermiso: 'CONFIGURACION_ADMINISTRAR',
    sensores: ['sistema'], umbrales: { dias: { def: 2, min: 1, max: 30 } },
    evaluar({ sistema }, u, ctx) {
      const r = sistema.respaldo;
      if (!r || r.activo === false) return [{ entidad: { tipo: 'sistema', id: 'respaldo' }, severidad: 'importante',
        titulo: 'Los respaldos automáticos están apagados', detalle: 'Si la computadora falla, se pierde todo lo que no esté respaldado.',
        evidencia: [], acciones: [ir('Encender respaldos', '/dashboard/configuracion')] }];
      if (r.estado === 'error') return [{ entidad: { tipo: 'sistema', id: 'respaldo' }, severidad: 'critico',
        titulo: 'El último respaldo falló', detalle: r.error || 'No se pudo guardar la copia de seguridad.',
        evidencia: r.ultimo ? [{ etiqueta: 'Último bueno', valor: fechaCorta(r.ultimo) }] : [], acciones: [ir('Ver respaldos', '/dashboard/configuracion')] }];
      const t = Date.parse(r.ultimo || '');
      if (!t || ctx.ahora - t > u.dias * DIA) return [{ entidad: { tipo: 'sistema', id: 'respaldo' },
        titulo: t ? `Sin respaldo desde el ${fechaCorta(r.ultimo)}` : 'Todavía no hay ningún respaldo',
        detalle: 'Respaldar a diario es lo que te salva si la computadora se descompone.',
        evidencia: [], acciones: [ir('Ver respaldos', '/dashboard/configuracion')] }];
      return [];
    },
  },
  {
    id: 'sistema.nube', version: 1, dominio: 'sistema', severidad: 'aviso', verPermiso: 'CONFIGURACION_ADMINISTRAR',
    sensores: ['sistema'], umbrales: { horas: { def: 6, min: 1, max: 72 } },
    evaluar({ sistema }, u, ctx) {
      const n = sistema.nube;
      if (!n || !n.activa || !n.pendientes) return [];
      const t = Date.parse(n.masViejo || '');
      if (!t || ctx.ahora - t < u.horas * 3_600_000) return [];
      return [{ entidad: { tipo: 'sistema', id: 'nube' },
        titulo: 'La app del dueño no está al día',
        detalle: `Hay ${n.pendientes} movimiento${n.pendientes === 1 ? '' : 's'} sin subir desde el ${fechaCorta(n.masViejo)}. Revisa el Internet de esta caja.`,
        evidencia: n.error ? [{ etiqueta: 'Último error', valor: String(n.error).slice(0, 120) }] : [],
        acciones: [ir('Ver sincronización', '/dashboard/configuracion')] }];
    },
  },
  {
    id: 'sistema.licencia', version: 1, dominio: 'sistema', severidad: 'importante',
    sensores: ['sistema'],
    evaluar({ sistema }) {
      const l = sistema.licencia;
      if (!l) return [];
      const ent = { tipo: 'sistema', id: 'licencia' };
      const acc = [ir('Ver licencia', '/dashboard/configuracion')];
      if (l.modo === 'SALE_ONLY') return [{ entidad: ent, severidad: 'critico', titulo: 'Tu suscripción venció',
        detalle: 'Wybix sigue vendiendo, pero lo avanzado espera a la renovación.', evidencia: [], acciones: acc }];
      if (l.modo === 'GRACE') return [{ entidad: ent, titulo: 'Tu suscripción venció: estás en periodo de gracia',
        detalle: l.dias ? `Te quedan ${l.dias} días con todo funcionando.` : 'Renueva para no perder funciones.', evidencia: [], acciones: acc }];
      if (l.modo === 'TRIAL' && l.dias != null && l.dias <= 5) return [{ entidad: ent, severidad: 'aviso',
        titulo: `Tu prueba termina en ${l.dias} día${l.dias === 1 ? '' : 's'}`, detalle: 'Activa tu licencia para seguir sin interrupciones.', evidencia: [], acciones: acc }];
      return [];
    },
  },
  {
    id: 'sistema.reloj', version: 1, dominio: 'sistema', severidad: 'importante',
    sensores: ['sistema'],
    evaluar({ sistema }) {
      if (!sistema.licencia?.relojAtrasado) return [];
      return [{ entidad: { tipo: 'sistema', id: 'reloj' }, titulo: 'La hora de esta computadora está mal',
        detalle: 'Las ventas, los cortes y las facturas quedan con la fecha equivocada. Ajusta la fecha y hora de Windows.',
        evidencia: [], acciones: [] }];
    },
  },
  {
    id: 'sistema.impresora', version: 1, dominio: 'sistema', severidad: 'aviso', verPermiso: 'CONFIGURACION_EQUIPO',
    sensores: ['sistema'],
    evaluar({ sistema }) {
      if (sistema.impresora?.configurada !== false) return [];
      return [{ entidad: { tipo: 'sistema', id: 'impresora' }, titulo: 'No hay impresora de tickets configurada',
        detalle: 'Los tickets no se van a imprimir hasta que elijas la impresora.', evidencia: [],
        acciones: [ir('Configurar impresora', '/dashboard/configuracion')] }];
    },
  },
  {
    id: 'sistema.disco', version: 1, dominio: 'sistema', severidad: 'importante',
    sensores: ['sistema'], umbrales: { gb: { def: 5, min: 1, max: 100 } },
    evaluar({ sistema }, u) {
      const g = sistema.disco?.libreGB;
      if (g == null || g >= u.gb) return [];
      return [{ entidad: { tipo: 'sistema', id: 'disco' }, severidad: g < 2 ? 'critico' : 'importante',
        titulo: `Queda poco espacio en el disco (${g.toFixed(1)} GB)`,
        detalle: 'Sin espacio, los respaldos y la base de datos pueden fallar. Libera espacio o mueve los respaldos a otra unidad.',
        evidencia: [], acciones: [] }];
    },
  },
];

module.exports = { id: 'sistema', reglas };
