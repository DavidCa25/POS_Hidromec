import { Injectable, NgZone, inject } from '@angular/core';
import Swal from 'sweetalert2';

/**
 * ROLES V2 · EL DIÁLOGO DE AUTORIZACIÓN, PARA TODA LA CAJA.
 *
 * Cualquier operación aprobable (retiro, egreso, devolución, ajuste, compra,
 * cajón sin venta, promoción fuera de límite) que el proceso principal rechace
 * con «necesita autorización» llega aquí por `postMessage` desde el preload.
 * Las pantallas no tienen que saberlo: el preload repite la operación con el
 * comprobante que salga de este diálogo.
 *
 * Dos caminos:
 *   PIN    un Encargado o el Administrador, presente. Sin Internet.
 *   APP    «Pedir al dueño»: le llega a Wybix Owner, lo aprueba (o no) en su
 *          teléfono y la caja sigue sola. Solo si esta caja está en la nube.
 *
 * Quien autoriza nunca es quien opera (lo rechaza el proceso principal).
 */
@Injectable({ providedIn: 'root' })
export class AutorizacionService {
  private readonly zona = inject(NgZone);
  private iniciado = false;
  private get api() { return (window as any).electronAPI; }

  /** Se llama una vez al arrancar la app. */
  iniciar() {
    if (this.iniciado) return;
    this.iniciado = true;
    window.addEventListener('message', (e: MessageEvent) => {
      const d = e.data;
      if (e.source !== window || !d || d.tipo !== 'wx-autorizacion-pedir') return;
      this.zona.run(() => void this.atender(d));
    });
  }

  private responder(id: number, autorizacion: string | null) {
    window.postMessage({ tipo: 'wx-autorizacion-respuesta', id, autorizacion }, '*');
  }

  private async atender(d: { id: number; canal: string; accion?: string; motivo?: string; detalle?: Record<string, string> | null; payload?: any }) {
    let token: string | null = null;
    try { token = await this.pedir(d); }
    catch { token = null; }
    this.responder(d.id, token);
  }

  private escapar(t: unknown) {
    return String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[c]!));
  }

  /** Muestra el diálogo y devuelve el comprobante, o null si no se autorizó. */
  async pedir(d: { canal: string; motivo?: string; detalle?: Record<string, string> | null; payload?: any }): Promise<string | null> {
    let alDueno = false;
    try { alDueno = !!(await this.api?.aprobacionesDisponible?.())?.data?.disponible; } catch { alDueno = false; }

    const renglones = Object.entries(d.detalle || {}).map(([k, v]) => `<div><b>${this.escapar(k)}:</b> ${this.escapar(v)}</div>`).join('');
    const monto = Number(d.payload?.amount ?? d.payload?.monto ?? d.payload?.total);
    const res = await Swal.fire({
      title: 'Necesita autorización',
      html: `<p style="font-size:14px;color: var(--wx-text-muted);margin:0 0 10px;">${this.escapar(d.motivo || 'Esta operación la autoriza un encargado.')}</p>
             ${Number.isFinite(monto) && monto > 0 ? `<p style="font-size:15px;margin:0 0 8px;"><b>$${monto.toFixed(2)}</b></p>` : ''}
             ${renglones ? `<div style="font-size:13px;text-align:left;margin:0 0 10px;">${renglones}</div>` : ''}
             <input id="aut-user" class="swal2-input" placeholder="Usuario del encargado" autocomplete="off">
             <input id="aut-pin" type="password" inputmode="numeric" class="swal2-input" placeholder="Su PIN" autocomplete="off" maxlength="8">`,
      focusConfirm: false,
      showCancelButton: true,
      showDenyButton: alDueno,
      confirmButtonText: 'Autorizar con PIN',
      denyButtonText: 'Pedir al dueño',
      cancelButtonText: 'Cancelar',
      preConfirm: () => {
        const u = (document.getElementById('aut-user') as HTMLInputElement)?.value.trim();
        const p = (document.getElementById('aut-pin') as HTMLInputElement)?.value;
        if (!u || !p) { Swal.showValidationMessage('Captura el usuario y el PIN del encargado'); return false; }
        return { u, p };
      },
    });

    if (res.isDenied) return this.pedirAlDueno(d);
    if (!res.isConfirmed || !res.value) return null;
    const v = res.value as { u: string; p: string };
    const val = await this.api?.securityAuthorize?.({ usuario: v.u, pin: v.p, canal: d.canal });
    if (!val?.ok || !val.autorizacion) {
      await Swal.fire({ icon: 'error', title: 'No autorizado', text: val?.error || 'Usuario o PIN incorrecto.' });
      return null;
    }
    return val.autorizacion as string;
  }

  /** Le llega al dueño en Wybix Owner; la caja espera aquí hasta que decida. */
  private async pedirAlDueno(d: { canal: string; detalle?: Record<string, string> | null; payload?: any }): Promise<string | null> {
    const s = await this.api?.aprobacionesSolicitar?.({ canal: d.canal, payload: d.payload || {}, detalle: d.detalle || null });
    if (!s?.success) {
      await Swal.fire({ icon: 'error', title: 'No se pudo pedir', text: s?.error || 'Intenta con el PIN de un encargado.' });
      return null;
    }
    const id = s.data.id as string;
    let cancelado = false;
    const espera = Swal.fire({
      title: 'Esperando al dueño',
      html: '<p style="font-size:14px;color: var(--wx-text-muted);margin:0;">Le llegó la solicitud a su app de Wybix. En cuanto la apruebe, la caja sigue sola.</p>',
      showConfirmButton: false, showCancelButton: true, cancelButtonText: 'Cancelar', allowOutsideClick: false,
      didOpen: () => Swal.showLoading(),
    }).then((r) => { if (r.dismiss) cancelado = true; });

    const limite = Date.now() + 10 * 60 * 1000;
    try {
      while (!cancelado && Date.now() < limite) {
        await new Promise((r) => setTimeout(r, 3000));
        if (cancelado) break;
        const e = await this.api?.aprobacionesEstado?.({ id });
        if (!e?.success) continue;                    // sin red un momento: se sigue esperando
        const st = e.data.status as string;
        if (st === 'APPROVED' && e.data.autorizacion) {
          Swal.close();
          return e.data.autorizacion as string;
        }
        if (st === 'REJECTED' || st === 'EXPIRED' || st === 'CANCELLED') {
          Swal.close();
          await Swal.fire({ icon: st === 'REJECTED' ? 'error' : 'info',
            title: st === 'REJECTED' ? 'El dueño no lo autorizó' : 'La solicitud venció',
            text: e.data.nota || (st === 'REJECTED' ? `Lo rechazó ${e.data.decidio || 'el dueño'}.` : 'Vuelve a intentarlo o pide el PIN de un encargado.') });
          return null;
        }
      }
    } finally {
      if (cancelado || Date.now() >= limite) void this.api?.aprobacionesCancelar?.({ id });
    }
    await espera;
    return null;
  }
}
