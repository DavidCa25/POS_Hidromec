import { Injectable } from '@angular/core';

export interface LicenseInfo {
  plan: 'mono' | 'multi' | 'trial';
  maxRegisters: number;        // 0 = ilimitado
  customerName: string;
  machineId: string;
  supportUntil: string | null;
  supportActive: boolean;
  revalidateBy: string;
  issuedAt: string;
  token?: string;
}

/**
 * `demo` NO es una licencia: es una demostracion.
 *
 * Se resuelve por el ESPACIO de licencia, no por un archivo, asi que no hay
 * nada que falsificar. Se distingue de `trial` a proposito: una demo no gasta
 * la prueba de la maquina ni caduca.
 */
export type LicenseState = 'none' | 'demo' | 'trial' | 'active' | 'expired' | 'tamper';

export interface LicenseStatus {
  state: LicenseState;
  type?: 'demo' | 'trial' | 'paid';
  daysRemaining?: number;
  expiresAt?: string | null;
  startedAt?: string | null;
  customerName?: string;
  plan?: string;
}

@Injectable({ providedIn: 'root' })
export class LicenseService {
  readonly supabaseUrl = 'https://swlpspgmkwzlrowllvvj.supabase.co';
  readonly anonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InN3bHBzcGdta3d6bHJvd2xsdnZqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODMwNDMyNzAsImV4cCI6MjA5ODYxOTI3MH0.Wyh4fjmhYJp-USPHtrj_dKAJow038Nj62jR44qirmlM';

  private info: LicenseInfo | null = null;

  // Estado unificado que calcula Electron (none | trial | active | expired)
  estado: LicenseStatus = { state: 'none' };

  private get api() { return (window as any).electronAPI; }

  // ---------- Estado ----------
  get licencia(): LicenseInfo | null { return this.info; }

  get enPrueba(): boolean { return this.estado.state === 'trial'; }
  get esDemo(): boolean { return this.estado.state === 'demo'; }
  /** Puede trabajar: demo, prueba viva o licencia de pago. */
  get puedeOperar(): boolean {
    return ['demo', 'trial', 'active'].includes(this.estado.state);
  }
  get bloqueado(): boolean { return this.estado.state === 'expired' || this.estado.state === 'tamper'; }
  get sinLicencia(): boolean { return this.estado.state === 'none'; }
  get diasRestantesPrueba(): number { return this.estado.daysRemaining ?? 0; }

  // Solo una licencia MULTICAJA de pago habilita varias cajas.
  // En prueba o monocaja NO se muestra nada de multicaja.
  get permiteMulticaja(): boolean { return this.estado.plan === 'multi'; }

  /**
   * Como se llama, de cara al usuario, lo que el negocio tiene AHORA.
   *
   * Durante la prueba no hay plan contratado. Llamarlo "MonoCaja" -que es lo
   * que hacian las pantallas al resolver un getter binario- anuncia una compra
   * que nadie hizo, y de paso esconde que la prueba termina. Se resuelve aqui
   * para que la instalacion, el panel de licencia y el de cajas digan lo mismo.
   */
  get planTexto(): string {
    if (this.esDemo) return 'Demostración';
    if (this.enPrueba) return 'Prueba gratuita';
    return this.estado.plan === 'multi' ? 'MultiCaja' : 'MonoCaja';
  }

  /**
   * LAS CUATRO CLASES, SIN MEZCLARLAS.
   *
   *   Demostración      una demo del gestor. Ni caduca ni se compra.
   *   Prueba gratuita   30 días. NO se llama MonoCaja aunque por dentro le dé
   *                     los mismos límites: comercialmente no es lo mismo, y
   *                     decirle "MonoCaja activada" a quien está probando le
   *                     hace creer que ya compró.
   *   Licencia MonoCaja / MultiCaja   lo que sí se compró.
   */
  get clase(): 'demo' | 'trial' | 'mono' | 'multi' | 'ninguna' {
    if (this.esDemo) return 'demo';
    if (this.enPrueba) return 'trial';
    if (this.estado.state !== 'active') return 'ninguna';
    return this.estado.plan === 'multi' ? 'multi' : 'mono';
  }

  /** Lo que se lee en pantalla para cada clase. */
  get insigniaTexto(): string {
    switch (this.clase) {
      case 'demo':  return 'Demostración';
      case 'trial': return `Prueba gratuita · ${this.textoDiasPrueba}`;
      case 'mono':  return 'Licencia MonoCaja activada';
      case 'multi': return 'Licencia MultiCaja activada';
      default:      return 'Sin licencia activa';
    }
  }

  /** "quedan 12 dias" / "queda 1 dia", ya en singular o plural. */
  get textoDiasPrueba(): string {
    const d = this.diasRestantesPrueba;
    return d === 1 ? '1 día restante' : `${d} días restantes`;
  }

  // Lee el estado unificado desde Electron (con protección de reloj)
  async cargarEstado(): Promise<LicenseStatus> {
    try {
      const st = await this.api?.licenseStatus?.();
      this.estado = st && st.state ? st : { state: 'none' };
    } catch {
      this.estado = { state: 'none' };
    }
    return this.estado;
  }

