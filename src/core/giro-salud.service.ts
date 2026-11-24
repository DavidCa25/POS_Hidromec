import { Injectable, computed, inject, signal } from '@angular/core';
import definicion from '../../electron/salud/presets.json';
import { ElectronBridge } from './electron-bridge.service';

/** Un giro de Salud, tal cual viene de electron/salud/presets.json. */
export interface PresetSalud {
  id: string;
  nombre: string;
  ejemplos: string;
  icono: string;
  orden: number;
  farmacia: boolean;
  clinica: boolean;
  dental: boolean;
  /** Laboratorio clínico o imagen (rayos X, mastografía, ultrasonido). */
  estudios: boolean;
  /** La pestaña con la que abre el módulo. */
  inicio: 'farmacia' | 'pacientes' | 'estudios';
}

/** La MISMA lista que valida el proceso principal: no hay dos copias. */
export const PRESETS_SALUD: PresetSalud[] = [...(definicion.presets as PresetSalud[])]
  .sort((a, b) => (a.orden ?? 99) - (b.orden ?? 99));

interface ConfigSalud { preset: string; farmacia: boolean; clinica: boolean; dental: boolean; estudios: boolean; }

/**
 * QUÉ PARTES DE SALUD USA ESTE NEGOCIO.
 *
 * Lo pregunta el menú, el guard y cada pantalla del módulo. Igual que
 * GiroServiciosService: se carga una vez por sesión y se fuerza al cambiar
 * el giro. Lo que se guarda (farmacia, clínica, dental) sale de la base, no
 * del preset: si mañana el preset cambia de forma, un negocio configurado
 * sigue viendo lo que eligió.
 */
@Injectable({ providedIn: 'root' })
export class GiroSaludService {
  private readonly bridge = inject(ElectronBridge);

  private readonly config = signal<ConfigSalud | null>(null);
  readonly cargado = signal(false);
  readonly catalogo = PRESETS_SALUD;

  readonly giro = computed<PresetSalud | null>(() =>
    PRESETS_SALUD.find((p) => p.id === this.config()?.preset) ?? null);
  readonly haElegido = computed(() => this.config() !== null);
  readonly farmacia = computed(() => !!this.config()?.farmacia);
  readonly clinica = computed(() => !!this.config()?.clinica);
  readonly dental = computed(() => !!this.config()?.dental);
  readonly estudios = computed(() => !!this.config()?.estudios);

  /** A dónde entra el módulo: la farmacia, los pacientes o los estudios. */
  get inicio(): string { return this.farmacia() ? 'farmacia' : this.clinica() ? 'pacientes' : 'estudios'; }

  private enVuelo: Promise<void> | null = null;

  async cargar(forzar = false): Promise<void> {
    if (this.cargado() && !forzar) return;
    if (this.enVuelo && !forzar) return this.enVuelo;
    this.enVuelo = (async () => {
      try {
        const r = await this.bridge.api?.saludConfig?.();
        const f = this.bridge.filas<any>(r)[0];
        this.config.set(f ? { preset: String(f.preset), farmacia: !!f.farmacia, clinica: !!f.clinica, dental: !!f.dental, estudios: !!f.estudios } : null);
      } catch {
        this.config.set(null);
      }
      this.cargado.set(true);
    })();
    await this.enVuelo;
    this.enVuelo = null;
  }

  async elegir(presetId: string): Promise<{ ok: boolean; error?: string }> {
    const r = await this.bridge.api?.saludElegirGiro?.(presetId);
    if (!r?.success) return { ok: false, error: r?.error || 'No se pudo guardar el giro.' };
    await this.cargar(true);
    return { ok: true };
  }

  olvidar(): void {
    this.config.set(null);
    this.cargado.set(false);
  }
}
