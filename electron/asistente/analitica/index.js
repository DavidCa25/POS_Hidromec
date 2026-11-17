'use strict';
/**
 * LA ANALÍTICA DE WYBIX: lo que hace que conteste preguntas que ningún intent
 * tiene escritas.
 *
 *   cubo.js        pregunta con filtros combinados → un SQL
 *   periodos.js    «la semana pasada», «en octubre» → fechas
 *   explicar.js    «¿por qué?»: clientes contra gasto, y dónde se concentró
 *   pronostico.js  cuánto se espera vender; cuándo se acaba algo
 *   simular.js     «¿y si subo el precio?»
 *
 * Las respuestas en palabras están en acciones/analisis.js; aquí solo números.
 */
const { crearCubo } = require('./cubo');
const { rangoFechas, iso, mas, dia0, isoT } = require('./periodos');
/* 'AAAA-MM-DD' o 'AAAA-MM-DDTHH:MM:SS' → fecha local a medianoche. */
const deIsoT = (s) => { const [y, m, d] = String(s).slice(0, 10).split('-').map(Number); return new Date(y, m - 1, d); };
const { explicar } = require('./explicar');
const { pronosticoDia, agotamiento, rellenar } = require('./pronostico');
const { simularPrecio } = require('./simular');

/* Dónde se busca la causa de un cambio, en este orden. */
const CAUSAS = ['producto', 'categoria', 'diaSemana', 'hora', 'cajero', 'metodo'];

