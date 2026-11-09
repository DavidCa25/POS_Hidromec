/**
 * MultiEmpresa en el proceso principal (electron/empresas/, nube/grupo-empresas.js).
 *
 *     node --test scripts/pruebas/empresas.test.mjs
 *
 * Sin Electron y sin SQL Server: cada módulo recibe sus dependencias. Lo que
 * importa de verdad aquí es que un cambio de empresa NUNCA deje la caja a
 * medias, que los archivos de una empresa no se mezclen con los de otra y que
 * un pedido de otra empresa se aplique una sola vez.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

const require = createRequire(import.meta.url);
const { crearAmbito } = require('../../electron/empresas/ambito.js');
const { crearCiclo, SERVICIOS_CONOCIDOS, MEMORIAS_CONOCIDAS } = require('../../electron/empresas/ciclo.js');
const { crearCambio } = require('../../electron/empresas/cambio.js');
const { crearAlta, sufijoDeBase, validar } = require('../../electron/empresas/alta.js');
const { crearLocales, corchetes } = require('../../electron/empresas/locales.js');
const { crearRemotas } = require('../../electron/empresas/remotas.js');
const { crearGrupoEmpresas, normalizarDatos } = require('../../electron/nube/grupo-empresas.js');

/* ------------------------------------------------------------- ámbito */

function ambitoDePrueba(activa = 'Wybix_POS', instalada = 'Wybix_POS') {
  const dir = mkdtempSync(join(tmpdir(), 'wx-ambito-'));
  const estado = { activa, instalada };
  const a = crearAmbito({ userData: () => dir, baseActiva: () => estado.activa, baseDeInstalacion: () => estado.instalada });
  return { a, dir, estado };
}

test('ámbito: la empresa de la instalación conserva sus rutas de siempre', () => {
  const { a, dir } = ambitoDePrueba();
  assert.equal(a.ruta('device-config.json'), join(dir, 'device-config.json'));
  assert.equal(a.ruta('cloud-config.json'), join(dir, 'cloud-config.json'));
});

test('ámbito: otra empresa tiene su carpeta y cambia en cuanto cambia la base', () => {
  const { a, dir, estado } = ambitoDePrueba();
  estado.activa = 'Wybix_POS_LosPachoncitos';
  assert.equal(a.ruta('device-config.json'), join(dir, 'empresas', 'Wybix_POS_LosPachoncitos', 'device-config.json'));
  estado.activa = 'wybix_pos';   // SQL Server no distingue mayúsculas en el nombre de la base
  assert.equal(a.ruta('device-config.json'), join(dir, 'device-config.json'));
});

test('ámbito: sin base de instalación anotada (caja de antes), todo queda donde estaba', () => {
  const { a, dir, estado } = ambitoDePrueba('Otra', null);
  assert.equal(a.ruta('mp-config.json'), join(dir, 'mp-config.json'));
  estado.activa = null;
  assert.equal(a.ruta('mp-config.json'), join(dir, 'mp-config.json'));
});

test('ámbito: un archivo del equipo no se puede pedir como de empresa', () => {
  const { a } = ambitoDePrueba();
  assert.throws(() => a.ruta('license.json'), /no es un archivo de empresa/);
  assert.throws(() => a.ruta('db-config.json'), /no es un archivo de empresa/);
});

test('ámbito: un nombre de base no escapa de la carpeta de empresas', () => {
  const { a, dir, estado } = ambitoDePrueba();
  estado.activa = '..\\..\\Windows';
  const r = a.ruta('device-config.json');
  assert.ok(r.startsWith(join(dir, 'empresas')), r);
});