  // Inicia la prueba gratis de 30 días (valida en la nube: una por máquina)
  async iniciarPrueba(datos: { businessName?: string; email?: string }): Promise<{ ok: boolean; error?: string }> {
    try {
      const res = await this.api?.licenseStartTrial?.(datos);
      if (res?.ok) {
        await this.cargarLocalPublic();
        await this.cargarEstado();
        return { ok: true };
      }
      return { ok: false, error: res?.error || 'No se pudo iniciar la prueba.' };
    } catch {
      return { ok: false, error: 'No hay conexión para iniciar la prueba.' };
    }
  }

  // Activa una licencia de pago con su clave (desbloquea tras la prueba)
  async activarClave(clave: string): Promise<{ ok: boolean; error?: string }> {
    const key = (clave || '').trim().toUpperCase();
    if (!key) return { ok: false, error: 'Escribe tu clave de licencia.' };
    try {
      const res = await this.api?.licenseActivate?.({ licenseKey: key });
      if (res?.ok) {
        await this.cargarLocalPublic();
        await this.cargarEstado();
        return { ok: true };
      }
      return { ok: false, error: res?.error || 'La clave no es válida o está en uso.' };
    } catch {
      return { ok: false, error: 'No hay conexión para validar la clave.' };
    }
  }

  async cargarLocalPublic(): Promise<void> { await this.cargarLocal(); }

  // Re-valida la PRUEBA contra la nube (la verdad real de la fecha de fin).
  // Corrige el license.json local si alguien lo editó manualmente. Offline: respeta el local.
  async revalidarPrueba(): Promise<void> {
    // Revalida en prueba, y también si hay bloqueo/manipulación (para recuperar la verdad de la nube).
    if (!['trial', 'tamper', 'expired'].includes(this.estado.state)) return;
    try {
      const machineId = await this.machineId();
      const controller = new AbortController();
      const t = setTimeout(() => controller.abort(), 6000);
      const res = await fetch(`${this.supabaseUrl}/functions/v1/trial-license`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.anonKey}`,
          'apikey': this.anonKey
        },
        body: JSON.stringify({ action: 'status', machineId }),
        signal: controller.signal
      });
      clearTimeout(t);
      const out = await res.json();
      if (out?.success) {
        await this.api?.licenseSave?.(out); // reescribe con la verdad de la nube
        await this.cargarEstado();           // recalcula estado (puede pasar a 'expired')
      }
    } catch {
      // Sin conexión: se respeta el estado local (gracia offline de la prueba)
    }
  }

  get activa(): boolean {
    if (!this.info) return false;
    return new Date(this.info.revalidateBy) >= new Date();
  }

  get esMulticaja(): boolean {
    return this.activa && this.info?.plan === 'multi';
  }

  get soporteActivo(): boolean {
    return !!this.info?.supportActive;
  }

  get nombreCliente(): string {
    return this.info?.customerName ?? '';
  }

  get diasParaRevalidar(): number {
    if (!this.info) return 0;
    const ms = new Date(this.info.revalidateBy).getTime() - Date.now();
    return Math.max(0, Math.ceil(ms / 86400000));
  }

  // ---------- Arranque ----------
  // La licencia se activa en el asistente de Electron. Angular solo la lee
  // y la revalida. Nunca bloquea por falta de red durante la gracia offline.
  async iniciar(): Promise<boolean> {
    await this.cargarLocal();
    await this.cargarEstado();
    if (!this.info) return false;

    // Vencio la gracia offline: hay que revalidar contra el servidor
    if (!this.activa) {
      return await this.validar();
    }

    // Revalida en segundo plano sin bloquear el arranque
    this.validar().catch(() => { /* sin red: sigue con el token local */ });
    return true;
  }

  // Lee el license.json que escribio Electron
  private async cargarLocal(): Promise<void> {
    try {
      const data = await this.api?.licenseGet?.();
      this.info = data ? (data as LicenseInfo) : null;
    } catch {
      this.info = null;
    }
  }

  private async machineId(): Promise<string> {
    const id = await this.api?.getMachineId?.();
    return id || 'unknown-machine';
  }

  private async llamar(action: string) {
    const machineId = await this.machineId();
    const res = await fetch(`${this.supabaseUrl}/functions/v1/license-check`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.anonKey}`,
        'apikey': this.anonKey
      },
      body: JSON.stringify({ action, machineId })
    });
    return await res.json();
  }

  // Revalida y refresca el token en disco
  async validar(): Promise<boolean> {
    try {
      const out = await this.llamar('validate');

      if (!out?.success) {
        // Licencia suspendida o maquina desactivada: se borra el token
        if (out?.code === 'SUSPENDED' || out?.code === 'NOT_ACTIVATED') {
          await this.api?.licenseClear?.();
          this.info = null;
        }
        return false;
      }

      await this.api?.licenseSave?.(out);
      this.info = out as LicenseInfo;
      return true;
    } catch {
      // Sin red: se respeta la gracia offline
      return this.activa;
    }
  }

  // Libera esta computadora (para cambiar de equipo)
  async liberar(): Promise<boolean> {
    try {
      const out = await this.llamar('release');
      if (out?.success) {
        await this.api?.licenseClear?.();
        this.info = null;
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }
}