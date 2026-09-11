/**
 * Prepara la fuente de iconos para empaquetarla sin peso muerto.
 *
 * El CSS que trae `@phosphor-icons/web` declara cuatro formatos por peso
 * (woff2, woff, ttf y svg) como respaldo para navegadores antiguos. Angular
 * copia al build todos los que estén referenciados, y eso metía 7.4 MB de
 * archivos que Wybix nunca usa:
 *
 *      Phosphor.svg        2.9 MB      Phosphor-Fill.svg   2.7 MB
 *      Phosphor.woff       477 KB      Phosphor-Fill.woff  439 KB
 *      Phosphor.ttf        477 KB      Phosphor-Fill.ttf   439 KB
 *
 * Wybix corre sobre Electron, es decir Chromium: woff2 está soportado desde
 * hace años y es el único formato necesario.
 *
 * Este script copia los dos woff2 a `src/assets/fonts/` y genera
 * `src/styles/phosphor.css` con las mismas clases pero un solo `src`.
 * Es idempotente: se puede volver a ejecutar tras actualizar el paquete.
 *
 *    node scripts/preparar-iconos.mjs
 */
import { readFileSync, writeFileSync, copyFileSync, mkdirSync } from 'node:fs';

const ORIGEN = 'node_modules/@phosphor-icons/web/src';
const FUENTES = 'src/assets/fonts';
const SALIDA = 'src/styles/phosphor.css';

mkdirSync(FUENTES, { recursive: true });

const PESOS = [
  { dir: 'regular', fuente: 'Phosphor', familia: 'Phosphor' },
  { dir: 'fill', fuente: 'Phosphor-Fill', familia: 'Phosphor-Fill' },
];

let salida = `/* ==========================================================================
   WYBIX POS - ICONOS (Phosphor)
   --------------------------------------------------------------------------
   GENERADO por scripts/preparar-iconos.mjs. No editar a mano.

   Es el CSS de @phosphor-icons/web con un solo formato de fuente. El paquete
   declara woff2 + woff + ttf + svg como respaldo, y Angular copiaba los
   cuatro al build: 7.4 MB de archivos que Chromium nunca pide. Wybix corre
   sobre Electron, asi que woff2 basta.
   ========================================================================== */

`;

for (const { dir, fuente, familia } of PESOS) {
  copyFileSync(`${ORIGEN}/${dir}/${fuente}.woff2`, `${FUENTES}/${fuente}.woff2`);

  const css = readFileSync(`${ORIGEN}/${dir}/style.css`, 'utf8');

  // Sustituye el bloque @font-face completo por uno de un solo formato.
  const sinFontFace = css.replace(/@font-face\s*\{[^}]*\}/, '');

  salida += `@font-face {
  font-family: "${familia}";
  src: url("../assets/fonts/${fuente}.woff2") format("woff2");
  font-weight: normal;
  font-style: normal;
  font-display: block;
}
${sinFontFace.trim()}

`;
}

writeFileSync(SALIDA, salida);
console.log(`Generado ${SALIDA} y copiados 2 woff2 a ${FUENTES}/`);