test('ámbito: la empresa nueva hereda impresora y cajón, nunca la caja', () => {
  const { a, dir } = ambitoDePrueba();
  writeFileSync(join(dir, 'device-config.json'), JSON.stringify({ register: { id: 1 }, drawer: { pin: 0 }, printer: { name: 'EPSON' } }));
  writeFileSync(join(dir, 'backup-config.json'), JSON.stringify({ enabled: true, time: '22:00', folder: 'D:\\R', lastBackupAt: 'ayer', lastStatus: 'ok' }));
  assert.equal(a.heredarEquipo('Wybix_POS', 'Wybix_POS_B'), true);
  const nueva = JSON.parse(readFileSync(join(dir, 'empresas', 'Wybix_POS_B', 'device-config.json'), 'utf8'));
  assert.deepEqual(nueva, { drawer: { pin: 0 }, printer: { name: 'EPSON' } });
  const respaldo = JSON.parse(readFileSync(join(dir, 'empresas', 'Wybix_POS_B', 'backup-config.json'), 'utf8'));
  assert.deepEqual(respaldo, { enabled: true, time: '22:00', folder: 'D:\\R' }, 'se respalda igual, sin heredar el último respaldo');
  assert.equal(a.heredarEquipo('Wybix_POS', 'Wybix_POS_B'), false, 'no pisa lo que ya configuró');
  assert.equal(existsSync(join(dir, 'empresas', 'Wybix_POS_B', 'cloud-config.json')), false, 'la credencial de la nube no se copia');
});

/* -------------------------------------------------------------- ciclo */

function cicloConDiario() {
  const diario = [];
  const c = crearCiclo();
  for (const n of SERVICIOS_CONOCIDOS) {
    c.registrarServicio(n, { iniciar: async () => diario.push(`+${n}`), detener: async () => diario.push(`-${n}`) });
  }
  for (const n of MEMORIAS_CONOCIDAS) c.registrarMemoria(n, () => diario.push(`?${n}`));
  return { c, diario };
}

test('ciclo: inicia en orden, detiene al revés y olvida todo', async () => {
  const { c, diario } = cicloConDiario();
  await c.iniciarTodo();
  await c.detenerTodo();
  c.olvidarTodo();
  assert.deepEqual(diario, [
    ...SERVICIOS_CONOCIDOS.map(n => `+${n}`),
    ...[...SERVICIOS_CONOCIDOS].reverse().map(n => `-${n}`),
    ...MEMORIAS_CONOCIDAS.map(n => `?${n}`),
  ]);
  assert.deepEqual(c.faltantes(), []);
});

test('ciclo: un servicio que falla al detenerse no deja a los demás corriendo', async () => {
  const c = crearCiclo();
  const detenidos = [];
  c.registrarServicio('a', { iniciar() {}, detener() { detenidos.push('a'); } });
  c.registrarServicio('b', { iniciar() {}, detener() { throw new Error('atorado'); } });
  c.registrarServicio('c', { iniciar() {}, detener() { detenidos.push('c'); } });
  const errores = await c.detenerTodo();
  assert.deepEqual(detenidos, ['c', 'a']);
  assert.equal(errores.length, 1);
  assert.equal(errores[0].nombre, 'b');
});

test('ciclo: dice qué servicio o memoria conocida nadie registró', () => {
  const c = crearCiclo();
  c.registrarServicio('nube', { iniciar() {}, detener() {} });
  const f = c.faltantes();
  assert.ok(f.includes('servicio caja-arrendada'));
  assert.ok(f.includes('memoria negocio'));
  assert.ok(!f.includes('servicio nube'));
});

test('ciclo: no se registra dos veces lo mismo ni algo a medias', () => {
  const c = crearCiclo();
  c.registrarServicio('x', { iniciar() {}, detener() {} });
  assert.throws(() => c.registrarServicio('x', { iniciar() {}, detener() {} }), /repetido/);
  assert.throws(() => c.registrarServicio('y', { iniciar() {} }), /iniciar y detener/);
  assert.throws(() => c.registrarMemoria('z'), /olvidar/);
});

test('ciclo: main.js registra todo lo conocido (no se olvida uno al editarlo)', () => {
  const main = readFileSync(new URL('../../electron/main.js', import.meta.url), 'utf8');
  for (const n of SERVICIOS_CONOCIDOS) assert.match(main, new RegExp(`registrarServicio\\('${n}'`), `servicio ${n}`);
  for (const n of MEMORIAS_CONOCIDAS) assert.match(main, new RegExp(`registrarMemoria\\('${n}'`), `memoria ${n}`);
});

