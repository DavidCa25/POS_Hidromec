/**
 * OCR LOCAL: PaddleOCR (PP-OCR) en ONNX, sin Python ni Internet.
 *
 *   const ocr = require('./ocr/motor.cjs');
 *   const { renglones } = await ocr.leer({ width, height, data });   // data: BGRA
 *
 * Dos modelos, en electron/ocr/modelos:
 *   det.onnx  PP-OCRv3 mobile det   encuentra dónde hay texto (mapa de probabilidad)
 *   rec.onnx  PP-OCRv5 latin rec    lee cada caja de texto (español incluido)
 *   dict.txt  los caracteres del reconocedor
 *
 * Origen: PaddlePaddle/PaddleOCR (Apache-2.0), convertidos a ONNX en
 * huggingface.co/monkt/paddleocr-onnx. Corren con onnxruntime-node.
 *
 * El motor solo devuelve TEXTO CON POSICIÓN. Entender qué es cada cosa
 * (producto, cantidad, IVA, total) es trabajo de ocr/ticket.cjs.
 */
const path = require('node:path');
const fs = require('node:fs');

const DIR = path.join(__dirname, 'modelos');
let sesiones = null;
let diccionario = null;

async function cargar() {
  if (sesiones) return sesiones;
  const ort = require('onnxruntime-node');
  const opciones = { executionProviders: ['cpu'], graphOptimizationLevel: 'all' };
  /* Como bytes y no como ruta: empaquetado, el modelo vive dentro del .asar
     y onnxruntime (código nativo) no sabe abrir archivos ahí; el fs de
     Electron sí. */
  const modelo = (n) => new Uint8Array(fs.readFileSync(path.join(DIR, n)));
  const [det, rec] = await Promise.all([
    ort.InferenceSession.create(modelo('det.onnx'), opciones),
    ort.InferenceSession.create(modelo('rec.onnx'), opciones),
  ]);
  /* El índice 0 es el «blanco» de CTC; al final va el espacio. */
  diccionario = ['', ...fs.readFileSync(path.join(DIR, 'dict.txt'), 'utf8').replace(/\r/g, '').split('\n').filter((l, i, a) => i < a.length - 1 || l !== ''), ' '];
  sesiones = { ort, det, rec };
  return sesiones;
}

/* ---------------------------------------------------------------- imagen */

/** Escala de grises 0..255 desde BGRA. */
function aGris(img) {
  const { width: w, height: h, data } = img;
  const g = new Uint8ClampedArray(w * h);
  for (let i = 0, j = 0; i < g.length; i++, j += 4) g[i] = (data[j] * 0.114 + data[j + 1] * 0.587 + data[j + 2] * 0.299);
  return { width: w, height: h, gris: g };
}

/** Redimensiona (bilineal) un buffer BGRA. */
function redimensionar(img, w2, h2) {
  const { width: w, height: h, data } = img;
  const out = new Uint8ClampedArray(w2 * h2 * 4);
  const sx = w / w2, sy = h / h2;
  for (let y = 0; y < h2; y++) {
    const fy = Math.min(h - 1, (y + 0.5) * sy - 0.5), y0 = Math.max(0, Math.floor(fy)), y1 = Math.min(h - 1, y0 + 1), dy = Math.max(0, fy - y0);
    for (let x = 0; x < w2; x++) {
      const fx = Math.min(w - 1, (x + 0.5) * sx - 0.5), x0 = Math.max(0, Math.floor(fx)), x1 = Math.min(w - 1, x0 + 1), dx = Math.max(0, fx - x0);
      for (let c = 0; c < 4; c++) {
        const a = data[(y0 * w + x0) * 4 + c], b = data[(y0 * w + x1) * 4 + c];
        const d = data[(y1 * w + x0) * 4 + c], e = data[(y1 * w + x1) * 4 + c];
        out[(y * w2 + x) * 4 + c] = (a * (1 - dx) + b * dx) * (1 - dy) + (d * (1 - dx) + e * dx) * dy;
      }
    }
  }
  return { width: w2, height: h2, data: out };
}

