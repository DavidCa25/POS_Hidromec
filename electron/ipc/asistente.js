'use strict';
/*
 * WYBIX, ASISTENTE OPERATIVO. docs/arquitectura/asistente-operativo.md
 *
 *   asistente:resumen     cuántos pendientes y el más urgente (la mascota del dock)
 *   asistente:hallazgos   la lista, filtrada por los permisos de la sesión
 *   asistente:historial   la conversación de esta persona
 *   asistente:enviar      { texto } o { accion: { intent, params, etiqueta } } → mensajes
 *   asistente:resultado   la pantalla ejecutó (o no) un plan: se cierra y se audita
 *   asistente:evaluar     revisar el negocio ahora
 *   asistente:entender    lo que va entendiendo mientras se escribe (no responde ni guarda)
 *   asistente:alias       guarda u olvida un apodo («la roja» = Coca 600); lo
 *                         llama la tarjeta de Confirmar, como cualquier plan
 *   asistente:voz         el dictado sin internet: ¿hay modelo de voz? y, si se
 *                         pide, el motor y el modelo para cargarlo en la pantalla
 *   asistente:voz-descargar  baja el modelo de español una sola vez (URL y hash
 *                         fijos en asistente/voz-descarga.js); avisa el avance
 *                         por 'asistente:voz-avance'
 *   asistente:habla       Wybix lee en voz alta: texto → .wav con Piper, en la
 *                         caja ({ estado: true } solo dice si está instalada)
 *   asistente:habla-descargar  baja Piper y la voz una vez (asistente/voz-piper.js);
 *                         avance por 'asistente:habla-avance'
 *
 * Ninguno ejecuta una operación del negocio: un plan lo ejecuta la pantalla
 * con la API de siempre, y aquí solo se registra cómo terminó. Por eso son
 * canales abiertos a cualquier sesión (canales.js): lo que cada quien ve se
 * filtra con SUS permisos (un hallazgo de costos no le llega a quien no los ve).
 */
const fs = require('fs');
const path = require('path');
const sesion = require('../seguridad/sesion');
const voz = require('../asistente/acciones/voz');
const { descargarVoz } = require('../asistente/voz-descarga');
const piper = require('../asistente/voz-piper');

/* La voz de respuesta (Piper) va en su propia carpeta de datos. */
const carpetaHabla = () => { try { return path.join(require('electron').app.getPath('userData'), 'wybix-habla'); } catch { return null; } };

/*
 * DICTADO SIN INTERNET (Vosk, reconocimiento de voz que corre en la caja).
 * El motor es el paquete vosk-browser (WebAssembly) y el modelo de español
 * va en la carpeta de datos del usuario: no viaja en el instalador porque
 * pesa ~40 MB y no todos lo usan: la primera vez que alguien toca el
 * micrófono, el chat ofrece bajarlo (asistente:voz-descargar). Sin el motor,
 * el micrófono no aparece.
 */
function archivosVoz() {
  let datos = null;
  try { datos = require('electron').app.getPath('userData'); } catch { /* fuera de Electron */ }
  const modelo = datos ? path.join(datos, 'wybix-voz', 'modelo.tar.gz') : null;
  const motores = [path.join(__dirname, '..', '..', 'node_modules', 'vosk-browser', 'dist', 'vosk.js'),
                   path.join(process.resourcesPath || '', 'vosk', 'vosk.js')];
  const motor = motores.find((m) => { try { return fs.statSync(m).isFile(); } catch { return false; } }) || null;
  const hayModelo = !!modelo && (() => { try { return fs.statSync(modelo).size > 1_000_000; } catch { return false; } })();
  return { motor, modelo: hayModelo ? modelo : null, carpeta: datos ? path.join(datos, 'wybix-voz') : null };
}

function manejar(fn) {
  return async (evento, ...resto) => {
    const s = resto.length ? resto[resto.length - 1] : null;
    const p = resto.length > 1 && resto[0] && typeof resto[0] === 'object' ? resto[0] : {};
    try { return { success: true, data: await fn({ evento, p, s }) }; }
    catch (e) { console.error('[ASISTENTE]', e); return { success: false, error: e.message || 'No se pudo completar.' }; }
  };
}

const ctxDe = (s) => ({ userId: s.userId, usuario: s.usuario, puede: (paquete) => !!s.permisos?.has(paquete) });