/* ------------------------------------------------------------- cambio */

function escenarioCambio({ empresas, falla = {} } = {}) {
  const { c, diario } = cicloConDiario();
  const estado = { base: 'Wybix_POS', sesion: { base: 'Wybix_POS', usuario: 'david' }, recargas: 0 };
  const lista = empresas ?? [
    { base: 'Wybix_POS', nombre: 'B&J Super', user_id: 1, rol: 'admin', esEsta: true },
    { base: 'Wybix_POS_LosPachoncitos', nombre: 'Los Pachoncitos', user_id: 4, rol: 'admin', esEsta: false },
  ];
  const cambio = crearCambio({
    ciclo: c,
    baseActiva: () => estado.base,
    empresasPara: async () => lista,
    conectar: async (b) => { if (falla.conectar === b) throw new Error('sin conexión'); estado.base = b; },
    prepararBase: async () => { if (falla.preparar === estado.base) throw Object.assign(new Error('faltan objetos'), { code: 'MISSING_OBJECTS' }); },
    abrirSesion: async (_wc, b, u) => { if (falla.sesion === b) throw new Error('sin usuario'); estado.sesion = { base: b, usuario: u }; },
    puedeCambiar: async (d) => d.rol === 'admin' || d.puede === true,
    recargar: () => { estado.recargas++; },
  });
  return { cambio, estado, diario };
}

test('cambio: entra a la otra empresa con su sesión, reinicia servicios y recarga', async () => {
  const { cambio, estado, diario } = escenarioCambio();
  const r = await cambio.cambiar({ webContentsId: 1, base: 'Wybix_POS_LosPachoncitos', usuario: 'david' });
  const { ms, fases, ...resto } = r;
  assert.deepEqual(resto, { cambiada: true, base: 'Wybix_POS_LosPachoncitos', nombre: 'Los Pachoncitos' });
  assert.ok(Number.isFinite(ms), 'dice cuánto tardó');
  assert.deepEqual(Object.keys(fases), ['validar', 'detener', 'conectar', 'preparar', 'sesion', 'iniciar', 'recargar'], 'y en qué fase');
  assert.equal(estado.base, 'Wybix_POS_LosPachoncitos');
  assert.deepEqual(estado.sesion, { base: 'Wybix_POS_LosPachoncitos', usuario: 'david' });
  assert.equal(estado.recargas, 1);
  const detener = diario.findIndex(x => x.startsWith('-'));
  const olvidar = diario.findIndex(x => x.startsWith('?'));
  const iniciar = diario.findIndex(x => x.startsWith('+'));
  assert.ok(detener < olvidar && olvidar < iniciar, diario.join(' '));
});

test('cambio: a la misma empresa no hace nada', async () => {
  const { cambio, diario, estado } = escenarioCambio();
  assert.deepEqual(await cambio.cambiar({ webContentsId: 1, base: 'wybix_pos', usuario: 'david' }), { cambiada: false, base: 'Wybix_POS' });
  assert.equal(diario.length, 0);
  assert.equal(estado.recargas, 0);
});

test('cambio: se rechaza ANTES de tocar nada si la empresa no es del grupo o no hay usuario', async () => {
  const sinUsuario = escenarioCambio({ empresas: [
    { base: 'Wybix_POS', nombre: 'A', user_id: 1, rol: 'admin', esEsta: true },
    { base: 'Otra', nombre: 'Otra', user_id: null, rol: null, esEsta: false },
  ] });
  await assert.rejects(sinUsuario.cambio.cambiar({ webContentsId: 1, base: 'Ajena', usuario: 'david' }), { code: 'NOT_IN_GROUP' });
  await assert.rejects(sinUsuario.cambio.cambiar({ webContentsId: 1, base: 'Otra', usuario: 'david' }), { code: 'NO_USER' });
  assert.equal(sinUsuario.diario.length, 0, 'ningún servicio se detuvo');
  assert.equal(sinUsuario.estado.base, 'Wybix_POS');
});