function recortar(img, x, y, w, h) {
  x = Math.max(0, Math.floor(x)); y = Math.max(0, Math.floor(y));
  w = Math.min(img.width - x, Math.ceil(w)); h = Math.min(img.height - y, Math.ceil(h));
  const out = new Uint8ClampedArray(w * h * 4);
  for (let r = 0; r < h; r++) out.set(img.data.subarray(((y + r) * img.width + x) * 4, ((y + r) * img.width + x + w) * 4), r * w * 4);
  return { width: w, height: h, data: out };
}

/**
 * Mejora para papel térmico: estira el contraste entre los percentiles 2 y 98
 * (el ticket desteñido queda gris claro sobre blanco). No binariza: el modelo
 * lee mejor con grises que con blanco y negro duro.
 */
function contrastar(img) {
  const { gris } = aGris(img);
  const hist = new Uint32Array(256);
  for (const v of gris) hist[v]++;
  const n = gris.length; let acum = 0, lo = 0, hi = 255;
  for (let i = 0; i < 256; i++) { acum += hist[i]; if (acum >= n * 0.02) { lo = i; break; } }
  acum = 0;
  for (let i = 255; i >= 0; i--) { acum += hist[i]; if (acum >= n * 0.02) { hi = i; break; } }
  if (hi - lo < 40) return img;
  const k = 255 / (hi - lo);
  const out = new Uint8ClampedArray(img.data.length);
  for (let i = 0, p = 0; p < n; p++, i += 4) {
    const v = Math.max(0, Math.min(255, (gris[p] - lo) * k));
    out[i] = out[i + 1] = out[i + 2] = v; out[i + 3] = 255;
  }
  return { width: img.width, height: img.height, data: out };
}

/* ------------------------------------------------------------- detección */

const MEDIA = [0.485, 0.456, 0.406], DESV = [0.229, 0.224, 0.225];

