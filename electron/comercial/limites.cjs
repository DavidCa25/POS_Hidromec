/**
 * ROLES V2 · LÍMITES DE UNA PROMOCIÓN HECHA POR UN OPERADOR.
 *
 * Un Operador da de alta promociones y combos, pero una promoción es también
 * la forma más limpia de regalar mercancía o de quedarse con la diferencia:
 * se cobra completo, se registra con descuento y el corte cuadra. Por eso, lo
 * que un Operador CREA o CAMBIA no puede, sin la autorización de un Encargado:
 *
 *   - dar más de 30% de descuento en algún producto;
 *   - dejar algún producto por debajo de su COSTO.
 *
 * Se mide el PEOR caso (el producto más caro que la promoción alcanza, o el
 * más barato si es un precio fijo): si el peor caso pasa la raya, se pide
 * autorización. Lo que no cambió respecto a la versión guardada no se vuelve
 * a revisar: no se castiga al Operador por una promoción que puso el dueño.
 *
 * Y de toda promoción que cambie queda una frase para la bitácora y el aviso
 * al dueño ("creó «2×1 donas»", "apagó «Martes de café»").
 */
const LIMITE_PORCENTAJE = 30;

const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

function alcanza(sel, p) {
  if (!sel) return true;
  const todos = !sel.products?.length && !sel.categories?.length;
  return todos || !!sel.products?.includes(p.uuid) || (!!p.category_uuid && !!sel.categories?.includes(p.category_uuid));
}

/** Peor caso de una promoción: { pct, bajoCosto, producto }. */
function peorCaso(r, productos) {
  const alcanzados = productos.filter((p) => alcanza(r.selector, p) && num(p.price) > 0);
  if (r.kind === 'BUY_PAY') {
    const pct = r.buy > 0 ? (r.buy - r.pay) / r.buy * 100 : 0;
    // En un N×M las piezas regaladas salen a $0: siempre bajo costo si hay costo.
    const conCosto = alcanzados.find((p) => num(p.cost) > 0);
    return { pct, bajoCosto: !!conCosto && pct > 0, producto: conCosto?.nombre };
  }
  let peor = { pct: 0, bajoCosto: false, producto: null };
  for (const p of alcanzados) {
    const base = num(p.price), costo = num(p.cost), v = num(r.value);
    const final = r.kind === 'PERCENT' ? base * (1 - v / 100)
      : r.kind === 'AMOUNT' ? Math.max(0, base - v)
      : /* PRICE, VOLUME, ADDON: precio fijo */ v;
    const pct = base > 0 ? (base - final) / base * 100 : 0;
    const bajo = costo > 0 && final + 0.004 < costo;
    if (pct > peor.pct || (bajo && !peor.bajoCosto)) peor = { pct: Math.max(pct, peor.pct), bajoCosto: peor.bajoCosto || bajo, producto: bajo || pct > peor.pct ? p.nombre : peor.producto };
  }
  return peor;
}

/** Peor caso de un combo: el combo frente a sus opciones MÁS CARAS (y sus costos más altos). */
function peorCasoCombo(c, productos) {
  let bruto = 0, costo = 0;
  for (const g of c.groups || []) {
    const op = productos.filter((p) => alcanza(g.selector, p) && num(p.price) > 0);
    if (!op.length) continue;
    bruto += Math.max(...op.map((p) => num(p.price))) * (g.quantity || 1);
    costo += Math.max(...op.map((p) => num(p.cost))) * (g.quantity || 1);
  }
  const precio = num(c.price);
  return { pct: bruto > 0 ? (bruto - precio) / bruto * 100 : 0, bajoCosto: costo > 0 && precio + 0.004 < costo };
}

const igual = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/**
 * @param nueva     la política que se quiere guardar
 * @param anterior  la que está guardada
 * @param productos [{ uuid, nombre, price, cost, category_uuid }] (sp_catalog_publication)
 * @returns { excesos: [texto], cambios: [texto] }
 */
function revisar(nueva, anterior, productos) {
  const excesos = [], cambios = [];
  const previas = new Map((anterior?.promotions || []).map((r) => [r.id, r]));
  const combosPrevios = new Map((anterior?.combos || []).map((c) => [c.id, c]));

  const vigilar = (item, previo, caso) => {
    if (!item.active || (previo && igual(item, previo))) return;
    const motivos = [];
    if (caso.pct > LIMITE_PORCENTAJE + 0.001) motivos.push(`${Math.round(caso.pct)}% de descuento`);
    if (caso.bajoCosto) motivos.push(`bajo costo${caso.producto ? ' (' + caso.producto + ')' : ''}`);
    if (motivos.length) excesos.push(`«${item.name}»: ${motivos.join(' y ')}`);
  };

  for (const r of nueva?.promotions || []) {
    const previo = previas.get(r.id);
    vigilar(r, previo, peorCaso(r, productos));
    if (!previo) cambios.push(`creó la promoción «${r.name}»${r.active ? '' : ' (apagada)'}`);
    else if (previo.active !== r.active && igual({ ...previo, active: r.active }, r)) cambios.push(`${r.active ? 'encendió' : 'apagó'} «${r.name}»`);
    else if (!igual(previo, r)) cambios.push(`editó la promoción «${r.name}»`);
  }
  for (const [id, r] of previas) if (!(nueva?.promotions || []).some((x) => x.id === id)) cambios.push(`borró la promoción «${r.name}»`);

  for (const c of nueva?.combos || []) {
    const previo = combosPrevios.get(c.id);
    vigilar(c, previo, peorCasoCombo(c, productos));
    if (!previo) cambios.push(`creó el combo «${c.name}»`);
    else if (!igual(previo, c)) cambios.push(`editó el combo «${c.name}»`);
  }
  for (const [id, c] of combosPrevios) if (!(nueva?.combos || []).some((x) => x.id === id)) cambios.push(`borró el combo «${c.name}»`);

  const preciosAntes = JSON.stringify(anterior?.prices || []), preciosAhora = JSON.stringify(nueva?.prices || []);
  if (preciosAntes !== preciosAhora) cambios.push('cambió precios por canal');
  return { excesos, cambios };
}

module.exports = { revisar, peorCaso, peorCasoCombo, LIMITE_PORCENTAJE };
