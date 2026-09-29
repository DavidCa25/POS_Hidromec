import { Injectable, signal } from '@angular/core';

/**
 * LA LICENCIA, VISTA DESDE LA PANTALLA.
 *
 * La autoridad es el proceso principal (electron/licencia): verifica el
 * certificado firmado, calcula el estado sin red y protege los canales, la
 * venta y el Local Host. Aquí solo se LEE ese estado para pintar la
 * navegación, los avisos y el panel. La pantalla no escribe licencias ni
 * habla con Supabase: pedir, refrescar e importar lo hace el proceso principal.
 *
 * Estados (modo):
 *   TRIAL      prueba gratuita de 30 días
 *   ACTIVE     suscripción vigente (el primer año viene incluido)
 *   GRACE      venció: 45 días con todo funcionando y avisos
 *   SALE_ONLY  Modo Venta Esencial: vender, cobrar, consultar y respaldar
 *   EXPIRED    terminó la prueba sin compra
 *   DEMO       demostración del gestor
 *   NONE | TAMPER
 */
export type LicenseMode = 'TRIAL' | 'ACTIVE' | 'GRACE' | 'SALE_ONLY' | 'EXPIRED' | 'DEMO' | 'NONE' | 'TAMPER';
export type LicenseState = 'none' | 'demo' | 'trial' | 'active' | 'expired' | 'tamper';

export interface LicenseStatus {
  state: LicenseState;
  modo?: LicenseMode;
  motivo?: string;
  type?: 'demo' | 'trial' | 'paid';
  plan?: string;
  edition?: 'mono' | 'multi';
  daysRemaining?: number;
  diasRestantes?: number;
  expiresAt?: string | null;
  startedAt?: string | null;
  customerName?: string;
  verticals?: string[];
  entitlements?: string[];
  screens?: Record<string, number | null>;
  registersMax?: number | null;
  paidUntil?: string | null;
  graceUntil?: string | null;
  validUntil?: string | null;
  refrescarEnDias?: number;
  relojAtrasado?: boolean;
  ventaEsencial?: boolean;
  revisionInventario?: { desde: string; hasta: string } | null;
  machineCode?: string;
  /** PRODUCTION | INTERNAL | QA | TEST: una licencia de pruebas no se confunde con una comercial. */
  origin?: string | null;
}

/** Nombres comerciales de los giros (los códigos internos no cambian). */
export const GIROS: Record<string, string> = {
  COMMERCE: 'Comercios',
  HOSPITALITY: 'Restaurantes y Cafeterías',
  SERVICES: 'Negocios de Servicios',
};

@Injectable({ providedIn: 'root' })
export class LicenseService {
  /** Estado unificado que calcula Electron. */
  estado: LicenseStatus = { state: 'none', modo: 'NONE' };
  /** El mismo estado, como señal, para la navegación y los avisos. */
  readonly estadoSignal = signal<LicenseStatus>(this.estado);

  private get api() { return (window as any).electronAPI; }

  // ---------------------------------------------------------- estado
  get modo(): LicenseMode { return this.estado.modo ?? 'NONE'; }
  get enPrueba(): boolean { return this.modo === 'TRIAL' || (this.estado.state === 'trial' && !this.estado.modo); }
  get esDemo(): boolean { return this.modo === 'DEMO' || this.estado.state === 'demo'; }
  get enGracia(): boolean { return this.modo === 'GRACE'; }
  get ventaEsencial(): boolean { return this.modo === 'SALE_ONLY'; }
  /** Puede trabajar: demo, prueba, suscripción, gracia o Venta Esencial (vender nunca se bloquea por no pagar). */
  get puedeOperar(): boolean { return ['DEMO', 'TRIAL', 'ACTIVE', 'GRACE', 'SALE_ONLY'].includes(this.modo); }
  get bloqueado(): boolean { return this.modo === 'EXPIRED' || this.modo === 'TAMPER'; }
  get sinLicencia(): boolean { return this.modo === 'NONE'; }
  get diasRestantesPrueba(): number { return this.estado.daysRemaining ?? 0; }
  get diasGracia(): number { return this.enGracia ? (this.estado.daysRemaining ?? 0) : 0; }

  /** ¿La licencia incluye esto y el estado lo permite? (La autoridad sigue siendo el proceso principal.) */
  tiene(ent: string): boolean {
    const ents = this.estado.entitlements;
    if (!ents) return this.puedeOperar;
    if (!ents.includes(ent)) return false;
    if (this.ventaEsencial) return ['sales', 'customers', 'reports', 'backup', 'invoicing'].includes(ent);
    return this.puedeOperar;
  }

  /** Solo MultiCaja (en un estado operativo, no en Venta Esencial) muestra lo de varias cajas. */
  get permiteMulticaja(): boolean {
    return this.estado.edition === 'multi' && ['ACTIVE', 'GRACE'].includes(this.modo);
  }

  get girosTexto(): string {
    return (this.estado.verticals ?? []).map(g => GIROS[g] ?? g).join(' + ');
  }

  get planTexto(): string {
    if (this.esDemo) return 'Demostración';
    if (this.enPrueba) return 'Prueba gratuita';
    return this.estado.edition === 'multi' ? 'MultiCaja' : 'MonoCaja';
  }