test('cambio: sin permiso de cambiar en la otra empresa no entra (no quedaría atrapado)', async () => {
  const { cambio, diario } = escenarioCambio({ empresas: [
    { base: 'Wybix_POS', nombre: 'A', user_id: 1, rol: 'admin', esEsta: true },
    { base: 'B', nombre: 'B', user_id: 9, rol: 'cajero', esEsta: false },
  ] });
  await assert.rejects(cambio.cambiar({ webContentsId: 1, base: 'B', usuario: 'ana' }), { code: 'DENIED' });
  assert.equal(diario.length, 0);
});

test('cambio: si la otra base falla, vuelve a la anterior con su sesión y sus servicios', async () => {
  for (const falla of [{ preparar: 'Wybix_POS_LosPachoncitos' }, { sesion: 'Wybix_POS_LosPachoncitos' }, { conectar: 'Wybix_POS_LosPachoncitos' }]) {
    const { cambio, estado, diario } = escenarioCambio({ falla });
    await assert.rejects(cambio.cambiar({ webContentsId: 1, base: 'Wybix_POS_LosPachoncitos', usuario: 'david' }), /No se pudo abrir Los Pachoncitos/);
    assert.equal(estado.base, 'Wybix_POS', JSON.stringify(falla));
    assert.deepEqual(estado.sesion, { base: 'Wybix_POS', usuario: 'david' });
    assert.equal(estado.recargas, 0);
    assert.equal(diario.filter(x => x.startsWith('+')).length, SERVICIOS_CONOCIDOS.length, 'los servicios se vuelven a iniciar');
  }
});

test('cambio: un segundo pedido mientras trabaja el primero se rechaza', async () => {
  const { cambio } = escenarioCambio();
  const primero = cambio.cambiar({ webContentsId: 1, base: 'Wybix_POS_LosPachoncitos', usuario: 'david' });
  await assert.rejects(cambio.cambiar({ webContentsId: 1, base: 'Wybix_POS_LosPachoncitos', usuario: 'david' }), { code: 'BUSY' });
  await primero;
  // Terminado el primero, se puede volver.
  const r = await cambio.cambiar({ webContentsId: 1, base: 'Wybix_POS', usuario: 'david' });
  assert.equal(r.cambiada, true);
});

/* --------------------------------------------------------------- alta */

test('alta: el nombre de la base sale del nombre, sin acentos ni símbolos', () => {
  assert.equal(sufijoDeBase('Los Pachoncitos'), 'LosPachoncitos');
  assert.equal(sufijoDeBase('Birrialtlán & Co.'), 'BirrialtlanCo');
  assert.throws(() => sufijoDeBase('¡¡!!'), /al menos una letra/);
});

test('alta: valida nombre, giro y RFC', () => {
  assert.deepEqual(validar({ nombre: ' Los Pachoncitos ', giro: 'hospitality' }), { nombre: 'Los Pachoncitos', giro: 'HOSPITALITY', rfc: null });
  assert.throws(() => validar({ nombre: 'A' }), { code: 'BAD_NAME' });
  assert.throws(() => validar({ nombre: 'Tienda', giro: 'BANCO' }), { code: 'BAD_PROFILE' });
  assert.throws(() => validar({ nombre: 'Tienda', rfc: '123' }), { code: 'BAD_RFC' });
  assert.equal(validar({ nombre: 'Tienda', rfc: 'xaxx010101000' }).rfc, 'XAXX010101000');
});

