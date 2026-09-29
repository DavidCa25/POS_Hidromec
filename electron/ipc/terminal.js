/**
 * MODO TERMINAL: auditar, activar y restaurar.
 *
 * Los tres exigen CONFIGURACION_ADMINISTRAR en Wybix, y activar/restaurar
 * piden ademas elevacion de Windows (UAC). Tener el paquete de Wybix no da
 * permiso sobre Windows: hacen falta las dos cosas.
 *
 * En pruebas (`WYBIX_E2E` o `WYBIX_TERMINAL_SANDBOX`) todo va al arenero del
 * registro: una prueba automatica jamas toca las directivas reales.
 */
const path = require('path');
const sesion = require('../seguridad/sesion');
const mt = require('../terminal/modo-terminal');

function registrar({ ipcMain, loadDeviceConfig, saveDeviceConfig }) {
  const sandbox = () => process.env.WYBIX_TERMINAL_SANDBOX === '1' || process.env.WYBIX_E2E === '1';
  const ejecutable = () => path.basename(process.execPath);

  const estadoGuardado = () => {
    try { return loadDeviceConfig()?.terminal ?? null; } catch { return null; }
  };
  const guardarEstado = (terminal) => {
    const cfg = loadDeviceConfig() || {};
    saveDeviceConfig({ ...cfg, terminal });
  };

  ipcMain.handle('terminal:auditar', sesion.proteger('terminal:auditar', async (_e, p = {}) => {
    try {
      const a = await mt.auditar({ sandbox: sandbox() });
      if (!a.ok) return { success: false, error: a.mensaje };
      const vista = mt.plan({ ejecutableWybix: ejecutable(), permitirExcel: !!p.permitirExcel, bloquearTaskMgr: !!p.bloquearTaskMgr });
      return {
        success: true,
        data: {
          ...a,
          ejecutable: ejecutable(),
          bloquea: mt.queSeBloquea({ permitidos: vista.permitidos, bloquearTaskMgr: !!p.bloquearTaskMgr }),
          estado: a.activo ? (estadoGuardado() ?? { activo: true }) : null,
        },
      };
    } catch (e) {
      return { success: false, error: e?.message || 'No se pudo auditar Windows.' };
    }
  }));

  ipcMain.handle('terminal:activar', sesion.proteger('terminal:activar', async (_e, p = {}) => {
    try {
      const a = await mt.auditar({ sandbox: sandbox() });
      if (!a.ok) return { success: false, error: a.mensaje };
      const pol = a.capacidades.find(c => c.id === 'politicas-usuario');
      if (!pol?.disponible) return { success: false, error: pol?.motivo || 'Este Windows no lo permite.' };
      if (a.activo) return { success: false, error: 'El modo terminal ya está activo en esta cuenta de Windows.' };

      const r = await mt.activar({
        sid: a.windows.sid, ejecutableWybix: ejecutable(),
        permitirExcel: !!p.permitirExcel, bloquearTaskMgr: !!p.bloquearTaskMgr, sandbox: sandbox(),
      });
      if (!r.ok) return { success: false, error: r.mensaje };
      guardarEstado({
        activo: true, sid: a.windows.sid, cuenta: a.windows.usuario,
        aplicadoEn: new Date().toISOString(), permitidos: r.permitidos,
        bloquearTaskMgr: !!p.bloquearTaskMgr, respaldo: r.respaldo, restaurarManual: r.restaurarManual,
      });
      return { success: true, data: { permitidos: r.permitidos, respaldo: r.respaldo, restaurarManual: r.restaurarManual } };
    } catch (e) {
      return { success: false, error: e?.message || 'No se pudo activar.' };
    }
  }));

  ipcMain.handle('terminal:restaurar', sesion.proteger('terminal:restaurar', async () => {
    try {
      const a = await mt.auditar({ sandbox: sandbox() });
      if (!a.ok) return { success: false, error: a.mensaje };
      const r = await mt.restaurar({ sid: a.windows.sid, sandbox: sandbox() });
      if (!r.ok) return { success: false, error: r.mensaje };
      guardarEstado({ activo: false, restauradoEn: new Date().toISOString() });
      return { success: true };
    } catch (e) {
      return { success: false, error: e?.message || 'No se pudo restaurar.' };
    }
  }));
}

module.exports = { registrar };