/** @param d { q(texto, entradas), sql } */
function crearAnalitica({ q, sql }) {
  const cubo = crearCubo({ q, sql });

  /** Filtros sin fechas + un rango → filtros completos. */
  const con = (filtros, desde, hasta) => ({ ...(filtros || {}), desde, hasta });

  /**
   * «¿Por qué?» de un periodo contra el anterior equivalente.
   * @param filtros  los de la pregunta (producto, categoría, días…), sin fechas
   */
  async function porQue(periodo, filtros = {}, ahora = new Date()) {
    const r = rangoFechas(periodo, ahora);
    const fA = con(filtros, r.desde, r.hasta), fB = con(filtros, r.antesDesde, r.antesHasta);
    const [tA, tB] = await Promise.all([cubo.consultar({ filtros: fA }), cubo.consultar({ filtros: fB })]);
    /* Un producto solo: no tiene caso buscar «qué producto» fue. */
    const dims = CAUSAS.filter((d) => !(d === 'producto' && filtros.productos?.length) && !(d === 'categoria' && (filtros.categorias?.length || filtros.productos?.length))
      && !(d === 'metodo' && filtros.metodo) && !(d === 'cajero' && filtros.cajero) && !(d === 'diaSemana' && r.dias <= 1) && !(d === 'diaSemana' && filtros.diasSemana?.length));
    const dimensiones = {};
    await Promise.all(dims.map(async (d) => {
      const [ahoraF, antesF] = await Promise.all([cubo.consultar({ filtros: fA, agrupar: d, limite: 200 }), cubo.consultar({ filtros: fB, agrupar: d, limite: 200 })]);
      dimensiones[d] = { ahora: ahoraF, antes: antesF };
    }));
    return { rango: r, ...explicar({ total: { ahora: tA, antes: tB }, dimensiones }), ahora: tA, antes: tB };
  }

  /** Serie diaria (ventas o piezas) de los últimos `dias` días, con ceros. */
  async function serieDiaria({ filtros = {}, medida = 'ventas', dias = 56, ahora = new Date() } = {}) {
    const hasta = dia0(ahora), desde = mas(hasta, -dias);
    const filas = await cubo.consultar({ filtros: con(filtros, isoT(desde), isoT(hasta)), agrupar: 'dia', medidas: medida === 'piezas' ? ['piezas'] : [], orden: 'clave', limite: 500 });
    return rellenar(filas.map((f) => ({ dia: f.nombre, valor: f[medida] })), iso(desde), iso(hasta));
  }

  /** Cuánto se espera vender `fecha` (ventas, o piezas si hay productos). */
  async function pronostico(fecha, filtros = {}, ahora = new Date()) {
    const medida = filtros.productos?.length ? 'piezas' : 'ventas';
    const serie = await serieDiaria({ filtros, medida, dias: 56, ahora });
    return { medida, ...pronosticoDia(serie, fecha) };
  }

  /** ¿Cuándo se acaba? existencia actual contra lo que se vende por día. */
  async function cuandoSeAcaba(productId, existencia, ahora = new Date()) {
    const serie = await serieDiaria({ filtros: { productos: [productId] }, medida: 'piezas', dias: 28, ahora });
    return agotamiento(Number(existencia) || 0, serie, iso(dia0(ahora)));
  }

  /**
   * Hoy contra los mismos días de la semana de las últimas 8 semanas, hasta
   * la misma hora (comparar medio día contra días completos sería injusto).
   * @returns { hoy, lugar (1 = el mejor), de, promedio } | null
   */
  async function hoyContraSusIguales(ahora = new Date()) {
    const hoy = dia0(ahora);
    const filas = await cubo.consultar({
      filtros: { desde: isoT(mas(hoy, -56)), hasta: isoT(mas(hoy, 1)), diasSemana: [hoy.getDay()], horaHasta: ahora.getHours() + 1 },
      agrupar: 'dia', orden: 'clave', limite: 20 });
    const d = iso(hoy);
    const hoyF = filas.find((f) => String(f.nombre) === d);
    const otros = filas.filter((f) => String(f.nombre) !== d && f.ventas > 0);
    if (!hoyF || otros.length < 3) return null;
    const lugar = 1 + otros.filter((f) => f.ventas > hoyF.ventas).length;
    return { hoy: hoyF.ventas, lugar, de: otros.length + 1, promedio: otros.reduce((a, f) => a + f.ventas, 0) / otros.length, peor: lugar === otros.length + 1 };
  }

  /**
   * ¿Hubo un día raro en el periodo? Cada día contra el promedio de ese mismo
   * día de la semana en las 8 semanas ANTERIORES al periodo (con venta en al
   * menos 3 de ellas). Raro = menos del 60% o más del 160% de lo normal. Hoy
   * no cuenta (va a medias). Devuelve el más extremo, o null.
   * @param r  un rango de rangoFechas() (desde/hasta con hora)
   */
  async function diaRaro(filtros = {}, r, ahora = new Date()) {
    const d0 = deIsoT(r.desde), d1 = deIsoT(r.hasta);
    const dias = Math.round((d1 - d0) / 86_400_000);
    if (dias < 3 || dias > 62) return null;
    const desde = mas(d0, -56);
    const filas = await cubo.consultar({ filtros: con(filtros, isoT(desde), r.hasta), agrupar: 'dia', orden: 'clave', limite: 500 });
    const serie = rellenar(filas.map((f) => ({ dia: f.nombre, valor: f.ventas })), iso(desde), iso(d1));
    const hoy = iso(dia0(ahora));
    let peor = null;
    for (const x of serie) {
      if (x.dia < iso(d0) || x.dia >= hoy) continue;
      const previos = serie.filter((y) => y.dow === x.dow && y.dia < iso(d0) && y.valor > 0);
      if (previos.length < 3) continue;
      const normal = previos.reduce((a, y) => a + y.valor, 0) / previos.length;
      const ratio = x.valor / normal;
      if (ratio >= 0.6 && ratio <= 1.6) continue;
      const fuerza = Math.abs(Math.log(Math.max(ratio, 0.05)));
      if (!peor || fuerza > peor.fuerza) peor = { dia: x.dia, dow: x.dow, valor: x.valor, normal, pct: Math.round((ratio - 1) * 100), fuerza };
    }
    if (!peor) return null;
    const { fuerza, ...resto } = peor;
    return resto;
  }

  return { cubo, rango: rangoFechas, porQue, serieDiaria, pronostico, cuandoSeAcaba, hoyContraSusIguales, simularPrecio, diaRaro };
}

module.exports = { crearAnalitica };