async function detectar(img, { lado = 1280, angosto = 960, umbral = 0.3, umbralCaja = 0.5 } = {}) {
  const { ort, det } = await cargar();
  /* El lado mayor a 1280, salvo que el ancho quede chico: un ticket es una
     tira larga y angosta (669 × 2000). Limitado solo por el lado mayor
     quedaba a 430 px de ancho y las letras, de 6 px: el detector ya no las
     veía. Entonces se deja el lado angosto en ~960 (sin agrandar). */
  const escala = Math.min(1.5, Math.max(lado / Math.max(img.width, img.height), Math.min(1, angosto / Math.min(img.width, img.height))), 4000 / Math.max(img.width, img.height));
  const w = Math.max(32, Math.round(img.width * escala / 32) * 32), h = Math.max(32, Math.round(img.height * escala / 32) * 32);
  const r = redimensionar(img, w, h);
  const t = new Float32Array(3 * w * h);
  for (let p = 0, i = 0; p < w * h; p++, i += 4) {
    /* BGR, como Paddle. */
    for (let c = 0; c < 3; c++) t[c * w * h + p] = (r.data[i + c] / 255 - MEDIA[c]) / DESV[c];
  }
  const salida = await det.run({ x: new ort.Tensor('float32', t, [1, 3, h, w]) });
  const mapa = salida[det.outputNames[0]].data;

  /* Componentes conexas del mapa binarizado: cada una es un trozo de texto. */
  const visto = new Uint8Array(w * h), cajas = [];
  const cola = new Int32Array(w * h);
  for (let s = 0; s < w * h; s++) {
    if (visto[s] || mapa[s] < umbral) continue;
    let ini = 0, fin = 0, x0 = w, y0 = h, x1 = 0, y1 = 0, suma = 0, n = 0;
    let sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0;
    cola[fin++] = s; visto[s] = 1;
    while (ini < fin) {
      const q = cola[ini++], qx = q % w, qy = (q / w) | 0;
      suma += mapa[q]; n++;
      sx += qx; sy += qy; sxx += qx * qx; syy += qy * qy; sxy += qx * qy;
      if (qx < x0) x0 = qx; if (qx > x1) x1 = qx; if (qy < y0) y0 = qy; if (qy > y1) y1 = qy;
      for (const v of [q - 1, q + 1, q - w, q + w]) {
        if (v < 0 || v >= w * h || visto[v] || mapa[v] < umbral) continue;
        if ((v === q - 1 && qx === 0) || (v === q + 1 && qx === w - 1)) continue;
        visto[v] = 1; cola[fin++] = v;
      }
    }
    if (n < 6 || suma / n < umbralCaja) continue;
    /* «Unclip»: el modelo marca el centro de las letras; se agranda la caja. */
    const bw = x1 - x0 + 1, bh = y1 - y0 + 1;
    const d = (bw * bh * 1.6) / (2 * (bw + bh));
    /* Del tamaño del modelo (w × h) al de la imagen original. */
    const fx = img.width / w, fy = img.height / h;
    /* La inclinación del trozo: el eje principal de sus píxeles (momentos de
       segundo orden). Una caja derecha no la dice; el mapa sí. */
    const mx = sx / n, my = sy / n;
    const cxx = sxx / n - mx * mx, cyy = syy / n - my * my, cxy = sxy / n - mx * my;
    const ang = 0.5 * Math.atan2(2 * cxy, cxx - cyy);
    cajas.push({
      x: (x0 - d) * fx, y: (y0 - d) * fy,
      w: (bw + 2 * d) * fx, h: (bh + 2 * d) * fy,
      pendiente: Math.tan(ang) * fy / fx,
      score: suma / n,
    });
  }
  return cajas.filter(c => c.w > 4 && c.h > 4);
}

/* ---------------------------------------------------------- reconocimiento */

async function reconocer(img, caja) {
  const { ort, rec } = await cargar();
  const H = 48;
  const r0 = recortar(img, caja.x, caja.y, caja.w, caja.h);
  if (r0.width < 2 || r0.height < 2) return { texto: '', confianza: 0 };
  const W = Math.max(16, Math.min(1600, Math.round(r0.width * H / r0.height)));
  const r = redimensionar(r0, W, H);
  const t = new Float32Array(3 * W * H);
  for (let p = 0, i = 0; p < W * H; p++, i += 4) {
    for (let c = 0; c < 3; c++) t[c * W * H + p] = (r.data[i + c] / 255 - 0.5) / 0.5;
  }
  const out = (await rec.run({ x: new ort.Tensor('float32', t, [1, 3, H, W]) }))[rec.outputNames[0]];
  const [, T, C] = out.dims, d = out.data;
  let texto = '', prev = -1, suma = 0, n = 0;
  for (let ti = 0; ti < T; ti++) {
    let mejor = 0, pm = -Infinity;
    for (let c = 0; c < C; c++) { const v = d[ti * C + c]; if (v > pm) { pm = v; mejor = c; } }
    if (mejor !== 0 && mejor !== prev) { texto += diccionario[mejor] ?? ''; suma += pm; n++; }
    prev = mejor;
  }
  return { texto: texto.trim(), confianza: n ? suma / n : 0 };
}

/* ------------------------------------------------------------- renglones */

/**
 * Junta las cajas en RENGLONES: dos cajas son del mismo renglón si se
 * traslapan más de la mitad en vertical. Dentro del renglón, de izquierda a
 * derecha. Así «COCA COLA 600ML   24   $14.50   $348.00» queda en una fila con
 * sus columnas, que es lo que necesita el intérprete del ticket.
 */