/** Un SQL de mentira que contesta lo que alta.js pregunta. */
function sqlFalso({ existentes = [], fallarEn = null } = {}) {
  const ejecutados = [];
  const request = (donde) => {
    const inputs = {};
    const r = {
      input(n, _t, v) { inputs[n] = v; return r; },
      async query(q) {
        ejecutados.push({ donde, q: q.trim().slice(0, 60), inputs: { ...inputs } });
        if (fallarEn && q.includes(fallarEn)) throw new Error(`falla en ${fallarEn}`);
        if (q.includes('SELECT DB_ID(@n)')) return { recordset: [{ id: existentes.includes(inputs.n) ? 9 : null }] };
        if (q.includes('FROM dbo.users WHERE usuario = @u AND active = 1')) return { recordset: [{ usuario: 'david', password_hash: 'scrypt$hash' }] };
        if (q.includes('sys.database_role_members')) return { recordset: [{ name: 'ocus_app' }] };
        return { recordset: [] };
      },
      async batch(q) { ejecutados.push({ donde, q: q.trim() }); return {}; },
      async execute(p) {
        ejecutados.push({ donde, q: `EXEC ${p}`, inputs: { ...inputs } });
        if (fallarEn && p === fallarEn) throw new Error(`falla en ${p}`);
        if (p === 'sp_empresas_grupo') return { recordset: [{ grupo: donde === 'actual' ? null : null }] };
        return { recordset: [] };
      },
    };
    return r;
  };
  const pool = (donde) => ({ request: () => request(donde), async close() { ejecutados.push({ donde, q: 'CLOSE' }); } });
  return { ejecutados, pool };
}

function altaDePrueba(opc = {}) {
  const f = sqlFalso(opc);
  const restauradas = [];
  const membresias = [];
  const alta = crearAlta({
    grupoActual: async () => opc.grupo ?? { grupo: null, base: 'Wybix_POS', bases: [] },
    escribirGrupo: async (grupo, bases, { en = bases } = {}) => { membresias.push({ grupo, bases, en }); },
    sql: { NVarChar: () => 'nv', UniqueIdentifier: 'uid' },
    poolActual: async () => f.pool('actual'),
    servidor: () => '.\\SQLEXPRESS',
    esServidorLocal: () => opc.local !== false,
    conectarMaster: async () => f.pool('master'),
    conectarBase: async (_s, b) => f.pool(b),
    restaurarPlantilla: async (_m, b) => { restauradas.push(b); },
    asegurarPermisos: async () => {},
    migrar: async () => { if (opc.fallarMigrar) throw new Error('migración rota'); },
  });
  return { alta, ...f, restauradas, membresias };
}

test('alta: crea la base, el negocio con el MISMO administrador y el grupo en las dos', async () => {
  const { alta, ejecutados, restauradas, membresias } = altaDePrueba({ existentes: ['Wybix_POS_LosPachoncitos'] });
  const r = await alta.crear({ nombre: 'Los Pachoncitos', giro: 'RETAIL', usuario: 'david' });
  assert.equal(r.base, 'Wybix_POS_LosPachoncitos_2', 'el nombre ocupado se salta');
  assert.deepEqual(restauradas, ['Wybix_POS_LosPachoncitos_2']);
  const enNueva = ejecutados.filter(x => x.donde === r.base);
  assert.ok(enNueva.some(x => x.q === 'EXEC sp_setup_inicial' && x.inputs.usuario === 'david' && x.inputs.business_name === 'Los Pachoncitos'));
  assert.ok(enNueva.some(x => x.q.startsWith('UPDATE dbo.users SET password_hash') && x.inputs.h === 'scrypt$hash'), 'entra con su contraseña de siempre');
  assert.ok(enNueva.some(x => x.q.includes('CREATE USER') || x.q.includes('DECLARE @q')), 'el usuario de red de las secundarias tiene acceso');
  assert.deepEqual(membresias, [{ grupo: r.grupo, bases: ['Wybix_POS', r.base], en: [r.base, 'Wybix_POS'] }],
    'las dos bases quedan en el grupo, la nueva primero');
  assert.ok(r.grupo && /^[0-9a-f-]{36}$/.test(r.grupo));
  assert.ok(ejecutados.some(x => x.donde === 'master' && x.q.includes(`ALTER DATABASE [${r.base}] SET AUTO_CLOSE OFF`)), 'y se quedan abiertas');
});

