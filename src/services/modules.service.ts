import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';

/**
 * Controla qué módulos OPCIONALES están activos (configurados).
 * El menú lateral se suscribe y muestra/oculta cada módulo según esto.
 * Pensado para crecer: agrega aquí cada nuevo módulo opcional.
 */
export interface ModulesState {
  pagoServicios: boolean;
}

const EMPTY: ModulesState = { pagoServicios: false };

@Injectable({ providedIn: 'root' })
export class ModulesService {
  private _mods = new BehaviorSubject<ModulesState>({ ...EMPTY });
  readonly mods$ = this._mods.asObservable();

  get snapshot(): ModulesState { return this._mods.value; }

  private get api() { return (window as any).electronAPI; }

  /** Relee la configuración y actualiza qué módulos están activos. */
  async refresh(): Promise<void> {
    const next: ModulesState = { ...EMPTY };
    try {
      const cfg = await this.api?.servicesGetConfig?.();
      const d = cfg?.data;
      next.pagoServicios = !!(d?.enabled && d?.provider);
    } catch { /* deja el módulo apagado */ }
    this._mods.next(next);
  }
}