function registrar({ ipcMain, asistente }) {
  ipcMain.handle('asistente:resumen', sesion.proteger('asistente:resumen', manejar(({ s }) => asistente.resumen(ctxDe(s)))));

  ipcMain.handle('asistente:hallazgos', sesion.proteger('asistente:hallazgos', manejar(({ s }) => asistente.listarHallazgos(ctxDe(s)))));

  ipcMain.handle('asistente:historial', sesion.proteger('asistente:historial', manejar(({ s }) => asistente.store.historial(s.userId, 40))));

  ipcMain.handle('asistente:enviar', sesion.proteger('asistente:enviar', manejar(async ({ p, s }) => {
    const entrada = p.accion ? { accion: { intent: String(p.accion.intent || ''), params: p.accion.params || {}, etiqueta: p.accion.etiqueta } }
                             : { texto: String(p.texto || '') };
    const mensajes = await asistente.conversacion.procesar(ctxDe(s), entrada);
    for (const m of mensajes) {
      if (m.plan) await asistente.store.crearPlan(m.plan, { origen: m.plan.hallazgoId ? 'hallazgo' : 'comando', texto: m.plan.texto, userId: s.userId });
    }
    return mensajes;
  })));

  ipcMain.handle('asistente:resultado', sesion.proteger('asistente:resultado', manejar(async ({ p, s }) => {
    const plan = await asistente.store.leerPlan(String(p.planId || ''));
    if (!plan) throw new Error('Ese plan ya no existe.');
    const estado = p.cancelado ? 'cancelado' : p.ok ? 'ejecutado' : 'fallido';
    const cerrado = await asistente.store.cerrarPlan(plan.id, estado, { error: p.error || null, resumen: plan.titulo }, s.userId);
    const out = [];
    if (cerrado && estado === 'ejecutado') {
      /* Lo que se entendió y se confirmó enseña al intérprete. */
      if (plan.texto) { try { await asistente.store.guardarFrase(plan.texto, plan.intent, s.userId); } catch { /* no crítico */ } }
      out.push({ autor: 'wybix', texto: voz.di('listo', { userId: s.userId, turno: Date.now() % 997 }, { titulo: plan.titulo }), tono: 'exito' });
      asistente.pronto(3_000);
    } else if (cerrado && estado === 'fallido') {
      out.push({ autor: 'wybix', texto: `No se pudo: ${p.error || 'la operación falló'}. No cambié nada.`, tono: 'error' });
    } else if (cerrado) {
      out.push({ autor: 'wybix', texto: voz.di('cancelado', { userId: s.userId, turno: Date.now() % 997 }) });
    }
    for (const m of out) await asistente.store.guardarMensaje(s.userId, m);
    return out.map((m) => ({ id: `r${Date.now()}`, en: new Date().toISOString(), ...m }));
  })));

  ipcMain.handle('asistente:entender', sesion.proteger('asistente:entender', manejar(({ p, s }) => asistente.entender(String(p.texto || ''), s.userId))));

  /* Lo llama la tarjeta de un apodo al confirmarse; el plan ya quedó en la bitácora. */
  ipcMain.handle('asistente:alias', sesion.proteger('asistente:alias', manejar(async ({ p, s }) => {
    const r = await asistente.apodo({ accion: p.accion === 'borrar' ? 'borrar' : 'guardar', alias: p.alias, tipo: p.tipo, refId: p.refId, origen: 'ensenado' }, s.userId);
    return { success: true, ...r };
  })));

  ipcMain.handle('asistente:voz', sesion.proteger('asistente:voz', manejar(async ({ p }) => {
    const v = archivosVoz();
    const disponible = !!(v.motor && v.modelo);
    if (!p.cargar || !disponible) return { disponible, faltaMotor: !v.motor, faltaModelo: !v.modelo, carpeta: v.carpeta };
    return { disponible, motor: fs.readFileSync(v.motor, 'utf8'), modelo: fs.readFileSync(v.modelo) };
  })));

  ipcMain.handle('asistente:voz-descargar', sesion.proteger('asistente:voz-descargar', manejar(async ({ evento }) => {
    const v = archivosVoz();
    if (!v.carpeta) throw new Error('No hay carpeta de datos.');
    if (v.modelo) return { disponible: !!v.motor };
    /* El avance va a la ventana que lo pidió; si se cierra, la descarga sigue. */
    const avance = (pct, etapa) => { try { if (!evento.sender.isDestroyed()) evento.sender.send('asistente:voz-avance', { pct, etapa }); } catch { /* noop */ } };
    await descargarVoz({ carpeta: v.carpeta, avance });
    return { disponible: !!archivosVoz().motor };
  })));

  ipcMain.handle('asistente:habla', sesion.proteger('asistente:habla', manejar(async ({ p }) => {
    const carpeta = carpetaHabla();
    const instalada = piper.instalada(carpeta);
    if (p.estado || !p.texto) return { instalada, mb: Math.round(piper.TOTAL / 1_000_000) };
    if (!instalada) throw new Error('La voz de Wybix no está instalada en esta caja.');
    return { wav: await piper.hablar({ carpeta, texto: String(p.texto) }) };
  })));

  ipcMain.handle('asistente:habla-descargar', sesion.proteger('asistente:habla-descargar', manejar(async ({ evento }) => {
    const carpeta = carpetaHabla();
    if (!carpeta) throw new Error('No hay carpeta de datos.');
    if (piper.instalada(carpeta)) return { instalada: true };
    const avance = (pct, etapa) => { try { if (!evento.sender.isDestroyed()) evento.sender.send('asistente:habla-avance', { pct, etapa }); } catch { /* noop */ } };
    await piper.descargarHabla({ carpeta, avance });
    return { instalada: piper.instalada(carpeta) };
  })));

  ipcMain.handle('asistente:evaluar', sesion.proteger('asistente:evaluar', manejar(async ({ s }) => {
    await asistente.evaluar({ forzar: true });
    return asistente.resumen(ctxDe(s));
  })));
}

module.exports = { registrar };
