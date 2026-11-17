/**
 * CAPTURAS DE LA LANDING — Wybix de verdad sobre la demo escaparate.
 *
 *   node scripts/landing/preparar.cjs          base Wybix_E2E_Landing (demo retail + escaparate.sql)
 *   node scripts/landing/capturar.cjs [nombre...]
 *
 * Usa el build de dist/ (correr `npm run build` antes si cambió el código), el
 * gestor de demos (WYBIX_DEMO=1) y la base con is_demo. Deja PNG de 1600×1000
 * en tmp/landing-capturas/. Modo oscuro salvo CLARO=1.
 *
 * Nombres: venta, inventario, corte, estadisticas, cierre, clientes, touch,
 *          asistente-codigo, asistente-ventas, asistente-plan
 */
const fs = require('node:fs');
const path = require('node:path');
const { arrancarDemoReal, entrarDemo } = require('../../e2e/demo-real');

const BASE = 'Wybix_E2E_Landing';
const SALIDA = path.join(__dirname, '..', '..', 'tmp', 'landing-capturas');
const W = 1600, H = 1000;
const espera = (ms) => new Promise(r => setTimeout(r, ms));

async function instancia() {
  const { consultar } = await import('../db/lib/sql.mjs');
  return consultar(BASE, "SELECT valor FROM dbo.database_metadata WHERE clave = 'demo_instance_id'")[0].valor;
}

/** Navega con el router de Angular: el build usa rutas de path bajo file://. */
async function ir(p, ruta) {
  await p.evaluate((r) => {
    const base = location.pathname.replace(/\/(dashboard|touch|login)(\/.*)?$/, '');
    history.pushState({}, '', base + '/' + r);
    dispatchEvent(new PopStateEvent('popstate', { state: {} }));
  }, ruta);
  await espera(2600);
}

/** La ventana se maximiza al entrar: el tamaño se fija después y se comprueba. */
async function fijarTamano(app, p) {
  for (let i = 0; i < 5; i++) {
    await app.evaluate(({ BrowserWindow }, [w, h]) => {
      for (const b of BrowserWindow.getAllWindows()) { if (b.isFullScreen()) b.setFullScreen(false); if (b.isMaximized()) b.unmaximize(); b.setContentSize(w, h); }
    }, [W, H]);
    await espera(500);
    const v = await p.evaluate(() => [innerWidth, innerHeight]);
    if (v[0] === W && v[1] === H) return;
  }
  throw new Error('No se pudo fijar la ventana en ' + W + 'x' + H);
}

async function sesion({ touch = false }) {
  const s = await arrancarDemoReal({ base: BASE, perfil: 'retail', instancia: await instancia(), touch });
  const { app, ventana: p } = s;
  await app.evaluate(({ BrowserWindow }, [w, h]) => {
    for (const b of BrowserWindow.getAllWindows()) { if (b.isMaximized()) b.unmaximize(); b.setContentSize(w, h); b.center(); }
  }, [W, H]);
  await p.emulateMedia({ reducedMotion: 'reduce' });
  await entrarDemo(p);
  await espera(2500);
  await fijarTamano(app, p);
  /* Solo presentación: sin barras de desplazamiento en la foto. */
  await p.addStyleTag({ content: '::-webkit-scrollbar{width:0!important;height:0!important}' });
  if (process.env.CLARO !== '1' && await p.locator('.dark-toggle-btn').count()) {
    const oscuro = await p.locator('.dark-toggle-btn').innerText();
    if (/Oscuro/.test(oscuro)) { await p.click('.dark-toggle-btn'); await espera(800); }
  }
  return s;
}

