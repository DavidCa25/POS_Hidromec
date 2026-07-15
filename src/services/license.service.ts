import { Injectable } from '@angular/core';

export interface LicenseInfo {
  plan: 'mono' | 'multi';
  maxRegisters: number;        // 0 = ilimitado
  customerName: string;
  machineId: string;
  supportUntil: string | null;
  supportActive: boolean;
  revalidateBy: string;
  issuedAt: string;
  token?: string;
}

@Injectable({ providedIn: 'root' })
export class LicenseService {
  readonly supabaseUrl = 'https://swlpspgmkwzlrowllvvj.supabase.co';
  readonly anonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InN3bHBzcGdta3d6bHJvd2xsdnZqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODMwNDMyNzAsImV4cCI6MjA5ODYxOTI3MH0.Wyh4fjmhYJp-USPHtrj_dKAJow038Nj62jR44qirmlM';

  private info: LicenseInfo | null = null;

  private get api() { return (window as any).electronAPI; }

  // ---------- Estado ----------
  get licencia(): LicenseInfo | null { return this.info; }

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