test('alta: en un grupo que ya existe, la nueva entra a la lista de TODOS los miembros', async () => {
  const grupo = randomUUID();
  const { alta, membresias } = altaDePrueba({ grupo: { grupo, base: 'Wybix_POS', bases: ['Wybix_POS', 'Wybix_POS_A'] } });
  const r = await alta.crear({ nombre: 'Tercera', usuario: 'david' });
  assert.equal(r.grupo, grupo);
  assert.deepEqual(membresias, [{ grupo, bases: ['Wybix_POS', 'Wybix_POS_A', r.base], en: [r.base, 'Wybix_POS', 'Wybix_POS_A'] }]);
});

test('alta: solo en la computadora que tiene SQL Server', async () => {
  const { alta, restauradas } = altaDePrueba({ local: false });
  await assert.rejects(alta.crear({ nombre: 'Otra', usuario: 'david' }), { code: 'NOT_PRIMARY' });
  assert.equal(restauradas.length, 0);
});

test('alta: si algo falla después de restaurar, la base a medias se borra', async () => {
  const { alta, ejecutados, membresias } = altaDePrueba({ fallarMigrar: true });
  await assert.rejects(alta.crear({ nombre: 'Rota', usuario: 'david' }), { code: 'CREATE_FAILED' });
  assert.ok(ejecutados.some(x => x.donde === 'master' && x.q.startsWith("IF DB_ID(N'Wybix_POS_Rota') IS NOT NULL")),
    ejecutados.map(x => x.q).join(' | '));
  assert.equal(membresias.length, 0, 'no llegó a tocar el grupo');
});

/* ------------------------------------------------------------ locales */

function localesDePrueba({ resumenFalla = [] } = {}) {
  const consultas = [];
  const filas = [
    { base: 'Wybix_POS', nombre: 'B&J Super', giro: 'RETAIL', user_id: 1, rol: 'admin', instance_uuid: 'AAA', es_esta: 1 },
    { base: 'Wybix_POS_LosPachoncitos', nombre: 'Los Pachoncitos', giro: 'HOSPITALITY', user_id: 3, rol: 'admin', instance_uuid: 'bbb', es_esta: 0 },
    { base: 'Wybix_POS_SinMi', nombre: 'Sin mí', giro: 'RETAIL', user_id: null, rol: null, instance_uuid: null, es_esta: 0 },
  ];
  const request = () => {
    const r = { input() { return r; },
      async execute(p) { consultas.push(p); return { recordset: filas }; },
      async query(q) {
        consultas.push(q);
        const base = filas.find(f => q.includes(corchetes(f.base)));
        if (base && resumenFalla.includes(base.base)) throw new Error('offline');
        if (q.includes('sp_empresas_resumen')) return { recordset: [{ ventas: '100.50', tickets: 3, utilidad: '40', turnos_abiertos: 1, efectivo_en_caja: '600', ultima_venta: null }] };
        if (q.includes('user_permissions')) return { recordset: [{ permiso: 'EMPRESAS_CAMBIAR' }] };
        return { recordset: [] };
      } };
    return r;
  };
  const locales = crearLocales({ sql: { NVarChar: () => 'nv', Date: 'd', Int: 'i', UniqueIdentifier: 'u', ConnectionPool: class {} },
    pool: async () => ({ request, config: {} }), migrar: async () => {} });
  return { locales, consultas };
}

test('locales: lista con la identidad en la nube en minúsculas', async () => {
  const { locales } = localesDePrueba();
  const l = await locales.listar('david');
  assert.equal(l.length, 3);
  assert.deepEqual(l.map(e => e.instancia), ['aaa', 'bbb', null]);
  assert.equal(l[0].esEsta, true);
});