function agrupar(piezas, pendiente) {
  /* Con la foto chueca, la «altura» de una pieza depende de dónde está: se
     corrige con la pendiente estimada antes de comparar. */
  const cyDe = (p) => (p.y + p.h / 2) - (p.x + p.w / 2) * pendiente;
  const orden = [...piezas].sort((a, b) => cyDe(a) - cyDe(b));
  const filas = [];
  for (const p of orden) {
    const cy = cyDe(p);
    const fila = filas.find(f => Math.abs(f.cy - cy) < Math.min(f.h, p.h) * 0.5);
    if (fila) { fila.piezas.push(p); fila.cy = (fila.cy * (fila.piezas.length - 1) + cy) / fila.piezas.length; }
    else filas.push({ cy, h: p.h, piezas: [p] });
  }
  return filas;
}

/**
 * Renglones para una foto de papel CURVO (el ticket en la mano, el rollo que
 * se enrolla): una sola pendiente no sirve, cada renglón se dobla distinto.
 * Se arman de izquierda a derecha, encadenando: cada pieza va al renglón cuya
 * última pieza, prolongada con la pendiente de ESE renglón, le cae a su
 * altura. Dos piezas que se enciman en horizontal nunca son del mismo renglón.
 */
function encadenar(piezas, pendiente) {
  const c = (p) => ({ cx: p.x + p.w / 2, cy: p.y + p.h / 2 });
  const orden = [...piezas].sort((a, b) => a.x - b.x);
  const filas = [];
  /* Las piezas largas (más de 3 veces su alto) dicen bien su inclinación;
     cerca de cada altura manda la de ellas (el papel se dobla distinto
     arriba que abajo). */
  const largas = piezas.filter(p => p.pendiente != null && p.w > p.h * 3 && Math.abs(p.pendiente) < 0.15);
  const altoTipico = [...piezas].map(p => p.h).sort((a, b) => a - b)[piezas.length >> 1] || 20;
  const local = (cy) => {
    const cerca = largas.filter(p => Math.abs(c(p).cy - cy) < altoTipico * 5).map(p => p.pendiente).sort((a, b) => a - b);
    return cerca.length ? cerca[cerca.length >> 1] : pendiente;
  };
  const pendienteDe = (f) => {
    const u = f.piezas[f.piezas.length - 1];
    if (u.pendiente != null && u.w > u.h * 3 && Math.abs(u.pendiente) < 0.15) return u.pendiente;
    return local(c(u).cy);
  };
  for (const p of orden) {
    const q = c(p);
    let mejor = null, dMejor = Infinity;
    for (const f of filas) {
      const u = f.piezas[f.piezas.length - 1], cu = c(u);
      if (Math.min(u.x + u.w, p.x + p.w) - Math.max(u.x, p.x) > Math.min(u.w, p.w) * 0.3) continue;
      if (f.piezas.some(o => Math.min(o.x + o.w, p.x + p.w) - Math.max(o.x, p.x) > Math.min(o.w, p.w) * 0.3)) continue;
      const pred = cu.cy + pendienteDe(f) * (q.cx - cu.cx);
      const d = Math.abs(q.cy - pred);
      if (d < Math.min(u.h, p.h) * 0.5 && d < dMejor) { dMejor = d; mejor = f; }
    }
    if (mejor) mejor.piezas.push(p);
    else filas.push({ piezas: [p] });
  }
  /* En orden de arriba abajo: la altura del renglón, corregida a la izquierda. */
  for (const f of filas) {
    f.cy = f.piezas.reduce((a, p) => a + (c(p).cy - c(p).cx * pendiente), 0) / f.piezas.length;
  }
  filas.sort((a, b) => a.cy - b.cy);
  /* Un renglón que quedó partido («10 3859293 5 $43.70» y, apenas más abajo,
     «$ 218.50»): dos vecinos muy juntos que no se enciman en nada son uno. */
  const encima = (a, b) => a.piezas.some(p => b.piezas.some(q => Math.min(p.x + p.w, q.x + q.w) - Math.max(p.x, q.x) > Math.min(p.w, q.w) * 0.5));
  for (let i = 0; i + 1 < filas.length; i++) {
    const a = filas[i], b = filas[i + 1];
    if (Math.abs(a.cy - b.cy) < altoTipico * 0.6 && !encima(a, b)) {
      a.piezas.push(...b.piezas);
      a.cy = (a.cy + b.cy) / 2;
      filas.splice(i + 1, 1); i--;
    }
  }
  return filas;
}

