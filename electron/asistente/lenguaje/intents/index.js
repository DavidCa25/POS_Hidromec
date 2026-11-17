'use strict';
/**
 * LO QUE WYBIX SABE HACER, como datos, por área del negocio.
 *
 * Cada intent declara:
 *   etiqueta   cómo se ofrece en «¿quisiste decir…?»
 *   tipo       consulta (responde, no escribe) · accion (plan + Confirmar)
 *              · pantalla (lleva a la pantalla que ya lo hace, prellenada)
 *   modulo     opcional: solo existe si el negocio lo tiene encendido
 *              (hospitality, servicios, loyalty, asistencia). Sin módulo,
 *              vale para todos los giros.
 *   slots      qué datos necesita; `requerido` se pregunta si falta.
 *              `filtros`: acepta filtros combinados (días, horas, forma de
 *              pago, categoría, cajero, fechas): lenguaje/filtros.js
 *   analitica  opcional: con filtros, la responde el cubo (analitica/) en
 *              vez de su consulta fija: { medida, agrupar, orden }
 *   claves     palabras que lo delatan (refuerzan al clasificador)
 *   ejemplos   plantillas cortas. El grueso del entrenamiento son las
 *              frases completas de lenguaje/frases/*.txt.
 *
 * Plantillas: {prod} {n} {precio} {fecha} {nuevo} {persona} {monto} {hora}
 * {folio} {mesa} {periodo}.
 *
 * Agregar un intent: un objeto en el área que toca, su respuesta en
 * electron/asistente/acciones/<área>.js y sus frases en frases/<área>.txt.
 * El motor no cambia.
 */
const AREAS = ['general', 'venta', 'caja', 'inventario', 'compras', 'proveedores', 'clientes', 'gastos', 'finanzas',
               'facturacion', 'personal', 'hospitality', 'servicios', 'sistema', 'analisis'];

const INTENTS = AREAS.flatMap((area) => require(`./${area}`).map((i) => ({ area, ...i })));

const ids = new Set();
for (const i of INTENTS) {
  if (ids.has(i.id)) throw new Error(`intent repetido: ${i.id}`);
  ids.add(i.id);
}

const { DESTINOS } = require('./destinos');
const porId = (id) => INTENTS.find((i) => i.id === id) || null;

/** ¿Este negocio tiene el intent? (módulos encendidos). */
const disponible = (intent, modulos) => {
  const i = typeof intent === 'string' ? porId(intent) : intent;
  return !!i && (!i.modulo || !modulos || modulos.has(i.modulo));
};

module.exports = { INTENTS, AREAS, DESTINOS, porId, disponible };