async function main() {
  fs.mkdirSync(SALIDA, { recursive: true });
  const solo = process.argv.slice(2);
  const quiere = (n) => !solo.length || solo.some(x => n.startsWith(x));
  const foto = async (p, nombre) => { await espera(900); await p.screenshot({ path: path.join(SALIDA, `${nombre}.png`) }); console.log('foto', nombre); };

  /* Cada corrida empieza igual: precios del escaparate y chat vacío. */
  const { ejecutar } = await import('../db/lib/temporal.mjs');
  ejecutar(BASE, "UPDATE dbo.products SET price = 22 WHERE part_number = N'BEB-001'; UPDATE dbo.products SET price = 19 WHERE part_number = N'BOT-001'; DELETE FROM dbo.asistente_mensajes; DELETE FROM dbo.asistente_planes;");

  const pantallas = [
    ['venta', 'dashboard/venta'], ['inventario', 'dashboard/inventario'], ['corte', 'dashboard/corte-dia'],
    ['estadisticas', 'dashboard/estadisticas'], ['cierre', 'dashboard/cierre-dia'], ['clientes', 'dashboard/clientes'],
    ['compras', 'dashboard/registrarCompra'],
  ];
  const asist = ['asistente-codigo', 'asistente-ventas', 'asistente-plan'];

  if (pantallas.some(([n]) => quiere(n)) || asist.some(quiere)) {
    const { ventana: p, registro, cerrar } = await sesion({});
    try {
      for (const [n, r] of pantallas) {
        if (!quiere(n)) continue;
        await ir(p, r);
        if (PREPARAR[n]) await PREPARAR[n](p);
        await foto(p, n);
      }
      if (asist.some(quiere)) await asistente(p, quiere, foto);
    } catch (e) {
      console.error(e); console.error(registro.slice(-30).join(''));
      await p.screenshot({ path: path.join(SALIDA, '_error.png') }).catch(() => {});
      process.exitCode = 1;
    } finally { await cerrar(); }
  }

  if (quiere('touch')) {
    const { ventana: p, registro, cerrar } = await sesion({ touch: true });
    try {
      if (process.env.SIN_FOTOS !== '1') await ilustrarCatalogo(p);
      await ir(p, 'touch');
      for (const pn of ['BEB-001', 'BOT-001', 'LAC-001', 'PAN-002', 'BEB-001', 'DUL-001']) {
        const t = p.locator(`[data-guide=touch-producto][data-guide-clave="${pn}"]`).first();
        if (await t.count()) { await t.scrollIntoViewIfNeeded(); await t.click(); await espera(350); }
      }
      await p.evaluate(() => document.querySelector('.tp-grid, [data-guide=touch-producto]')?.closest('[class*=scroll], main, section')?.scrollTo?.(0, 0));
      await espera(3500);
      await foto(p, 'touch');
    }
    catch (e) { console.error(e); console.error(registro.slice(-30).join('')); process.exitCode = 1; }
    finally { await cerrar(); }
  }
}

/**
 * Miniaturas del catálogo demo: ilustraciones planas por categoría, dibujadas
 * en canvas (deterministas, sin fotos de marcas) y guardadas con el mismo
 * canal que usa la pantalla de producto (`images:set`).
 */