/**
 * La inclinación de la foto: la pendiente con la que las piezas forman MENOS
 * renglones (un ticket derecho alinea sus columnas). Se prueba de -6° a 6°.
 */
function inclinacion(piezas) {
  let mejor = 0, menos = Infinity;
  for (let g = -6; g <= 6.001; g += 0.25) {
    const m = Math.tan(g * Math.PI / 180);
    const n = agrupar(piezas, m).length + Math.abs(g) * 0.01;   // a igualdad, la más derecha
    if (n < menos) { menos = n; mejor = m; }
  }
  return mejor;
}

/**
 * La inclinación medida pieza con pieza: cada pieza con su vecina de la
 * derecha (sin encimarse y casi a la misma altura) da una pendiente; la
 * mediana es la del ticket. En una foto chica (480 px) contar renglones no
 * distingue 0° de 2.6°; esto sí.
 */
function inclinacionPorPares(piezas) {
  const ms = [];
  for (const p of piezas) {
    const cy = p.y + p.h / 2;
    let mejor = null;
    for (const q of piezas) {
      if (q === p || q.x < p.x + p.w * 0.9) continue;
      const dy = (q.y + q.h / 2) - cy;
      if (Math.abs(dy) > Math.min(p.h, q.h) * 0.8) continue;
      const dx = (q.x + q.w / 2) - (p.x + p.w / 2);
      if (!mejor || dx < mejor.dx) mejor = { dx, dy };
    }
    if (mejor && mejor.dx > 0) ms.push(mejor.dy / mejor.dx);
  }
  if (ms.length < 5) return null;
  ms.sort((a, b) => a - b);
  return Math.max(-0.11, Math.min(0.11, ms[ms.length >> 1]));
}

function enRenglones(piezas) {
  const largas = piezas.filter(p => p.pendiente != null && p.w > p.h * 3).map(p => p.pendiente).sort((a, b) => a - b);
  const pendiente = piezas.length <= 3 ? 0
    : largas.length >= 3 ? Math.max(-0.11, Math.min(0.11, largas[largas.length >> 1]))
    : (inclinacionPorPares(piezas) ?? inclinacion(piezas));
  return encadenar(piezas, pendiente).map(f => {
    const ps = f.piezas.sort((a, b) => a.x - b.x);
    return {
      texto: ps.map(p => p.texto).join('  '),
      piezas: ps.map(p => ({ texto: p.texto, x: Math.round(p.x), w: Math.round(p.w), confianza: +p.confianza.toFixed(3) })),
      y: Math.round(f.cy),
      confianza: +(ps.reduce((a, p) => a + p.confianza, 0) / ps.length).toFixed(3),
    };
  });
}

/**
 * Lee una imagen ya decodificada ({ width, height, data } en BGRA).
 * Devuelve las piezas con posición y los renglones armados.
 */
async function leer(imagen, opciones = {}) {
  const t0 = Date.now();
  const img = opciones.sinContraste ? imagen : contrastar(imagen);
  const cajas = await detectar(img, opciones);
  const piezas = [];
  for (const c of cajas) {
    const r = await reconocer(img, c);
    if (r.texto) piezas.push({ ...c, ...r });
  }
  return { piezas, renglones: enRenglones(piezas), ms: Date.now() - t0, ancho: imagen.width, alto: imagen.height };
}

module.exports = { cargar, leer, enRenglones, _interno: { contrastar, redimensionar, detectar, reconocer } };
