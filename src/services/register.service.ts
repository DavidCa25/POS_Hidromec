import { Injectable } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class RegisterService {
  private _id: number | null = null;
  private _name: string | null = null;

  private get api() {
    return (window as any).electronAPI;
  }

  /** Cargar la identidad de caja de esta máquina al arrancar la app. */
  async load(): Promise<void> {
    try {
      const rs = await this.api?.registerGetCurrent?.();
      this._id = rs?.data?.registerId ?? null;
      this._name = rs?.data?.registerName ?? null;
    } catch {
      this._id = null;
      this._name = null;
    }
  }

  get registerId(): number | null {
    return this._id;
  }

  get registerName(): string | null {
    return this._name;
  }

  /** ¿Ya está configurada la caja de esta máquina? */
  get isConfigured(): boolean {
    return this._id != null;
  }

  /**
   * Fijar la caja de esta máquina (desde el panel de configuración).
   *
   * El proceso principal RECLAMA la caja en SQL antes de guardarla: si la
   * tiene otro equipo, aquí no cambia nada y se lanza el motivo, con el
   * nombre de esa máquina. Antes este método ignoraba la respuesta y guardaba
   * siempre, así que la pantalla podía decir "esta máquina es la Caja 2"
   * mientras cada venta se rechazaba por lo contrario.
   */
  async setCurrent(id: number, name?: string): Promise<void> {
    const rs = await this.api?.registerSetCurrent?.({ id, name });
    if (rs && rs.success === false) {
      throw new Error(rs.error || 'No se pudo asignar la caja.');
    }
    this._id = id;
    this._name = name ?? null;
  }
}
