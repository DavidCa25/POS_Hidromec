/*
 * AVISOS POR WHATSAPP AL CLIENTE FINAL (0068).
 *
 *   whatsapp:config           leer los ajustes de la nube
 *   whatsapp:config-guardar   encender/apagar cada aviso y los días antes (solo la caja principal)
 *   whatsapp:registro         lo que salió, falló, se leyó o se omitió (teléfonos enmascarados)
 *   whatsapp:telefono         un cliente pide dejar de recibir avisos, o volver a recibirlos
 *   whatsapp:conexion         conectar el WhatsApp DEL NEGOCIO (abre en el navegador del
 *                             sistema la página de Meta con un enlace de un solo uso),
 *                             ver su estado y sus plantillas, o desconectarlo
 *
 * Todo vive en la nube (función whatsapp-avisos): sin nube vinculada la
 * pantalla lo dice y no hay nada que guardar aquí. El envío de «pedido listo»
 * lo hace electron/nube/whatsapp-avisos.js, no la pantalla.
 */
const sesion = require("../seguridad/sesion");

const SIN_NUBE = "Vincula la caja con Wybix en la nube para usar los avisos por WhatsApp.";

function registrar({ ipcMain, avisos, nubeLista, abrirExterno }) {
  const fallo = (e) => ({ success: false, error: String(e?.message || e), code: e?.code || null });

  ipcMain.handle("whatsapp:config", sesion.proteger("whatsapp:config", async () => {
    if (!nubeLista()) return { success: true, data: { nube: false } };
    try {
      return { success: true, data: { nube: true, ...(await avisos.leerConfig(true)) } };
    } catch (e) { return fallo(e); }
  }));

  ipcMain.handle("whatsapp:config-guardar", sesion.proteger("whatsapp:config-guardar", async (_e, p = {}) => {
    if (!nubeLista()) return { success: false, error: SIN_NUBE };
    try {
      const dias = Math.trunc(Number(p.diasAntes));
      const como = String(p.comoRenovar ?? "").replace(/\s+/g, " ").trim().slice(0, 120);
      if (!Number.isInteger(dias) || dias < 1 || dias > 15) throw Error("Elige de 1 a 15 días antes.");
      if (como.length < 3) throw Error("Escribe cómo renovar la membresía (por ejemplo: paga tu mensualidad en caja).");
      const data = await avisos.guardarConfig({ pedido_listo: !!p.pedidoListo, membresia: !!p.membresia, dias_antes: dias, como_renovar: como });
      return { success: true, data: { nube: true, ...data } };
    } catch (e) { return fallo(e); }
  }));

  ipcMain.handle("whatsapp:registro", sesion.proteger("whatsapp:registro", async (_e, p = {}) => {
    if (!nubeLista()) return { success: true, data: { nube: false, avisos: [] } };
    try {
      const r = await avisos.llamar({ action: "registro", limite: Math.min(Math.max(Number(p.limite) || 100, 1), 300) });
      return { success: true, data: { nube: true, resumen: r.resumen, bajas: r.bajas, avisos: r.avisos || [], proveedor: r.proveedor ?? null } };
    } catch (e) { return fallo(e); }
  }));

  ipcMain.handle("whatsapp:telefono", sesion.proteger("whatsapp:telefono", async (_e, p = {}) => {
    if (!nubeLista()) return { success: false, error: SIN_NUBE };
    try {
      const accion = ["baja", "alta", "estado_tel"].includes(p.accion) ? p.accion : null;
      const telefono = String(p.telefono ?? "").trim().slice(0, 30);
      if (!accion) throw Error("Acción no válida.");
      if (telefono.replace(/\D/g, "").length < 10) throw Error("Escribe el teléfono a 10 dígitos.");
      const r = await avisos.llamar({ action: "telefono", accion, telefono });
      return { success: true, data: { baja: !!r.baja } };
    } catch (e) { return fallo(e); }
  }));

  ipcMain.handle("whatsapp:conexion", sesion.proteger("whatsapp:conexion", async (_e, p = {}) => {
    if (!nubeLista()) return { success: false, error: SIN_NUBE };
    try {
      const accion = ["iniciar", "estado", "desconectar"].includes(p.accion) ? p.accion : null;
      if (!accion) throw Error("Acción no válida.");
      const r = await avisos.conexion(accion);
      if (accion === "iniciar") {
        /* El enlace se abre aquí, no en la pantalla: Meta pide un navegador
           de verdad (ventana emergente de Facebook) y solo se acepta https. */
        if (!/^https:\/\/[^\s]+#t=[0-9a-f]{64}$/.test(String(r.url || ""))) throw Error("La nube no devolvió un enlace válido.");
        await abrirExterno(r.url);
        return { success: true, data: { abierto: true, venceMin: r.vence_min ?? 30 } };
      }
      return { success: true, data: { cuenta: r.cuenta ?? null, principal: !!r.principal, conectable: !!r.conectable } };
    } catch (e) { return fallo(e); }
  }));
}

module.exports = { registrar };
