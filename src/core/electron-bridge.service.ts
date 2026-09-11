import { Injectable } from '@angular/core';

/**
 * Unico punto de acceso del Core a `window.electronAPI`.
 *
 * No envuelve los 158 handlers (Strangler: se migran conforme se tocan). Solo
 * evita que cada servicio repita `(window as any).electronAPI` y da un sitio
 * donde comprobar disponibilidad (en `ng serve` no existe).
 */
@Injectable({ providedIn: 'root' })
export class ElectronBridge {
  get api(): any {
    return (window as any).electronAPI ?? null;
  }

  get disponible(): boolean {
    return !!this.api;
  }

  /** Normaliza el resultado de un handler que devuelve recordset o array. */
  filas<T = any>(rs: any): T[] {
    if (Array.isArray(rs)) return rs as T[];
    if (Array.isArray(rs?.recordset)) return rs.recordset as T[];
    if (Array.isArray(rs?.data)) return rs.data as T[];
    return [];
  }
}
