import { Injectable } from '@angular/core';

export interface LicenseInfo {
  plan: 'mono' | 'multi';
  maxRegisters: number; 
  customerName: string;
  machineId: string;
  supportUntil: string | null;
  supportActive: boolean;
  revalidateBy: string;
  issuedAt: string;
}

const STORAGE_KEY = 'wybix_license_token';
const STORAGE_INFO = 'wybix_license_info';

@Injectable({ providedIn: 'root' })
export class LicenseService {
  // Ajusta con tu proyecto de Supabase
  readonly supabaseUrl = 'https://swlpspgmkwzlrowllvvj.supabase.co';
  readonly anonKey = 'TU_ANON_KEY_PUBLICA';

  private info: LicenseInfo | null = null;

  private get api() { return (window as any).electronAPI; }

  // ---------- Estado ----------
  get licencia(): LicenseInfo | null { return this.info; }

  get activa(): boolean {
    if (!this.info) return false;
    // Vencio la gracia offline: hay que revalidar
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

  // ---------- Arranque ----------
  // Carga el token guardado y revalida si toca. Nunca bloquea por falta de red
  // mientras la gracia offline siga vigente.
  async iniciar(): Promise<boolean> {
    this.cargarLocal();

    // Si no hay token, hay que activar
    if (!this.info) return false;

    // Si ya vencio la gracia, obliga a revalidar contra el servidor
    if (!this.activa) {
      const ok = await this.validar();
      return ok;
    }

    this.validar().catch(() => { /* sin red: sigue con el token local */ });
    return true;
  }

  private cargarLocal() {
    try {
      const raw = localStorage.getItem(STORAGE_INFO);
      this.info = raw ? JSON.parse(raw) as LicenseInfo : null;
    } catch {
      this.info = null;
    }
  }

  private guardarLocal(token: string, info: LicenseInfo) {
    localStorage.setItem(STORAGE_KEY, token);
    localStorage.setItem(STORAGE_INFO, JSON.stringify(info));
    this.info = info;
  }

  private limpiarLocal() {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(STORAGE_INFO);
    this.info = null;
  }

  // Huella de la maquina (viene de Electron)
  private async machineId(): Promise<string> {
    const id = await this.api?.getMachineId?.();
    return id || 'unknown-machine';
  }

  // ---------- Llamadas al servidor ----------
  private async llamar(action: string, licenseKey?: string, machineAlias?: string) {
    const machineId = await this.machineId();
    const res = await fetch(`${this.supabaseUrl}/functions/v1/license-check`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.anonKey}`,
        'apikey': this.anonKey
      },
      body: JSON.stringify({ action, licenseKey, machineId, machineAlias })
    });
    return await res.json();
  }

  // Canjea la clave e instala la licencia en esta maquina
  async activar(licenseKey: string, alias?: string): Promise<{ ok: boolean; error?: string; code?: string }> {
    try {
      const out = await this.llamar('activate', licenseKey, alias);
      if (!out?.success) return { ok: false, error: out?.error, code: out?.code };

      this.guardarLocal(out.token, out as LicenseInfo);
      return { ok: true };
    } catch (e: any) {
      return { ok: false, error: 'No hay conexion para activar la licencia.' };
    }
  }

  // Revalida contra el servidor y refresca el token
  async validar(): Promise<boolean> {
    try {
      const out = await this.llamar('validate');
      if (!out?.success) {
        // La licencia fue suspendida o la maquina desactivada
        if (out?.code === 'SUSPENDED' || out?.code === 'NOT_ACTIVATED') {
          this.limpiarLocal();
        }
        return false;
      }
      this.guardarLocal(out.token, out as LicenseInfo);
      return true;
    } catch {
      // Sin red: se respeta la gracia offline
      return this.activa;
    }
  }

  // Libera esta maquina (para cambiar de computadora)
  async liberar(): Promise<boolean> {
    try {
      const out = await this.llamar('release');
      if (out?.success) {
        this.limpiarLocal();
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }

  // Dias que faltan para tener que revalidar
  get diasParaRevalidar(): number {
    if (!this.info) return 0;
    const ms = new Date(this.info.revalidateBy).getTime() - Date.now();
    return Math.max(0, Math.ceil(ms / 86400000));
  }
}