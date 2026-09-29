/**
 * PANTALLAS OPERATIVAS Y LICENCIA (en el servidor del Local Host).
 *
 * Ocultar «Dispositivos locales» no basta: aquí se decide, al emparejar, al
 * canjear el QR, al cambiar de función y en cada petición de la tablet:
 *
 *   - la licencia tiene que incluir esa pantalla (su entitlement);
 *   - en Venta Esencial no hay Pantallas Operativas (se vende en la caja);
 *   - CUOTA POR GIRO: cada giro contratado trae sus propias pantallas
 *     (3, 10 o ilimitadas). Restaurantes + Servicios = 3 + 3, no un pool de 6.
 *
 * QUÉ CUENTA. Un dispositivo emparejado y no revocado cuenta en el giro de su
 * función ACTUAL: cambiar Mi jornada -> Mesero deja de contar en Servicios y
 * cuenta en Restaurantes (nunca en los dos). Un QR de emparejamiento pendiente
 * también aparta su lugar, para que no se generen más QR que pantallas.
 * NO cuentan: las cajas (vender es otra cosa), ni la pantalla del cliente de
 * la caja (customer display, segundo monitor), que no es un dispositivo del
 * Local Host.
 *
 * Al llegar al límite se rechaza lo NUEVO con un mensaje claro. Nunca se
 * desconecta un dispositivo que ya estaba trabajando.
 */
const { GIROS } = require('../licencia/entitlements');

function crearLicenciaPantallas({ repo, licencia = null }) {
  const ev = () => { try { return licencia ? licencia() : null; } catch { return null; } };

  function permite(tipo) {
    const e = ev();
    return !e || e.permiteSuperficie(tipo);
  }

  function mensaje() {
    const e = ev();
    if (e?.ventaEsencial) return 'Tu suscripción no está activa: las Pantallas Operativas vuelven al renovar. Wybix sigue vendiendo en la caja.';
    return 'Tu plan no incluye esta pantalla.';
  }

  /** ¿Cabe una pantalla más de esta función? */
  async function cuota(tipo, { excluirId = null, contarPendientes = true } = {}) {
    const e = ev();
    if (!e) return { ok: true };
    const giro = e.giroDeSuperficie(tipo);
    const limite = e.cuotaDe(giro);
    if (limite === null) return { ok: true, giro, limite: null };
    const { dispositivos, pendientes } = await repo.ocupacionPorSuperficie();
    const mismo = (sup) => e.giroDeSuperficie(sup) === giro;
    const excluir = excluirId ? String(excluirId).toLowerCase() : null;
    let usados = dispositivos.filter(x => x.id !== excluir && mismo(x.superficie)).length;
    if (contarPendientes) usados += pendientes.filter(x => mismo(x.superficie)).length;
    if (usados >= limite) {
      const nombre = GIROS[giro] ?? giro;
      return {
        ok: false, giro, limite, usados,
        error: limite === 0
          ? `Tu plan no incluye Pantallas Operativas para ${nombre}.`
          : `Tu plan incluye hasta ${limite} Pantallas Operativas para ${nombre}, y ya están en uso. Revoca una en Dispositivos locales o amplía tu plan para conectar otra.`,
      };
    }
    return { ok: true, giro, limite, usados };
  }

  /** Uso por giro, para la administración. */
  async function resumen() {
    const e = ev();
    if (!e) return null;
    const { dispositivos } = await repo.ocupacionPorSuperficie();
    const giros = e.verticals ?? [];
    return (giros.length ? giros : Object.keys(GIROS)).map(g => ({
      giro: g, nombre: GIROS[g] ?? g, limite: e.cuotaDe(g),
      usados: dispositivos.filter(x => e.giroDeSuperficie(x.superficie) === g).length,
    }));
  }

  return { permite, mensaje, cuota, resumen };
}

module.exports = { crearLicenciaPantallas };
