import { Injectable, signal } from '@angular/core';

export type AppWybix = 'owner' | 'mobile';
export const APPS_WYBIX = [
  { id: 'owner' as const, nombre: 'Wybix Owner', icono: 'ph-device-mobile', descripcion: 'Consulta ventas, cortes y avisos desde tu celular.' },
  { id: 'mobile' as const, nombre: 'Wybix POS Mobile', icono: 'ph-device-tablet', descripcion: 'Vende y cobra desde una tablet Android.' },
];
// Enlaces públicos estables; nunca incluyen una invitación ni credenciales.
export const DESCARGAS_WYBIX = {
  owner: 'https://swlpspgmkwzlrowllvvj.supabase.co/functions/v1/app-download?app=owner',
  mobile: 'https://swlpspgmkwzlrowllvvj.supabase.co/functions/v1/app-download?app=mobile',
};

@Injectable({ providedIn: 'root' })
export class AppsWybixService {
  readonly abierta = signal(false);
  readonly app = signal<AppWybix | null>(null);
  ancla: HTMLElement | null = null;

  abrir(ancla: HTMLElement | null = null, app: AppWybix | null = null) {
    this.ancla = ancla;
    this.app.set(app);
    this.abierta.set(true);
  }

  cerrar() {
    this.abierta.set(false);
    if (this.ancla?.isConnected) this.ancla.focus();
  }
}
