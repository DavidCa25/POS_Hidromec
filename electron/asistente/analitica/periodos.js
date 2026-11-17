'use strict';
/**
 * PERIODOS COMO FECHAS: «la semana pasada», «en octubre», «del 1 al 15» →
 * { desde, hasta } en hora local, con el periodo anterior equivalente para
 * comparar. Los mismos cortes que RANGOS (acciones/index.js), pero en JS:
 * el cubo los recibe como parámetros.
 *
 * Las fechas son texto 'AAAA-MM-DDT00:00:00' (local): SQL las compara contra
 * `datee`, que también se guarda en hora local.
 */
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const DIAS_PLURAL = ['domingos', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábados'];

const pad = (n) => String(n).padStart(2, '0');
const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const isoT = (d) => `${iso(d)}T00:00:00`;
const dia0 = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const mas = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const masMeses = (d, n) => new Date(d.getFullYear(), d.getMonth() + n, Math.min(d.getDate(), 28));
const deIso = (s) => { const [y, m, dd] = String(s).slice(0, 10).split('-').map(Number); return new Date(y, m - 1, dd); };

/** Un rango a mano: { desde: Date, hasta: Date (exclusiva), nombre, de, contra } + el anterior de la misma duración. */
function armar(desde, hasta, textos, antes = null) {
  const dias = Math.round((hasta - desde) / 86_400_000);
  const [ad, ah] = antes || [mas(desde, -dias), desde];
  return { desde: isoT(desde), hasta: isoT(hasta), antesDesde: isoT(ad), antesHasta: isoT(ah), dias, ...textos };
}

/**
 * @param periodo  clave (hoy · ayer · semana · semana_pasada · mes · mes_pasado · anio)
 *                 o { desde: 'AAAA-MM-DD', hasta: 'AAAA-MM-DD' (exclusiva), nombre }
 */
function rangoFechas(periodo, ahora = new Date()) {
  const hoy = dia0(ahora);
  if (periodo && typeof periodo === 'object') {
    const d = deIso(periodo.desde), h = deIso(periodo.hasta);
    return armar(d, h, { nombre: periodo.nombre || 'En ese periodo', de: periodo.de || 'de ese periodo', contra: periodo.contra || 'el periodo anterior' },
      periodo.mes ? [new Date(d.getFullYear(), d.getMonth() - 1, 1), d] : null);
  }
  const iniMes = new Date(hoy.getFullYear(), hoy.getMonth(), 1);
  switch (periodo) {
    case 'ayer': return armar(mas(hoy, -1), hoy, { nombre: 'Ayer', de: 'de ayer', contra: 'el mismo día de la semana anterior' }, [mas(hoy, -8), mas(hoy, -7)]);
    case 'semana': return armar(mas(hoy, -6), mas(hoy, 1), { nombre: 'En los últimos 7 días', de: 'de los últimos 7 días', contra: 'los 7 días anteriores' });
    case 'semana_pasada': return armar(mas(hoy, -13), mas(hoy, -6), { nombre: 'La semana pasada', de: 'de la semana pasada', contra: 'la semana anterior' });
    case 'mes': return armar(iniMes, mas(hoy, 1), { nombre: 'Este mes', de: 'del mes', contra: 'el mes pasado a la misma fecha' },
      [new Date(hoy.getFullYear(), hoy.getMonth() - 1, 1), mas(masMeses(hoy, -1), 1)]);
    case 'mes_pasado': return armar(new Date(hoy.getFullYear(), hoy.getMonth() - 1, 1), iniMes, { nombre: 'El mes pasado', de: 'del mes pasado', contra: 'el mes anterior' },
      [new Date(hoy.getFullYear(), hoy.getMonth() - 2, 1), new Date(hoy.getFullYear(), hoy.getMonth() - 1, 1)]);
    case 'anio': return armar(new Date(hoy.getFullYear(), 0, 1), mas(hoy, 1), { nombre: 'En el año', de: 'del año', contra: 'el año pasado a la misma fecha' },
      [new Date(hoy.getFullYear() - 1, 0, 1), mas(new Date(hoy.getFullYear() - 1, hoy.getMonth(), hoy.getDate()), 1)]);
    default: return armar(hoy, mas(hoy, 1), { nombre: 'Hoy', de: 'de hoy', contra: 'el mismo día de la semana pasada' }, [mas(hoy, -7), mas(hoy, -6)]);
  }
}

module.exports = { rangoFechas, MESES, DIAS, DIAS_PLURAL, iso, isoT, deIso, mas, dia0 };
