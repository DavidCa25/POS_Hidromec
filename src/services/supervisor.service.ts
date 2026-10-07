import { Injectable } from '@angular/core';
import Swal from 'sweetalert2';
import { AuthService, Paquete } from './auth.service';

/**
 * «QUE OTRA PERSONA LO AUTORICE», EL BLINDAJE ANTI ROBO HORMIGA.
 *
 * Nació contra tres operaciones concretas: devolver, anular una venta y abrir
 * el cajón sin venta. Su valor no es técnico sino disuasorio. Un permiso
 * silencioso deja el mismo agujero; que alguien tenga que llamar al encargado
 * deja un rastro con nombre y hora.
 *
 * DOS IDENTIDADES, SIEMPRE
 * ------------------------
 * Quien opera y quien autoriza son personas distintas y las dos quedan en la
 * bitácora. Un registro que solo diga «el encargado hizo la devolución» miente:
 * lo que hizo fue permitirla. Las dos las devuelve el proceso principal —el
 * actor sale de la sesión de la ventana, no de aquí—, así que esta capa no
 * puede mandar una sola ni inventarse la otra.
 *
 * Y si quien autoriza resulta ser quien opera, el proceso principal lo rechaza.
 * Eso no es autorización presencial: es saltarse el control con la propia
 * contraseña.
 */
@Injectable({ providedIn: 'root' })
export class SupervisorAuthService {
  private get api() { return (window as any).electronAPI; }
  private registerId: number | null = null;

  constructor(private auth: AuthService) {}

  private async regId(): Promise<number | null> {
    if (this.registerId != null) return this.registerId;
    try { const r = await this.api?.registerGetCurrent?.(); this.registerId = r?.data?.registerId ?? null; } catch { /* noop */ }
    return this.registerId;
  }

  /**
   * Pide credenciales de alguien que SÍ pueda, si quien opera no puede.
   *
   * `canal` es el canal IPC de la operación: el proceso principal lo traduce al
   * paquete exigido con el mismo mapa que usa para autorizar. Se manda el canal
   * y no el paquete para que no haya dos sitios donde decidir qué exige cada
   * operación.
   *
   * `paquete` solo sirve para el atajo local: si quien está operando ya lo
   * tiene, no se le pide nada. La comprobación de verdad la hace igualmente el
   * proceso principal cuando se ejecute la operación.
   */
  async autorizar(motivo: string, canal: string, paquete: Paquete):
      Promise<{ ok: boolean; authorizedBy?: number; performedBy?: number; autorizacion?: string }> {

    if (this.auth.puede(paquete)) {
      const yo = this.auth.usuarioActualId ?? undefined;
      return { ok: true, authorizedBy: yo, performedBy: yo };
    }

    const res = await Swal.fire({
      title: 'Autorización',
      html: `<p style="font-size:14px;color: var(--wx-text-muted);margin:0 0 10px;">${motivo}</p>
             <input id="sup-user" class="swal2-input" placeholder="Usuario que autoriza" autocomplete="off">
             <input id="sup-pass" type="password" class="swal2-input" placeholder="Contraseña">`,
      focusConfirm: false, showCancelButton: true,
      confirmButtonText: 'Autorizar', cancelButtonText: 'Cancelar',
      preConfirm: () => {
        const u = (document.getElementById('sup-user') as HTMLInputElement)?.value.trim();
        const p = (document.getElementById('sup-pass') as HTMLInputElement)?.value;
        if (!u || !p) { Swal.showValidationMessage('Captura usuario y contraseña'); return false; }
        return { u, p };
      }
    });
    if (!res.isConfirmed || !res.value) return { ok: false };

    const val = await this.api?.securityAuthorize?.({
      usuario: (res.value as any).u,
      password: (res.value as any).p,
      canal,
    });
    if (!val?.ok) {
      await Swal.fire({
        icon: 'error', title: 'No autorizado',
        text: val?.error || 'Credenciales inválidas o sin acceso a esta operación.',
      });
      return { ok: false };
    }
    /* `autorizacion` es el comprobante de un solo uso que emite el proceso
       principal. Es lo único que la bitácora acepta como prueba de quién
       autorizó; los números de arriba son solo para mostrar. */
    return { ok: true, authorizedBy: val.authorizedBy, performedBy: val.performedBy, autorizacion: val.autorizacion };
  }

