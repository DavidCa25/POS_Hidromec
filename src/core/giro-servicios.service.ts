import { Injectable, computed, inject, signal } from '@angular/core';
import { ElectronBridge } from './electron-bridge.service';
import {
  PRESETS_SERVICIOS, PRESET_POR_DEFECTO, PresetMaterial, PresetServicios, PresetTextos,
  buscarPreset,
} from './presets-servicios';

/**
 * EL GIRO DE SERVICIOS: qué clase de negocio de servicios es este.
 *
 * Un taller y una barbería usan el mismo módulo y no se parecen en nada al
 * abrirlo. El taller quiere ver órdenes y llama «vehículo» a lo que entra; la
 * barbería quiere ver la agenda y no tiene nada que registrar aparte de la
 * persona. Sin esto, las dos veían lo mismo: la pantalla de un taller, con
 * una columna de placas que a la barbería nunca le sirve para nada.
 *
 * EL GIRO NO ES UNA JAULA
 * -----------------------
 * Es un punto de partida. Cambia qué pestaña abre, qué pestañas se ofrecen y
 * cómo se llaman las cosas; no borra nada ni cierra ninguna puerta. Un taller
 * que empiece a dar citas cambia de giro —o enciende la agenda— y su historial
 * sigue exactamente donde estaba.
 *
 * SIN GIRO ELEGIDO NO PASA NADA MALO
 * ----------------------------------
 * Toda instalación anterior a esto encendió Servicios cuando los giros no
 * existían. Su fila no está, `preset` llega en null, y se resuelve con el
 * genérico: todas las pestañas, órdenes primero y vocabulario neutro, que es
 * literalmente lo que veían antes. Actualizar no le cambia la pantalla a
 * nadie por la espalda.
 */
@Injectable({ providedIn: 'root' })
export class GiroServiciosService {
  private readonly bridge = inject(ElectronBridge);

  /** El identificador guardado, o null mientras no se sabe o nadie eligió. */
  private readonly elegido = signal<string | null>(null);
  readonly cargado = signal(false);

  /** Los giros que existen. La lista viene del JSON compartido, no de aquí. */
  readonly catalogo: PresetServicios[] = PRESETS_SERVICIOS;

  /** El giro vigente, ya resuelto: nunca null, para que nadie tenga que mirarlo. */
  readonly giro = computed<PresetServicios>(() => buscarPreset(this.elegido()));

  /** Si este negocio eligió alguna vez, que no es lo mismo que el giro vigente. */
  readonly haElegido = computed(() => this.elegido() !== null);

  private enVuelo: Promise<void> | null = null;

  async cargar(forzar = false): Promise<void> {
    if (this.cargado() && !forzar) return;
    /* Una recarga forzada no se engancha a la que ya estaba en vuelo: empezó
       antes del cambio y devolvería justo el estado que se quiere tirar. */
    if (this.enVuelo && !forzar) return this.enVuelo;
    this.enVuelo = (async () => {
      try {
        const r = await this.bridge.api?.serviciosConfig?.();
        const fila = this.bridge.filas<{ preset: string | null }>(r)[0];
        const v = fila?.preset ? String(fila.preset).trim().toUpperCase() : '';
        this.elegido.set(v || null);
      } catch {
        /* Sin respuesta se deja sin elegir, que da el comportamiento neutro.
           Un módulo que no se dibuja porque no pudo preguntar de qué giro es
           sería mucho peor que uno que se dibuja genérico. */
        this.elegido.set(null);
      }
      this.cargado.set(true);
    })();
    await this.enVuelo;
    this.enVuelo = null;
  }

  /**
   * Elegir giro. Enciende Servicios en el mismo movimiento —lo hace el
   * procedimiento, no esta pantalla— y deja el estado local al día.
   */
  async elegir(presetId: string): Promise<{ ok: boolean; error?: string }> {
    const r = await this.bridge.api?.serviciosElegirGiro?.(presetId);
    if (!r?.success) return { ok: false, error: r?.error || 'No se pudo guardar el giro.' };
    this.elegido.set(String(presetId).trim().toUpperCase());
    this.cargado.set(true);
    return { ok: true };
  }

  /** Lo que se olvida al cerrar sesión o al cambiar de base. */
  olvidar(): void {
    this.elegido.set(null);
    this.cargado.set(false);
  }

  // ------------------------------------------------- atajos de vocabulario
  //
  // Existen para que las plantillas no tengan que escribir
  // `giro().activo.singular` catorce veces y para que, si mañana el
  // vocabulario se vuelve más fino, haya un solo sitio donde tocarlo.

  /** Cómo se llama aquí la cosa sobre la que se trabaja: «Vehículo», «Equipo». */
  get activoSingular(): string { return this.giro().activo.singular; }
  get activoPlural(): string { return this.giro().activo.plural; }
  /** Cómo se llama su identificador: «Placa», «Número de serie». */
  get activoIdentificador(): string { return this.giro().activo.identificador; }

  /**
   * Si la pantalla de activos se OFRECE.
   *
   * Es distinto de exigirlos. Una barbería no tiene nada que registrar aparte
   * de la persona que viene, y una pestaña «Equipos» en su menú es ruido
   * permanente; un técnico de mantenimiento a veces trabaja sobre un equipo y
   * a veces hace una visita sin equipo de por medio, y ahí sí tiene sentido
   * ofrecerlo sin reclamarlo.
   */
  get usaActivos(): boolean { return this.giro().activo.usa !== 'NO'; }

  /**
   * Si la orden se queda coja sin él, y por tanto se pregunta al abrirla.
   *
   * En un taller llega el coche antes que nada. En mantenimiento no siempre,
   * así que se puede indicar después y no se interrumpe la recepción con un
   * diálogo que la mitad de las veces se cancela.
   */
  get activoCentral(): boolean { return this.giro().activo.usa === 'CENTRAL'; }

  /** Los tipos de activo que este giro ofrece. Vacío cuando no usa activos. */
  get tiposDeActivo(): string[] { return this.giro().activo.tipos ?? []; }

  get usaAgenda(): boolean { return this.giro().agenda; }
  /** La pestaña que abre el módulo. */
  get inicio(): string { return this.giro().inicio; }

  /** Cómo se llama aquí lo que se consume o se vende junto al trabajo. */
  get material(): PresetMaterial { return this.giro().material; }
  /** Los textos del giro. Las plantillas leen de aquí, no de condicionales. */
  get textos(): PresetTextos { return this.giro().textos; }

  /**
   * Si la autorización del cliente manda en este flujo.
   *
   * `REQUERIDA` en taller y electrónica: se diagnostica, se cotiza y no se
   * toca nada hasta el «sí». `DISCRETA` en belleza: el precio de un corte se
   * conoce al agendar, y pedir una autorización por cada corte convierte el
   * botón en un trámite que se pulsa sin leer. El motor es el mismo en los
   * tres casos; lo que cambia es cuánto pesa en la pantalla.
   */
  get autorizacionRequerida(): boolean { return this.giro().autorizacion === 'REQUERIDA'; }
  get autorizacionDiscreta(): boolean { return this.giro().autorizacion === 'DISCRETA'; }

  /** El giro con el que se queda quien no ha elegido. */
  static readonly POR_DEFECTO = PRESET_POR_DEFECTO;
}