async function ilustrarCatalogo(p) {
  const { consultar } = await import('../db/lib/sql.mjs');
  const filas = consultar(BASE, `SELECT p.id, p.part_number, p.nombre, c.namee AS cat
    FROM dbo.products p JOIN dbo.CAT_categories c ON c.id = p.category_id
    WHERE p.active = 1 AND p.part_number LIKE '[A-Z][A-Z][A-Z]-0%'`);
  const r = await p.evaluate(async (filas) => {
    /* Forma por palabra clave (lata, costal, frasco…), color propio por producto. */
    const FORMAS = [
      [/lata|atún/i, 'lata'], [/aceite|jugo|leche|crema/i, 'carton'], [/agua|refresco|isotónica|cloro|shampoo/i, 'botella'],
      [/papas|palomitas|totopos|cacahuate|gomitas/i, 'bolsa'], [/arroz|frijol|azúcar|sal |harina|detergente/i, 'costal'],
      [/café soluble|yogur/i, 'frasco'], [/galletas|pasta|servilletas|chicles|huevo/i, 'caja'], [/pan |tortillas/i, 'pan'],
      [/chocolate|paleta/i, 'dulce'], [/jabón para|limpiador/i, 'spray'], [/papel/i, 'rollo'], [/queso/i, 'queso'],
      [/pasta dental|desodorante|jabón de/i, 'tubo'],
    ];
    const hash = (s) => [...s].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);
    const hsl = (h, s, l) => `hsl(${h} ${s}% ${l}%)`;
    const rr = (x, a, b, w, h, r) => { x.beginPath(); x.roundRect(a, b, w, h, r); };
    let ok = 0;
    for (const f of filas) {
      const cv = document.createElement('canvas'); cv.width = cv.height = 192;
      const x = cv.getContext('2d');
      const hue = (hash(f.part_number + f.nombre) * 47) % 360;
      const g = x.createLinearGradient(0, 0, 192, 192);
      g.addColorStop(0, hsl(hue, 75, 95)); g.addColorStop(1, hsl((hue + 30) % 360, 65, 87));
      x.fillStyle = g; x.fillRect(0, 0, 192, 192);
      x.fillStyle = 'rgba(15,23,42,.10)'; x.beginPath(); x.ellipse(96, 166, 48, 8, 0, 0, Math.PI * 2); x.fill();
      const fuerte = hsl(hue, 68, 50), oscuro = hsl(hue, 55, 30), suave = hsl(hue, 70, 78), claro = '#fff';
      const forma = (FORMAS.find(([re]) => re.test(f.nombre + ' ')) || [0, 'caja'])[1];
      const etiqueta = (y, h) => { x.fillStyle = claro; rr(x, 72, y, 48, h, 5); x.fill(); x.fillStyle = suave; rr(x, 80, y + h / 2 - 3, 32, 6, 3); x.fill(); };
      x.lineJoin = 'round'; x.lineCap = 'round';
      switch (forma) {
        case 'botella':
          x.fillStyle = oscuro; rr(x, 86, 24, 20, 14, 4); x.fill();
          x.fillStyle = fuerte; x.beginPath(); x.moveTo(84, 38); x.lineTo(108, 38); x.lineTo(120, 64); x.lineTo(120, 156); x.quadraticCurveTo(120, 164, 112, 164); x.lineTo(80, 164); x.quadraticCurveTo(72, 164, 72, 156); x.lineTo(72, 64); x.closePath(); x.fill();
          etiqueta(92, 34); x.fillStyle = 'rgba(255,255,255,.35)'; rr(x, 78, 66, 6, 82, 3); x.fill(); break;
        case 'carton':
          x.fillStyle = oscuro; x.beginPath(); x.moveTo(68, 58); x.lineTo(96, 34); x.lineTo(124, 58); x.closePath(); x.fill();
          x.fillStyle = fuerte; rr(x, 68, 56, 56, 106, 4); x.fill(); etiqueta(84, 46);
          x.fillStyle = oscuro; rr(x, 104, 30, 10, 14, 3); x.fill(); break;
        case 'lata':
          x.fillStyle = fuerte; rr(x, 56, 82, 80, 70, 10); x.fill();
          x.fillStyle = suave; x.beginPath(); x.ellipse(96, 82, 40, 12, 0, 0, Math.PI * 2); x.fill();
          x.strokeStyle = oscuro; x.lineWidth = 3; x.beginPath(); x.ellipse(96, 82, 30, 8, 0, 0, Math.PI * 2); x.stroke();
          x.fillStyle = claro; rr(x, 56, 104, 80, 26, 0); x.fill(); x.fillStyle = suave; rr(x, 74, 114, 44, 6, 3); x.fill(); break;
        case 'bolsa':
          x.fillStyle = fuerte; x.beginPath(); x.moveTo(54, 40);
          for (let i = 0; i <= 8; i++) x.lineTo(54 + i * 10.5, i % 2 ? 33 : 40);
          x.lineTo(142, 160); x.lineTo(50, 160); x.closePath(); x.fill();
          x.fillStyle = claro; x.beginPath(); x.ellipse(96, 100, 30, 24, 0, 0, Math.PI * 2); x.fill();
          x.fillStyle = hsl(42, 92, 58); x.beginPath(); x.ellipse(92, 102, 16, 11, -0.4, 0, Math.PI * 2); x.fill();
          x.beginPath(); x.ellipse(104, 96, 12, 8, 0.5, 0, Math.PI * 2); x.fill(); break;
        case 'costal':
          x.fillStyle = fuerte; x.beginPath(); x.moveTo(62, 50); x.quadraticCurveTo(96, 40, 130, 50); x.lineTo(138, 154); x.quadraticCurveTo(96, 166, 54, 154); x.closePath(); x.fill();
          x.strokeStyle = oscuro; x.lineWidth = 6; x.beginPath(); x.moveTo(66, 56); x.quadraticCurveTo(96, 46, 126, 56); x.stroke();
          etiqueta(88, 42); break;
        case 'frasco':
          x.fillStyle = oscuro; rr(x, 68, 40, 56, 22, 6); x.fill();
          x.fillStyle = fuerte; rr(x, 62, 60, 68, 100, 16); x.fill(); etiqueta(88, 44); break;
        case 'pan':
          x.fillStyle = hsl(30, 72, 54); x.beginPath(); x.moveTo(44, 150); x.lineTo(44, 94); x.bezierCurveTo(44, 50, 148, 50, 148, 94); x.lineTo(148, 150); x.closePath(); x.fill();
          x.strokeStyle = hsl(34, 80, 78); x.lineWidth = 5;
          for (const a of [72, 96, 120]) { x.beginPath(); x.moveTo(a - 8, 80); x.lineTo(a + 6, 66); x.stroke(); }
          x.fillStyle = 'rgba(255,255,255,.75)'; rr(x, 44, 118, 104, 16, 0); x.fill(); break;
        case 'dulce':
          x.fillStyle = oscuro; x.beginPath(); x.moveTo(60, 100); x.lineTo(32, 76); x.lineTo(32, 124); x.closePath(); x.fill();
          x.beginPath(); x.moveTo(132, 100); x.lineTo(160, 76); x.lineTo(160, 124); x.closePath(); x.fill();
          x.fillStyle = fuerte; x.beginPath(); x.ellipse(96, 100, 42, 32, 0, 0, Math.PI * 2); x.fill();
          x.strokeStyle = 'rgba(255,255,255,.75)'; x.lineWidth = 6; x.beginPath(); x.arc(96, 100, 20, Math.PI * 1.1, Math.PI * 1.9); x.stroke(); break;
        case 'spray':
          x.fillStyle = oscuro; rr(x, 82, 28, 36, 18, 5); x.fill(); rr(x, 114, 32, 22, 8, 3); x.fill();
          x.fillStyle = fuerte; rr(x, 66, 46, 64, 116, 14); x.fill(); etiqueta(86, 42); break;
        case 'rollo':
          for (const [cx, cy] of [[74, 80], [118, 80], [74, 126], [118, 126]]) {
            x.fillStyle = claro; x.beginPath(); x.arc(cx, cy, 22, 0, Math.PI * 2); x.fill();
            x.fillStyle = suave; x.beginPath(); x.arc(cx, cy, 7, 0, Math.PI * 2); x.fill();
          }
          x.fillStyle = fuerte; rr(x, 50, 96, 92, 12, 4); x.fill(); break;
        case 'queso':
          x.fillStyle = hsl(48, 90, 70); x.beginPath(); x.moveTo(40, 132); x.lineTo(150, 132); x.lineTo(150, 98); x.lineTo(40, 70); x.closePath(); x.fill();
          x.fillStyle = hsl(48, 90, 82); x.beginPath(); x.moveTo(40, 70); x.lineTo(150, 98); x.lineTo(120, 70); x.closePath(); x.fill();
          x.fillStyle = hsl(44, 80, 60); for (const [a, b, r] of [[70, 110, 7], [110, 118, 5], [130, 108, 4]]) { x.beginPath(); x.arc(a, b, r, 0, Math.PI * 2); x.fill(); } break;
        case 'tubo':
          x.fillStyle = oscuro; rr(x, 82, 140, 28, 22, 4); x.fill();
          x.fillStyle = fuerte; x.beginPath(); x.moveTo(62, 34); x.lineTo(130, 34); x.lineTo(112, 142); x.lineTo(80, 142); x.closePath(); x.fill();
          etiqueta(66, 36); break;
        default:
          x.fillStyle = fuerte; rr(x, 52, 56, 88, 104, 8); x.fill();
          x.fillStyle = oscuro; rr(x, 52, 56, 88, 18, 8); x.fill(); etiqueta(92, 42);
      }
      const res = await window.wybix.images.set({ productId: f.id, dataUrl: cv.toDataURL('image/png') });
      if (res?.success) ok++;
    }
    await window.wybix.images.sync?.({}).catch?.(() => {});
    return ok;
  }, filas);
  console.log('miniaturas', r, 'de', filas.length);
}

