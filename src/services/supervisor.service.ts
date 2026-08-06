import { Injectable } from '@angular/core';
import Swal from 'sweetalert2';
import { AuthService } from './auth.service';

/**
 * Blindaje anti robo hormiga.
 * - autorizar(): pide usuario+contraseña de un supervisor/admin (si el usuario
 *   actual NO es admin) y valida contra la base. Devuelve quién autorizó.
 * - registrar(): guarda el evento en la bitácora de seguridad.
 * - autorizarYregistrar(): candado completo para una acción sensible.
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

  async autorizar(motivo: string): Promise<{ ok: boolean; authorizedBy?: number }> {
    if (this.auth.esAdmin) return { ok: true, authorizedBy: this.auth.usuarioActualId ?? undefined };
    const res = await Swal.fire({
      title: 'Autorización de supervisor',
      html: `<p style="font-size:14px;color:#475569;margin:0 0 10px;">${motivo}</p>
             <input id="sup-user" class="swal2-input" placeholder="Usuario supervisor" autocomplete="off">
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
    const val = await this.api?.securityAuthorize?.({ usuario: (res.value as any).u, password: (res.value as any).p });
    if (!val?.ok) {
      await Swal.fire({ icon: 'error', title: 'No autorizado', text: val?.error || 'Credenciales inválidas o sin permisos.' });
      return { ok: false };
    }
    return { ok: true, authorizedBy: val.userId };
  }

  async registrar(eventType: string, opts: { amount?: number; detail?: string; saleId?: number | null; authorizedBy?: number } = {}) {
    try {
      await this.api?.securityLog?.({
        userId: this.auth.usuarioActualId ?? null,
        authorizedBy: opts.authorizedBy ?? null,
        registerId: await this.regId(),
        eventType,
        amount: opts.amount ?? null,
        detail: opts.detail ?? null,
        saleId: opts.saleId ?? null
      });
    } catch { /* silencioso: la bitácora nunca debe frenar la operación */ }
  }

  /** Candado: pide autorización y, si se concede, registra el evento. */
  async autorizarYregistrar(motivo: string, eventType: string,
      opts: { amount?: number; detail?: string; saleId?: number | null } = {}): Promise<boolean> {
    const a = await this.autorizar(motivo);
    if (!a.ok) return false;
    await this.registrar(eventType, { ...opts, authorizedBy: a.authorizedBy });
    return true;
  }
}