test('locales: Mis empresas solo trae las empresas donde la persona existe, y una que falla no tumba a las demás', async () => {
  const { locales } = localesDePrueba({ resumenFalla: ['Wybix_POS_LosPachoncitos'] });
  const r = await locales.resumen({ desde: '2026-11-07', hasta: '2026-11-07' }, 'david');
  assert.deepEqual(r.map(x => x.base), ['Wybix_POS', 'Wybix_POS_LosPachoncitos']);
  assert.equal(r[0].ventas, 100.5);
  assert.equal(r[0].error, null);
  assert.equal(r[1].error, 'No respondió.');
  assert.equal(r[1].ventas, 0);
});

test('locales: un nombre de base con corchete no rompe la consulta', () => {
  assert.equal(corchetes('a]b'), '[a]]b]');
});

/* ------------------------------------------------------------ remotas */

test('remotas: una empresa que es local no aparece también como remota', async () => {
  const remotas = crearRemotas({
    cloudSync: { grupo: { listar: async () => [
      { companyId: '1', nombre: 'Los Pachoncitos', instancias: ['bbb'] },
      { companyId: '2', nombre: 'Birrialtlan', instancias: ['zzz'] },
    ] } },
    locales: { listar: async () => [{ base: 'Wybix_POS', instancia: 'aaa' }, { base: 'Wybix_POS_LosPachoncitos', instancia: 'bbb' }] },
  });
  assert.deepEqual((await remotas.listar()).map(e => e.nombre), ['Birrialtlan']);
});

test('remotas: el resumen de una que no responde lleva su error', async () => {
  const remotas = crearRemotas({
    cloudSync: { grupo: {
      listar: async () => [{ companyId: '2', nombre: 'Birrialtlan', instancias: [] }, { companyId: '3', nombre: 'Otra', instancias: [] }],
      resumen: async (id) => { if (id === '3') throw new Error('No hay conexión'); return { companyId: id, ventas: 10 }; },
    } },
    locales: { listar: async () => [] },
  });
  const r = await remotas.resumen({});
  assert.equal(r[0].ventas, 10);
  assert.equal(r[1].error, 'No hay conexión');
});

/* ------------------------------------------------------ grupo (nube) */

function grupoDePrueba({ disponible = true, comandos = [], aplicar } = {}) {
  const llamadas = [];
  const aplicados = [];
  const pool = async () => ({ request: () => {
    const inputs = {};
    const r = { input(n, _t, v) { inputs[n] = v; return r; },
      async execute() { aplicados.push({ ...inputs }); return { recordset: [aplicar ? aplicar(inputs) : { resultado: 'APLICADO', detalle: 'ok' }] }; } };
    return r;
  } });
  const g = crearGrupoEmpresas({
    pool, sql: { UniqueIdentifier: 'u', NVarChar: () => 'nv', MAX: 'max' },
    llamar: async (action, cuerpo) => { llamadas.push({ action, cuerpo }); if (action === 'grupo_bandeja') return { comandos };
      if (action === 'grupo_comando_resultado' && cuerpo.id === 'cae-la-red') throw new Error('OFFLINE'); return { ok: true }; },
    disponible: async () => disponible,
  });
  return { g, llamadas, aplicados };
}

test('grupo: sin nube lo dice con su código, y la bandeja no hace nada', async () => {
  const { g, llamadas } = grupoDePrueba({ disponible: false });
  await assert.rejects(g.listar(), { code: 'NO_CLOUD' });
  assert.deepEqual(await g.atenderBandeja(), { atendidos: 0 });
  assert.equal(llamadas.length, 0);
});

test('grupo: el código se manda limpio y se valida su largo', async () => {
  const { g, llamadas } = grupoDePrueba();
  await g.unir('lxpv-ubd2 7efy');
  assert.deepEqual(llamadas.at(-1), { action: 'grupo_unir', cuerpo: { code: 'LXPVUBD27EFY' } });
  await assert.rejects(g.unir('ABC'), { code: 'BAD_CODE' });
});