  get clase(): 'demo' | 'trial' | 'mono' | 'multi' | 'ninguna' {
    if (this.esDemo) return 'demo';
    if (this.enPrueba) return 'trial';
    if (!['ACTIVE', 'GRACE', 'SALE_ONLY'].includes(this.modo)) return 'ninguna';
    return this.estado.edition === 'multi' ? 'multi' : 'mono';
  }

  get insigniaTexto(): string {
    switch (this.clase) {
      case 'demo':  return 'Demostración';
      case 'trial': return `Prueba gratuita · ${this.textoDiasPrueba}`;
      case 'mono':  return this.ventaEsencial ? 'MonoCaja · Venta Esencial' : 'Licencia MonoCaja activada';
      case 'multi': return this.ventaEsencial ? 'MultiCaja · Venta Esencial' : 'Licencia MultiCaja activada';
      default:      return 'Sin licencia activa';
    }
  }

  get textoDiasPrueba(): string {
    const d = this.diasRestantesPrueba;
    return d === 1 ? '1 día restante' : `${d} días restantes`;
  }

  private fijar(st: LicenseStatus | null | undefined) {
    this.estado = st && st.state ? st : { state: 'none', modo: 'NONE' };
    this.estadoSignal.set(this.estado);
  }

  async cargarEstado(): Promise<LicenseStatus> {
    try { this.fijar(await this.api?.licenseStatus?.()); }
    catch { this.fijar(null); }
    return this.estado;
  }

  // ---------------------------------------------------------- acciones
  async iniciarPrueba(datos: { businessName?: string; email?: string }): Promise<{ ok: boolean; error?: string }> {
    try {
      const res = await this.api?.licenseStartTrial?.(datos);
      if (res?.ok) { await this.cargarEstado(); return { ok: true }; }
      return { ok: false, error: res?.error || 'No se pudo iniciar la prueba.' };
    } catch {
      return { ok: false, error: 'No hay conexión para iniciar la prueba.' };
    }
  }

  async activarClave(clave: string): Promise<{ ok: boolean; error?: string }> {
    const key = (clave || '').trim().toUpperCase().replace(/\s+/g, '');
    if (!key) return { ok: false, error: 'Escribe tu clave de licencia.' };
    try {
      const res = await this.api?.licenseActivate?.({ licenseKey: key });
      if (res?.ok) { await this.cargarEstado(); return { ok: true }; }
      return { ok: false, error: res?.error || 'La clave no es válida o está en uso.' };
    } catch {
      return { ok: false, error: 'No hay conexión para validar la clave.' };
    }
  }

  /** Refrescar con el servidor, en segundo plano. Sin red no pasa nada. */
  /**
   * El giro de la PRUEBA, elegido en el alta. Solo lo pide: el proceso
   * principal lo manda al servidor y aplica el certificado que responde (o lo
   * deja pendiente si no hay red). No hace nada si no es una prueba.
   */
  async elegirGiroPrueba(vertical: 'COMMERCE' | 'HOSPITALITY' | 'SERVICES'): Promise<{ ok: boolean; pendiente?: boolean }> {
    try {
      const r = await this.api?.licenseTrialVertical?.({ vertical });
      if (r?.estado) this.fijar(r.estado); else await this.cargarEstado();
      return { ok: !!r?.ok, pendiente: !!r?.pendiente };
    } catch { return { ok: false }; }
  }

  async refrescar(): Promise<void> {
    try {
      const r = await this.api?.licenseRefresh?.();
      if (r?.estado) this.fijar(r.estado); else await this.cargarEstado();
    } catch { /* sin red: se sigue con la licencia local */ }
  }

  /** Importar un archivo .wybix-license (sin Internet en esta caja). */
  async importar(): Promise<{ ok: boolean; error?: string; cancelado?: boolean }> {
    try {
      const r = await this.api?.licenseImport?.();
      if (r?.ok) { this.fijar(r.estado); return { ok: true }; }
      return { ok: false, error: r?.error, cancelado: !!r?.cancelado };
    } catch {
      return { ok: false, error: 'No se pudo importar la licencia.' };
    }
  }

  /** Liberar esta computadora para activar la licencia en otra. */
  async liberar(): Promise<{ ok: boolean; error?: string }> {
    try {
      const r = await this.api?.licenseRelease?.();
      await this.cargarEstado();
      return r?.ok ? { ok: true } : { ok: false, error: r?.error || r?.motivo };
    } catch {
      return { ok: false, error: 'Necesitas Internet para liberar esta computadora.' };
    }
  }

  // ---------------------------------------------------------- arranque
  /**
   * La licencia local manda; el refresco va después y sin esperar. Nunca se
   * bloquea el arranque ni la venta esperando a la red.
   */
  async iniciar(): Promise<boolean> {
    await this.cargarEstado();
    this.refrescar().catch(() => {});
    return this.puedeOperar;
  }

  /** Compatibilidad: antes se revalidaba la prueba desde aquí. */
  async revalidarPrueba(): Promise<void> { /* lo hace el proceso principal (license:refresh) */ }
}
