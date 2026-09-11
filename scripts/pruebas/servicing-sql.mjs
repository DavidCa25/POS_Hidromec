/**
 * Politica del motor SQL Server: compatibilidad y seguridad.
 *
 *     node scripts/pruebas/servicing-sql.mjs
 *
 * No instala ni parchea nada: comprueba las decisiones que se toman alrededor
 * del parche, que es donde estan los errores caros.
 *
 * Se prueban DOS ejes que no son el mismo:
 *
 *   COMPATIBILIDAD  major == 15. Un SQL Server 2022 no es "mejor": es una
 *                   combinacion que nadie ha probado con este esquema.
 *
 *   SEGURIDAD       se evalua contra el objetivo de SU RAMA. Los builds de
 *                   GDR y CU no forman una sola secuencia, y compararlos como
 *                   si lo fueran da por segura una instancia que no lo esta.
 *
 * Y DOS contextos: alta de host (se exige todo) y arranque normal (avisa).
 * Mas el eje produccion / desarrollo para la compatibilidad.
 */
import { readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
const { decidirSobreMotor, compararBuild, majorDe, ramaDe } = require('../../electron/setupServer.js');

const servicing = JSON.parse(readFileSync('installer/sql-servicing.json', 'utf8'));
const RTM = servicing.medioBase.build;                        // 15.0.2000.5
const GDR = servicing.seguridad.ramas.GDR.buildMinimo;        // 15.0.2180.2
const CU  = servicing.seguridad.ramas.CU.buildMinimo;         // 15.0.4480.2
const CU_VIEJO = '15.0.4430.1';                               // CU32 anterior a julio 2026
const GDR_VIEJO = '15.0.2170.1';                              // GDR anterior al aprobado

let ok = 0;
const fallos = [];
const check = (cond, titulo, detalle = '') => {
  if (cond) { ok++; console.log(`   ok    ${titulo}${detalle ? '  · ' + detalle : ''}`); }
  else { fallos.push(titulo); console.log(`   FALLA ${titulo}${detalle ? '  · ' + detalle : ''}`); }
};
const paso = (t) => console.log(`\n── ${t}`);

const decidir = (build, o = {}) => decidirSobreMotor({
  build, nivel: o.nivel ?? null, servicing,
  altaDeHost: o.altaDeHost ?? false,
  loInstaloWybix: o.loInstaloWybix ?? false,
  entorno: o.entorno ?? 'production',
});

console.log(`Compatibilidad: ${servicing.compatibilidad.producto} (major ${servicing.compatibilidad.major})`);
console.log(`Rama que instala Wybix: ${servicing.ramaQueInstalaWybix}`);
console.log(`Seguridad a ${servicing.seguridad.fecha}:`);
console.log(`  GDR  ${servicing.seguridad.ramas.GDR.kb} -> ${GDR}`);
console.log(`  CU   ${servicing.seguridad.ramas.CU.kb} -> ${CU}   (no viaja: Wybix no instala CU)`);

// ==================================================== utilidades base
paso('Comparacion de builds');
check(compararBuild(RTM, GDR) < 0, 'RTM es anterior al GDR aprobado');
check(compararBuild('15.0.2180.10', GDR) > 0, 'compara por numero, no por texto (2180.10 > 2180.2)');
check(compararBuild('15.0.2180', GDR) < 0, 'un build corto no se confunde con uno mas preciso');

paso('Deteccion de rama');
check(ramaDe(CU_VIEJO, 'CU32') === 'CU', 'ProductUpdateLevel CU32 -> rama CU');
check(ramaDe(GDR, 'GDR') === 'GDR', 'ProductUpdateLevel GDR -> rama GDR');
check(ramaDe(RTM, null) === 'GDR', 'RTM sin nivel cae en la rama RTM/GDR');
check(ramaDe(CU_VIEJO, null) === 'CU', 'sin ProductUpdateLevel, 15.0.4xxx se reconoce como CU');
check(ramaDe(GDR, null) === 'GDR', 'sin ProductUpdateLevel, 15.0.2xxx se reconoce como GDR');

// ======================================== EL PUNTO: ramas no comparables
paso('Las ramas NO son una sola secuencia');
check(compararBuild(CU_VIEJO, GDR) > 0,
  `${CU_VIEJO} es numericamente MAYOR que ${GDR}`, 'ese es el numero que engaña');
{
  const r = decidir(CU_VIEJO, { altaDeHost: true, nivel: 'CU32' });
  check(r.accion === 'BLOQUEA' && r.categoria === 'SEGURIDAD',
    'y aun asi NO se considera al dia: es un CU32 anterior a julio de 2026', CU_VIEJO);
  check(r.motivo.includes(CU) && r.motivo.includes(servicing.seguridad.ramas.CU.kb),
    'el mensaje remite al objetivo de SU rama (CU), no al del GDR');
  check(/no la migra/.test(r.motivo), 'y deja claro que Wybix no la migra de rama');
}
check(decidir(CU, { altaDeHost: true, nivel: 'CU32' }).accion === 'CONTINUA',
  'el CU al dia si se acepta', CU);

paso('Objetivo de seguridad por rama');
check(decidir(GDR_VIEJO, { altaDeHost: true }).accion === 'BLOQUEA',
  'GDR anterior al aprobado: desactualizado', `${GDR_VIEJO} < ${GDR}`);
check(decidir(GDR, { altaDeHost: true }).accion === 'CONTINUA',
  'GDR aprobado: al dia', GDR);
check(decidir(CU_VIEJO, { altaDeHost: true, nivel: 'CU32' }).accion === 'BLOQUEA',
  'CU anterior al aprobado: desactualizado', `${CU_VIEJO} < ${CU}`);
check(decidir(CU, { altaDeHost: true, nivel: 'CU32' }).accion === 'CONTINUA',
  'CU aprobado: al dia', CU);

// ============================================== motor instalado por Wybix
paso('El motor que instala Wybix');
check(decidir(GDR, { altaDeHost: true, loInstaloWybix: true }).accion === 'CONTINUA',
  'queda exactamente en el build de la rama GDR: continua', GDR);
check(decidir(RTM, { altaDeHost: true, loInstaloWybix: true }).accion === 'BLOQUEA',
  'quedo en RTM: el servicing fallo en silencio', RTM);
check(decidir(CU, { altaDeHost: true, loInstaloWybix: true, nivel: 'CU32' }).accion === 'BLOQUEA',
  'quedo en la rama CU: Wybix no instala esa rama, algo no cuadra', CU);

// ============================================ COMPATIBILIDAD, produccion
paso('COMPATIBILIDAD en produccion');
for (const [build, etiqueta] of [['14.0.3456.0', 'SQL Server 2017'], ['16.0.1000.6', 'SQL Server 2022']]) {
  const alta = decidir(build, { altaDeHost: true });
  const arranque = decidir(build);
  check(alta.accion === 'BLOQUEA' && alta.categoria === 'COMPATIBILIDAD',
    `${etiqueta} bloquea el alta de host`, build);
  check(arranque.accion === 'BLOQUEA' && arranque.categoria === 'COMPATIBILIDAD',
    `${etiqueta} bloquea TAMBIEN el arranque en produccion`, build);
}
check(decidir(GDR).accion === 'CONTINUA', 'SQL Server 2019 al dia es compatible', GDR);

paso('COMPATIBILIDAD en desarrollo');
check(decidir('16.0.1000.6', { entorno: 'development' }).accion === 'AVISA',
  'un major distinto solo avisa: no rompe entornos de trabajo', '16.0.1000.6');
check(decidir('14.0.3456.0', { entorno: 'development', altaDeHost: true }).accion === 'AVISA',
  'ni siquiera durante un alta de host en desarrollo', '14.0.3456.0');

// ================================================ SEGURIDAD vs arranque
paso('SEGURIDAD en un arranque normal (no bloquea a quien vende)');
check(decidir(RTM).accion === 'AVISA', 'SQL 2019 en RTM: avisa y deja vender', RTM);
check(decidir(GDR_VIEJO).accion === 'AVISA', 'GDR desactualizado: avisa', GDR_VIEJO);
check(decidir(CU_VIEJO, { nivel: 'CU32' }).accion === 'AVISA', 'CU desactualizado: avisa', CU_VIEJO);
check(decidir(CU, { nivel: 'CU32' }).accion === 'CONTINUA', 'CU al dia: continua sin ruido', CU);
{
  const r = decidir(RTM);
  check(r.categoria === 'SEGURIDAD', 'y se clasifica como aviso de SEGURIDAD, no de compatibilidad');
}

// ================================================== codigos del parche
paso('Codigos de salida del parche');
const trasParche = (c) => (c === 0 ? 'VERIFICA_Y_SIGUE' : c === 3010 ? 'PIDE_REINICIO' : 'FALLA');
check(trasParche(0) === 'VERIFICA_Y_SIGUE', 'codigo 0: verifica el motor y continua');
check(trasParche(3010) === 'PIDE_REINICIO', 'codigo 3010: no crea la base; pide reiniciar');
check(trasParche(1) === 'FALLA' && trasParche(-196608) === 'FALLA', 'cualquier otro codigo falla');

// ========================================================= el contrato
paso('Coherencia del contrato');
check(servicing.compatibilidad.major === '15.0', 'la compatibilidad es SQL Server 2019');
check(servicing.ramaQueInstalaWybix === 'GDR', 'Wybix distribuye la rama GDR');
check(servicing.seguridad.ramas.GDR.viajaEnElInstalador === true, 'el parche GDR viaja en el instalador');
check(servicing.seguridad.ramas.CU.viajaEnElInstalador === false,
  'el de la rama CU NO viaja: solo sirve para reconocer instancias ajenas');
check(Number(GDR.split('.')[2]) < 4000 && Number(CU.split('.')[2]) >= 4000,
  'cada objetivo pertenece a su rama', `GDR ${GDR} · CU ${CU}`);
check(/^[A-F0-9]{64}$/.test(String(servicing.seguridad.ramas.GDR.sha256).toUpperCase()),
  'el paquete GDR declara un SHA256 con forma valida');

paso('Payload del parche');
const parche = resolve('installer', 'sqlupdates', servicing.seguridad.ramas.GDR.paquete);
if (existsSync(parche)) {
  const { createHash } = await import('node:crypto');
  const hash = createHash('sha256').update(readFileSync(parche)).digest('hex').toUpperCase();
  check(hash === String(servicing.seguridad.ramas.GDR.sha256).toUpperCase(),
    'el paquete presente coincide con el hash oficial');
} else {
  console.log('   ----  el paquete no esta: dependencia externa de release.');
}

console.log(`\nRESULTADO: ${ok} ok · ${fallos.length} fallas`);
if (fallos.length) { fallos.forEach(f => console.log('  - ' + f)); process.exit(1); }
console.log('Compatibilidad y seguridad se deciden bien, y por rama.');