test('grupo: un pedido se normaliza y exige su clave de reintento', async () => {
  const { g, llamadas } = grupoDePrueba();
  const id = randomUUID(), clave = randomUUID(), prod = randomUUID();
  await g.pedir({ companyId: id, tipo: 'PRODUCTO_PRECIO', datos: { productUuid: prod.toUpperCase(), precio: '38.555' }, claveCliente: clave, usuario: 'david' });
  assert.deepEqual(llamadas.at(-1).cuerpo, { company_id: id, kind: 'PRODUCTO_PRECIO', payload: { product_uuid: prod, nombre: null, precio: 38.56 }, client_key: clave, requested_by: 'david' });
  await assert.rejects(g.pedir({ companyId: id, tipo: 'PRODUCTO_PRECIO', datos: { productUuid: prod, precio: 1 } }), /clave del pedido/);
  await assert.rejects(g.pedir({ companyId: id, tipo: 'BORRAR', datos: {}, claveCliente: clave }), { code: 'BAD_REQUEST' });
  assert.throws(() => normalizarDatos('PRODUCTO_ALTA', { nombre: 'X', precio: 5 }), /nombre del producto/);
  assert.throws(() => normalizarDatos('PRODUCTO_ALTA', { nombre: 'Taco', precio: -1 }), /precio válido/);
  assert.deepEqual(normalizarDatos('PRODUCTO_ALTA', { nombre: ' Taco ', precio: 20, codigo: '', categoria: ' Tacos ' }), { nombre: 'Taco', precio: 20, codigo: null, categoria: 'Tacos' });
});

test('grupo: la bandeja aplica cada pedido y responde; uno que falla no detiene a los demás', async () => {
  const comandos = [
    { id: 'a', kind: 'PRODUCTO_PRECIO', payload: { precio: 1 }, empresa: 'I Do Nut', requested_by: 'david' },
    { id: 'cae-la-red', kind: 'PRODUCTO_ALTA', payload: { nombre: 'X', precio: 2 }, empresa: 'I Do Nut' },
    { id: 'c', kind: 'PRODUCTO_ALTA', payload: { nombre: 'Y', precio: 3 }, empresa: 'I Do Nut' },
  ];
  const { g, llamadas, aplicados } = grupoDePrueba({ comandos, aplicar: (i) => (i.comando_id === 'c' ? { resultado: 'RECHAZADO', detalle: 'Ya hay un producto con ese nombre.' } : { resultado: 'APLICADO', detalle: 'ok' }) });
  const r = await g.atenderBandeja();
  assert.equal(r.atendidos, 2);
  assert.deepEqual(aplicados.map(x => x.comando_id), ['a', 'cae-la-red', 'c']);
  const respuestas = llamadas.filter(x => x.action === 'grupo_comando_resultado').map(x => x.cuerpo);
  assert.deepEqual(respuestas, [
    { id: 'a', ok: true, detail: 'ok' },
    { id: 'cae-la-red', ok: true, detail: 'ok' },
    { id: 'c', ok: false, detail: 'Ya hay un producto con ese nombre.' },
  ]);
});

/* ---------------------------------------------------------------- IPC */
const { manejar } = require('../../electron/ipc/empresas.js');

test('ipc: sin payload la sesión llega como último argumento y no se confunde con el payload', async () => {
  const ses = { usuario: 'david', permisos: new Set() };
  const eco = manejar(({ p, s }) => ({ p, s: s.usuario }));
  assert.deepEqual(await eco({ sender: { id: 1 } }, ses), { success: true, data: { p: {}, s: 'david' } });
  assert.deepEqual(await eco({ sender: { id: 1 } }, { base: 'X' }, ses), { success: true, data: { p: { base: 'X' }, s: 'david' } });
});

test('ipc: un error sale con su código y su mensaje, nunca con un stack', async () => {
  const falla = manejar(() => { throw Object.assign(new Error('Tu usuario no existe en B.'), { code: 'NO_USER' }); });
  assert.deepEqual(await falla({}, {}), { success: false, code: 'NO_USER', error: 'Tu usuario no existe en B.' });
});
