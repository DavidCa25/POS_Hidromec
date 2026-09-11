/**
 * Segunda parte de la migración de iconos: los que viven como DATO.
 *
 * En Configuración y en Formas de pago el nombre del icono es un campo de un
 * objeto (`icon: 'printer'`) y la plantilla lo compone (`bi-{{ tile.icon }}`).
 * El script de clases no puede verlos.
 *
 * CUIDADO: en esos mismos archivos hay llamadas a SweetAlert con
 * `icon: 'success' | 'error' | 'warning'`, que son su propio vocabulario y NO
 * son nombres de icono. Por eso aquí solo se sustituye cuando el valor es una
 * clave conocida de Bootstrap Icons; 'success' y 'error' no lo son, así que
 * quedan intactos.
 *
 *    node scripts/migrar-iconos-dato.mjs [--dry]
 */
import { readFileSync, writeFileSync } from 'node:fs';

const DRY = process.argv.includes('--dry');

/* Solo los nombres que aparecen como dato en el proyecto. */
const MAPA = {
  'activity': 'pulse',
  'arrow-repeat': 'arrows-clockwise',
  'bank': 'bank',
  'cash-coin': 'coins',
  'cloud-arrow-up': 'cloud-arrow-up',
  'credit-card': 'credit-card',
  'credit-card-2-back': 'credit-card',
  'credit-card-2-back-fill': 'credit-card',
  'database-fill': 'database',
  'display': 'monitor',
  'file-earmark-text': 'file-text',
  'key-fill': 'key',
  'pc-display': 'desktop-tower',
  'person-badge': 'identification-badge',
  'person-lines-fill': 'users',
  'person-x': 'user-minus',
  'phone': 'device-mobile',
  'printer': 'printer',
  'qr-code-scan': 'qr-code',
  'receipt': 'receipt',
  'safe2': 'vault',
  'shop': 'storefront',
  'speedometer2': 'gauge',
  'upc-scan': 'barcode',
  /* Los giros de negocio (catálogos de alta inicial). */
  'basket': 'basket', 'tools': 'wrench', 'gear-wide-connected': 'gear-six',
  'capsule': 'pill', 'shop-window': 'storefront',
};

const css = readFileSync('node_modules/@phosphor-icons/web/src/regular/style.css', 'utf8');
const faltan = [...new Set(Object.values(MAPA))].filter(v => !css.includes(`.ph-${v}:before`));
if (faltan.length) { console.error('No existen en Phosphor:', faltan.join(', ')); process.exit(1); }

const ARCHIVOS = [
  'src/app/config-shell/config-tiles.ts',
  'src/app/formas-pago-panel/formas-pago.component.ts',
  'src/app/setup-inicial/catalogos-giro.ts',
];

let cambios = 0;
for (const f of ARCHIVOS) {
  let s;
  try { s = readFileSync(f, 'utf8'); } catch { continue; }
  const orig = s;

  s = s.replace(/icon:\s*'([a-z0-9-]+)'/g, (m, n) => {
    const d = MAPA[n];
    if (!d) return m;          // 'success', 'error', 'warning' de SweetAlert
    cambios++;
    return `icon: '${d}'`;
  });
  /* Los giros ya traían el prefijo `bi-` en el dato. */
  s = s.replace(/icono:\s*'bi-([a-z0-9-]+)'/g, (m, n) => {
    const d = MAPA[n];
    if (!d) return m;
    cambios++;
    return `icono: 'ph-${d}'`;
  });

  if (s !== orig && !DRY) writeFileSync(f, s);
}

/* Las plantillas componían `bi-{{ ... }}`: ahora componen `ph-{{ ... }}`. */
const PLANTILLAS = [
  ['src/app/config-shell/configShell.html', 'class="ph bi-{{ tile.icon }}"', 'class="ph ph-{{ tile.icon }}"'],
  ['src/app/config-shell/configShell.html', 'class="ph bi-{{ activeTile.icon }}"', 'class="ph ph-{{ activeTile.icon }}"'],
  ['src/app/formas-pago-panel/formas-pago.component.ts', 'class="ph bi-{{ m.icon }}"', 'class="ph ph-{{ m.icon }}"'],
];
for (const [f, viejo, nuevo] of PLANTILLAS) {
  let s;
  try { s = readFileSync(f, 'utf8'); } catch { continue; }
  if (s.includes(viejo)) { cambios++; if (!DRY) writeFileSync(f, s.replaceAll(viejo, nuevo)); }
}

console.log(`${DRY ? '[dry] ' : ''}sustituciones en datos y plantillas: ${cambios}`);
