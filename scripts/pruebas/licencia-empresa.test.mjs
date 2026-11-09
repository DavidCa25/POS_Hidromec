/**
 * Licencia por empresa (0082): electron/empresas/licencia-empresa.js.
 *
 *     node --test scripts/pruebas/licencia-empresa.test.mjs
 *
 * La base de la instalación la cubre la licencia del equipo; las adicionales
 * ocupan el cupo comprado en el orden en que se vieron, o tienen 30 días de
 * prueba, y después quedan en solo consulta: se ve y se respalda, no se vende.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { crearLicenciaEmpresas, estadoDeBase, soloConsulta, PRUEBA_DIAS } = require('../../electron/empresas/licencia-empresa.js');
const { crearEvaluador } = require('../../electron/licencia/entitlements.js');

const DIA = 86_400_000;
const T0 = Date.parse('2026-11-09T12:00:00Z');
const iso = (ms) => new Date(ms).toISOString();

test('la principal siempre está cubierta; las adicionales ocupan el cupo en el orden en que se vieron', () => {
  const bases = ['Principal', 'B', 'C'];
  const vistas = { C: iso(T0 - 5 * DIA), B: iso(T0 - 1 * DIA) };   // C se vio antes que B
  const e = (base, cupo) => estadoDeBase({ base, principal: 'Principal', bases, cupo, vistas, ahora: T0 }).modo;
  assert.equal(e('Principal', 1), 'PRINCIPAL');
  assert.equal(e('C', 2), 'INCLUIDA', 'una Empresa adicional: la que se vio primero');
  assert.equal(e('B', 2), 'PRUEBA', 'la segunda adicional está en prueba');
  assert.equal(e('B', 3), 'INCLUIDA', 'con dos adicionales, las dos');
});

test('la prueba dura 30 días desde que se vio; después, solo consulta', () => {
  const p = (dias) => estadoDeBase({ base: 'B', principal: 'P', bases: ['P', 'B'], cupo: 1, vistas: { B: iso(T0 - dias * DIA) }, ahora: T0 });
  assert.equal(PRUEBA_DIAS, 30);
  assert.deepEqual([p(0).modo, p(0).diasRestantes], ['PRUEBA', 30]);
  assert.deepEqual([p(29.5).modo, p(29.5).diasRestantes], ['PRUEBA', 1]);
  assert.equal(p(30).modo, 'CONSULTA');
});

test('en solo consulta: reportes, Mis empresas y respaldos sí; vender, cobrar o editar no', () => {
  const ev = soloConsulta(crearEvaluador({ modo: 'ACTIVE', entitlements: ['sales', 'reports', 'backup', 'inventory', 'customers'] }));
  assert.equal(ev.empresaEnConsulta, true);
  assert.equal(ev.permiteCanal('sp-register-sale', 'VENTAS_OPERAR').ok, false);
  assert.equal(ev.permiteCanal('sp-register-sale', 'VENTAS_OPERAR').requiere, 'empresa');
  assert.equal(ev.permiteCanal('sp-open-shift', 'VENTAS_OPERAR').ok, false);
  assert.equal(ev.permiteCanal('inventario:ajustar', 'INVENTARIO_OPERAR').ok, false);
  assert.equal(ev.permiteCanal('sp-get-profit-overview', 'REPORTES_VER').ok, true);
  assert.equal(ev.permiteCanal('empresas:cambiar', 'EMPRESAS_CAMBIAR').ok, true, 'puede salir a otra empresa');
  assert.equal(ev.permiteCanal('backup-run-now', 'CONFIGURACION_ADMINISTRAR').ok, true, 'los datos son del cliente: se respaldan');
  assert.equal(ev.tiene('sales'), false);
  assert.equal(ev.tiene('reports'), true);
  assert.equal(ev.permiteSuperficie('WAITER'), false, 'sin tablets operando');
});

test('el servicio anota cada empresa nueva una sola vez y la fecha más vieja gana', async () => {
  let guardadas = { B: iso(T0 - 40 * DIA) };
  const licencia = {
    estado: () => ({ companiesMax: 1 }),
    evaluador: () => crearEvaluador({ modo: 'ACTIVE', entitlements: ['sales', 'reports'] }),
    empresasVistas: () => ({ ...guardadas }),
    recordarEmpresas: (m) => { guardadas = { ...m, ...guardadas }; },
  };
  let activa = 'B';
  const svc = crearLicenciaEmpresas({
    licencia, basesLocales: async () => ['P', 'B', 'C'], baseActiva: () => activa, principal: () => 'P', ahora: () => T0,
  });
  await svc.refrescar();
  assert.equal(guardadas.C, iso(T0), 'C se vio hoy');
  assert.equal(guardadas.B, iso(T0 - 40 * DIA), 'B conserva su fecha');
  assert.equal(svc.estado().modo, 'CONSULTA', 'B ya gastó su prueba');
  assert.equal(svc.evaluador().permiteCanal('sp-register-sale', 'VENTAS_OPERAR').ok, false);
  activa = 'C';
  assert.equal(svc.estado().modo, 'PRUEBA');
  assert.equal(svc.evaluador().permiteCanal('sp-register-sale', 'VENTAS_OPERAR').ok, true, 'en prueba se opera');
  activa = 'P';
  assert.equal(svc.estado().modo, 'PRINCIPAL');
  assert.deepEqual(Object.keys(svc.resumen().empresas).sort(), ['B', 'C', 'P']);
});

test('comprar una Empresa adicional saca de consulta a la que se vio primero', async () => {
  let cupo = 1;
  const licencia = {
    estado: () => ({ companiesMax: cupo }),
    evaluador: () => crearEvaluador({ modo: 'ACTIVE', entitlements: ['sales'] }),
    empresasVistas: () => ({ B: iso(T0 - 60 * DIA) }),
    recordarEmpresas: () => {},
  };
  const svc = crearLicenciaEmpresas({ licencia, basesLocales: async () => ['P', 'B'], baseActiva: () => 'B', principal: () => 'P', ahora: () => T0 });
  await svc.refrescar();
  assert.equal(svc.estado().modo, 'CONSULTA');
  cupo = 2;
  await svc.refrescar();
  assert.equal(svc.estado().modo, 'INCLUIDA');
});

test('sin lista de bases (SQL caído) no rompe: la activa sigue como estaba', async () => {
  const licencia = { estado: () => ({ companiesMax: 1 }), evaluador: () => crearEvaluador({ modo: 'ACTIVE', entitlements: [] }),
                     empresasVistas: () => ({}), recordarEmpresas: () => {} };
  const svc = crearLicenciaEmpresas({ licencia, basesLocales: async () => { throw new Error('sin SQL'); },
                                     baseActiva: () => 'P', principal: () => 'P', ahora: () => T0 });
  await svc.refrescar();
  assert.equal(svc.estado().modo, 'PRINCIPAL');
});