  async registrar(eventType: string, opts: {
    amount?: number; detail?: string; saleId?: number | null;
    autorizacion?: string; canal?: string;
  } = {}) {
    try {
      await this.api?.securityLog?.({
        /* Quién operó y quién autorizó los decide el proceso principal: el
           actor sale de la sesión y el autorizador del comprobante. Aquí solo
           viajan el comprobante y el canal de la operación. */
        autorizacion: opts.autorizacion ?? null,
        canal: opts.canal ?? null,
        registerId: await this.regId(),
        eventType,
        amount: opts.amount ?? null,
        detail: opts.detail ?? null,
        saleId: opts.saleId ?? null
      });
    } catch { /* silencioso: la bitácora nunca debe frenar la operación */ }
  }

  /**
   * AUTORIZAR CON PIN (Fase 1). Para operaciones que el proceso principal
   * rechazó pidiendo autorización (p. ej. cerrar el turno de otra persona).
   *
   *   propio = true   quien opera ya tiene el rol para hacerlo: confirma con
   *                   SU PIN (reautenticación). Un encargado cerrando el turno
   *                   de un cajero.
   *   propio = false  autoriza otra persona: su usuario y su PIN.
   *
   * Devuelve el comprobante de un solo uso que la operación consume. El PIN
   * nunca se guarda ni vuelve de ningún lado.
   */
  async autorizarConPin(motivo: string, canal: string, propio: boolean): Promise<string | null> {
    const res = await Swal.fire({
      title: 'Autorización',
      html: `<p style="font-size:14px;color: var(--wx-text-muted);margin:0 0 10px;">${motivo}</p>
             ${propio ? '' : '<input id="sup-user" class="swal2-input" placeholder="Usuario del encargado" autocomplete="off">'}
             <input id="sup-pin" type="password" inputmode="numeric" class="swal2-input"
                    placeholder="${propio ? 'Tu PIN' : 'PIN del encargado'}" autocomplete="off" maxlength="8">`,
      focusConfirm: false, showCancelButton: true,
      confirmButtonText: 'Autorizar', cancelButtonText: 'Cancelar',
      preConfirm: () => {
        const u = propio ? '' : (document.getElementById('sup-user') as HTMLInputElement)?.value.trim();
        const p = (document.getElementById('sup-pin') as HTMLInputElement)?.value;
        if ((!propio && !u) || !p) { Swal.showValidationMessage(propio ? 'Captura tu PIN' : 'Captura usuario y PIN'); return false; }
        return { u, p };
      }
    });
    if (!res.isConfirmed || !res.value) return null;
    const v = res.value as { u: string; p: string };
    const val = await this.api?.securityAuthorize?.(propio
      ? { reautenticar: true, pin: v.p, canal }
      : { usuario: v.u, pin: v.p, canal });
    if (!val?.ok || !val.autorizacion) {
      await Swal.fire({ icon: 'error', title: 'No autorizado', text: val?.error || 'PIN incorrecto.' });
      return null;
    }
    return val.autorizacion as string;
  }

  /** Candado completo: pide autorización y, si se concede, registra el evento. */
  async autorizarYregistrar(motivo: string, eventType: string, canal: string, paquete: Paquete,
      opts: { amount?: number; detail?: string; saleId?: number | null } = {}): Promise<boolean> {
    const a = await this.autorizar(motivo, canal, paquete);
    if (!a.ok) return false;
    await this.registrar(eventType, { ...opts, autorizacion: a.autorizacion, canal });
    return true;
  }
}