/** Lo que cada pantalla necesita para verse en uso, con la interfaz real. */
const PREPARAR = {
  /* Subir el ticket del proveedor: el de prueba de la app (proveedor inventado). */
  async compras(p) {
    await p.click('[data-guide=compra-subir-documento]');
    await p.locator('[data-guide=compra-documento-archivo]').setInputFiles(path.join(__dirname, '..', 'pruebas', 'compras-documentos', 'tickets', 'mayorista.png'));
    await p.locator('[data-guide=compra-documento-pasar]').waitFor({ timeout: 90000 });
    /* Los renglones sin producto: se acepta la sugerencia «¿Es…?», como lo haría la persona. */
    for (const t of ['Papel higiénico 4 rollos', 'Frijol negro 1 kg']) {
      const chip = p.locator('[data-guide=compra-documento-renglones] button:not([role=option]):visible', { hasText: t }).first();
      if (await chip.count()) { await chip.click(); await espera(400); }
    }
    await espera(1500);
  },
  async venta(p) {
    for (const [pn, q] of [['BEB-001', 'refresco cola 600'], ['BOT-001', 'papas fritas sal'], ['LAC-001', 'leche entera'], ['PAN-002', 'tortillas'], ['ABA-007', 'atún en agua']]) {
      await p.click('[data-guide=venta-agregar]');
      await p.fill('[data-guide=venta-buscar]', q);
      await espera(700);
      await p.click(`[data-guide=venta-producto][data-guide-clave="${pn}"]`);
      await espera(500);
      if (await p.locator('[data-guide=venta-buscar]').isVisible().catch(() => false)) { await p.keyboard.press('Escape'); await espera(300); }
    }
  },
  async corte(p) {
    await p.locator('.user-card').first().click();
    await p.locator('button', { hasText: 'Continuar' }).click();
    await espera(600);
    await p.locator('.mode-card', { hasText: 'Cerrar turno' }).click();
    await espera(400);
    await p.locator('button', { hasText: 'Consultar movimientos' }).click();
    await espera(2500);
  },
  async estadisticas(p) {
    /* ApexCharts dibuja al medir: con movimiento reducido emulado y sin un
       resize la gráfica queda vacía en la captura. */
    await p.evaluate(() => dispatchEvent(new Event('resize')));
    await espera(2500);
  },
};

