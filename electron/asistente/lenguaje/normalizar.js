'use strict';
/**
 * EL TEXTO, LISTO PARA ENTENDERSE: minúsculas, sin acentos, números escritos
 * con letra convertidos a cifras («seis donas» → «6 donas», «media docena»
 * → «6», «ciento cincuenta» → «150», «medio kilo» → «0.5 kilo»).
 *
 * Determinista y sin dependencias: lo mismo entra, lo mismo sale.
 */

const UNIDADES = {
  cero: 0, un: 1, uno: 1, una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9,
  diez: 10, once: 11, doce: 12, trece: 13, catorce: 14, quince: 15, dieciseis: 16, diecisiete: 17, dieciocho: 18,
  diecinueve: 19, veinte: 20, veintiun: 21, veintiuno: 21, veintiuna: 21, veintidos: 22, veintitres: 23,
  veinticuatro: 24, veinticinco: 25, veintiseis: 26, veintisiete: 27, veintiocho: 28, veintinueve: 29,
};
const DECENAS = { treinta: 30, cuarenta: 40, cincuenta: 50, sesenta: 60, setenta: 70, ochenta: 80, noventa: 90 };
const CENTENAS = {
  cien: 100, ciento: 100, doscientos: 200, doscientas: 200, trescientos: 300, trescientas: 300, cuatrocientos: 400,
  cuatrocientas: 400, quinientos: 500, quinientas: 500, seiscientos: 600, seiscientas: 600, setecientos: 700,
  setecientas: 700, ochocientos: 800, ochocientas: 800, novecientos: 900, novecientas: 900,
};

function quitarAcentos(s) {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

/** Convierte una secuencia de palabras numéricas («ciento cincuenta y dos») en número. */
function numerosConLetra(tokens) {
  const out = [];
  let i = 0;
  while (i < tokens.length) {
    const t = tokens[i];
    const esNumero = (w) => w in UNIDADES || w in DECENAS || w in CENTENAS || w === 'mil';
    /* «un/una» solo cuentan como número si les sigue algo que se cuenta o
       otra palabra numérica; «una dona» = 1 dona, pero «un latte» también:
       en este dominio casi siempre es cantidad. */
    if (!esNumero(t)) { out.push(t); i++; continue; }
    let total = 0, actual = 0, usado = 0;
    while (i < tokens.length) {
      const w = tokens[i];
      if (w in CENTENAS) { actual += CENTENAS[w]; }
      else if (w in DECENAS) { actual += DECENAS[w]; }
      else if (w in UNIDADES) { actual += UNIDADES[w]; }
      else if (w === 'mil') { total += (actual || 1) * 1000; actual = 0; }
      else if (w === 'y' && usado && i + 1 < tokens.length && tokens[i + 1] in UNIDADES) { i++; continue; }
      else break;
      usado++; i++;
    }
    out.push(String(total + actual));
  }
  return out;
}

/** «media docena» → 6, «docena» → 12, «medio kilo» → 0.5 kilo, «un cuarto» → 0.25. */
function fracciones(s) {
  return s
    .replace(/\bmedia docena\b/g, '6')
    .replace(/\b(\d+(?:\.\d+)?) docenas?\b/g, (_, n) => String(Number(n) * 12))
    .replace(/\b(una|un) docena\b/g, '12')
    .replace(/\bdocena\b/g, '12')
    .replace(/\b(medio|media)\b/g, '0.5')
    .replace(/\b(un|1) cuarto\b/g, '0.25')
    .replace(/\btres cuartos\b/g, '0.75');
}

/**
 * @returns {{ texto: string, tokens: string[] }}
 */
function normalizar(entrada) {
  let s = quitarAcentos(String(entrada || '').toLowerCase());
  s = s.replace(/[¿?¡!"“”«»]/g, ' ')
       .replace(/(\d),(\d{3})\b/g, '$1$2')        // 1,500 → 1500
       .replace(/(\d),(\d{1,2})\b/g, '$1.$2')      // 12,5 → 12.5
       .replace(/\$\s*/g, ' $')                    // «$65» y «$ 65»
       .replace(/(\d)\s*(pesos|mxn|varos|bolas)\b/g, '$1 pesos')
       .replace(/(\d)(g|gr|grs|kg|ml|l|lt|lts|pz|pza|pzas)\b/g, '$1 $2')   // 18g → 18 g
       .replace(/[^a-z0-9$.\s%]/g, ' ')
       .replace(/\s+/g, ' ').trim();
  /* Primero los números con letra («dos docenas» → «2 docenas») y después
     las fracciones y docenas («2 docenas» → «24»). */
  const conNumeros = numerosConLetra(s.split(' ').filter(Boolean)).join(' ');
  const tokens = fracciones(conNumeros).split(' ').filter(Boolean);
  return { texto: tokens.join(' '), tokens };
}

/** Raíz simple para comparar nombres: «donas» = «dona», «panes» = «pan», «lattes» = «latte». */
function raiz(w) {
  if (w.length > 4 && w.endsWith('es') && !/[aeiou]es$/.test(w)) return w.slice(0, -2);
  if (w.length > 3 && w.endsWith('s')) return w.slice(0, -1);
  return w;
}

module.exports = { normalizar, raiz, quitarAcentos };
