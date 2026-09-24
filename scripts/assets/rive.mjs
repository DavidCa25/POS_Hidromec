/**
 * Pone el wasm de Rive donde la aplicacion pueda leerlo.
 *
 *     node scripts/assets/rive.mjs
 *
 * POR QUE ESTO EXISTE
 * -------------------
 * El runtime de Rive va a buscar su wasm a un CDN si no se le dice otra cosa.
 * Una caja de punto de venta puede estar sin internet -y muchas lo estan a
 * proposito-, asi que el archivo tiene que viajar DENTRO de la aplicacion.
 *
 * POR QUE NO ESTA COMMITEADO
 * --------------------------
 * Son 849 KB de binario que ya vienen en `node_modules`. Commitearlo seria
 * guardar dos veces el mismo archivo y tener que acordarse de actualizarlo a
 * mano cada vez que suba la version del runtime. Se copia en el build, que es
 * cuando hace falta, y `src/assets/rive/` esta en .gitignore.
 *
 * Si el runtime no esta instalado esto NO falla: la mascota se dibuja con SVG
 * y no necesita wasm ninguno. Fallar aqui romperia el build de cualquiera que
 * no use Rive.
 */
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

const origen = join(raiz, 'node_modules', '@rive-app', 'canvas-lite', 'rive.wasm');
const destino = join(raiz, 'src', 'assets', 'rive', 'rive.wasm');

if (!existsSync(origen)) {
  console.log('rive: runtime no instalado, no hay wasm que copiar (la mascota usa SVG)');
  process.exit(0);
}

mkdirSync(dirname(destino), { recursive: true });
copyFileSync(origen, destino);
console.log('rive: wasm copiado a src/assets/rive/rive.wasm');