/** El chat de Wybix con tres conversaciones reales. */
async function asistente(p, quiere, fotoPantalla) {
  /* Pantalla completa y, aparte, solo el panel del chat (para la sección del asistente). */
  const foto = async (p, n) => {
    await fotoPantalla(p, n);
    const clip = await p.evaluate(() => {
      /* El panel entero: el ancestro del chat que también contiene la cabecera (Chat / Recorridos). */
      let e = document.querySelector('[data-guide=wybix-chat]');
      while (e && !/Recorridos/.test(e.textContent || '')) e = e.parentElement;
      const r = e.getBoundingClientRect();
      return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) };
    });
    await p.screenshot({ path: path.join(SALIDA, n + '-chat.png'), clip });
  };
  await ir(p, 'dashboard/venta');
  const abrir = async () => {
    if (!(await p.locator('[data-guide=wybix-chat]').isVisible().catch(() => false))) await p.click('[data-guide=wybix-guide]');
    await p.waitForSelector('[data-guide=wybix-chat]', { timeout: 20000 });
  };
  const decir = async (texto) => {
    const campo = p.locator('[data-guide=wybix-campo]');
    await campo.fill(texto); await campo.press('Enter'); await espera(2200);
  };
  await abrir();
  if (quiere('asistente-codigo')) {
    await decir('cambia el precio del 7509990000017 a 24');
    await foto(p, 'asistente-codigo');
  }
  if (quiere('asistente-ventas')) {
    await decir('cuánto vendí esta semana');
    await foto(p, 'asistente-ventas');
  }
  if (quiere('asistente-plan')) {
    await decir('sube el precio de las papas fritas sal a 21');
    const plan = p.locator('[data-guide=wybix-plan]').last();
    await plan.locator('[data-guide=wybix-confirmar]').click();
    await espera(2500);
    await foto(p, 'asistente-plan');
  }
}

main();
