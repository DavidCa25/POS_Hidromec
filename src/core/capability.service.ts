import { Injectable, computed, inject, signal } from '@angular/core';
import { ElectronBridge } from './electron-bridge.service';
import { BusinessProfile, Capabilities, DeviceProfile } from './models';

/**
 * negocio + dispositivo -> capacidades.
 *
 *   BUSINESS PROFILE  -> SQL, business_config.business_profile
 *                        (RETAIL | HOSPITALITY). Una sola fuente: no existe
 *                        un `hospitality_enabled` aparte.
 *   DEVICE PROFILE    -> device-config.json local
 *                        (BACKOFFICE | RETAIL_POS | TOUCH_POS).
 *
 * Los clientes existentes no tienen ninguno de los dos: se asume RETAIL y
 * RETAIL_POS, que es exactamente el comportamiento de hoy. Cambiar una caja de
 * Retail a Touch solo cambia device-config.json y la experiencia cargada.
 */
@Injectable({ providedIn: 'root' })
export class CapabilityService {
  private readonly bridge = inject(ElectronBridge);

  readonly businessProfile = signal<BusinessProfile>('RETAIL');
  readonly deviceProfile = signal<DeviceProfile>('RETAIL_POS');
  readonly customerDisplayEnabled = signal(false);
  /**
   * Fidelizacion encendida para el NEGOCIO, no para este equipo.
   *
   * Vive en business_config junto a business_profile, no en
   * device-config.json: una campana la lanza el negocio y la ven todas las
   * cajas. Si dependiera del dispositivo, la Caja 2 regalaria cafes que la
   * Caja 1 no conoce.
   */
  readonly loyaltyEnabled = signal(false);
  /** Los modulos encendidos del NEGOCIO, tal cual los da `business_modules`. */
  readonly modulos = signal<Set<string>>(new Set());
  readonly loaded = signal(false);

  /**
   * De la capacidad del producto a la clave del registro.
   *
   * Solo estan las que se pueden encender desde Aplicaciones. `touchPos` o
   * `customerDisplay` no aparecen porque son del DISPOSITIVO, no del negocio,
   * y viven en device-config.json.
   */
  private static readonly CLAVE_DE_MODULO: Partial<Record<keyof Capabilities, string>> = {
    loyalty: 'loyalty',
    hospitality: 'hospitality',
    servicios: 'servicios',
  };

  readonly capabilities = computed<Capabilities>(() => {
    const bp = this.businessProfile();
    const dp = this.deviceProfile();
    return {
      businessProfile: bp,
      deviceProfile: dp,
      /* Deja de ser el perfil y pasa a ser un modulo, que es lo que permite
         Retail + Hospitality y Retail + Servicios. El perfil queda como
         preset de origen, no como interruptor. */
      hospitality: this.modulos().has('hospitality'),
      touchPos: dp === 'TOUCH_POS',
      retailPos: dp === 'RETAIL_POS',
      customerDisplay: this.customerDisplayEnabled(),
      loyalty: this.modulos().has('loyalty'),
      /* Se suma a lo que ya haya: un taller es Retail + Servicios, y una
         cafeteria con salon de belleza es Hospitality + Servicios. Los
         perfiles se excluyen; los modulos se suman. */
      servicios: this.modulos().has('servicios'),
    };
  });

  get hospitality(): boolean { return this.capabilities().hospitality; }
  get touchPos(): boolean { return this.capabilities().touchPos; }
  get loyalty(): boolean { return this.capabilities().loyalty; }
  get servicios(): boolean { return this.capabilities().servicios; }

  /**
   * Donde vende ESTA caja ahora mismo.
   *
   * Una sola definicion para el menu, el guard de ruta y la entrada tras el
   * login. Antes la decision vivia unicamente en el login, asi que cambiar la
   * experiencia en Configuracion no tenia efecto hasta volver a entrar: nadie
   * mas se lo preguntaba.
   *
   * BACKOFFICE se resuelve como Retail a proposito: es el comportamiento de
   * hoy, y este cambio no es el sitio para estrenar uno nuevo.
   */
  get rutaDeVenta(): string {
    return this.deviceProfile() === 'TOUCH_POS' ? '/touch' : '/dashboard/venta';
  }

  private inflight: Promise<Capabilities> | null = null;

  async load(force = false): Promise<Capabilities> {
    if (this.loaded() && !force) return this.capabilities();
    // Una recarga FORZADA no puede engancharse a una peticion que empezo antes
    // del cambio: devolveria justo el estado que se quiere tirar. Solo las no
    // forzadas comparten la que ya esta en vuelo.
    if (this.inflight && !force) return this.inflight;
    this.inflight = (async () => {
      const api = this.bridge.api;
      /* EL REGISTRO MANDA, LA CONFIGURACION ES EL RESPALDO.
         `business_modules` es la fuente unica desde Core 0. Mientras dure la
         ventana de compatibilidad, `sp_set_business_module` escribe tambien
         las columnas antiguas, asi que si el registro no existe todavia -base
         anterior a la migracion- leerlas da exactamente el mismo resultado.
         `business_profile` se conserva solo como preset de origen. */
      let delRegistro: Set<string> | null = null;
      try {
        const rs = await api?.modulosLista?.();
        if (rs?.success && Array.isArray(rs.data) && rs.data.length) {
          delRegistro = new Set(
            rs.data.filter((m: any) => m.enabled === true || m.enabled === 1)
                   .map((m: any) => String(m.module_key)));
        }
      } catch { /* sin registro: se cae al respaldo de abajo */ }

      try {
        const cfg = await api?.getConfig?.();
        const c = cfg?.data ?? cfg ?? {};
        this.businessProfile.set(CapabilityService.parseBusiness(c?.business_profile));
        this.modulos.set(delRegistro ?? new Set(c?.loyalty_enabled ? ['loyalty'] : []));
        if (!delRegistro && CapabilityService.parseBusiness(c?.business_profile) === 'HOSPITALITY') {
          this.modulos.update(m => new Set([...m, 'hospitality']));
        }
        this.loyaltyEnabled.set(this.modulos().has('loyalty'));
      } catch {
        this.businessProfile.set('RETAIL');
        this.modulos.set(delRegistro ?? new Set());
        this.loyaltyEnabled.set(this.modulos().has('loyalty'));
      }
      try {
        const dev = await api?.getDeviceConfig?.();
        const d = dev?.data ?? dev ?? {};
        this.deviceProfile.set(CapabilityService.parseDevice(d?.deviceProfile));
        this.customerDisplayEnabled.set(!!d?.customerDisplay?.enabled);
      } catch { this.deviceProfile.set('RETAIL_POS'); }
      this.loaded.set(true);
      return this.capabilities();
    })();
    // En `finally` y no dentro del cuerpo: si algo falla ahi, dejar `inflight`
    // puesto dejaria el servicio incapaz de recargar durante toda la sesion.
    const enVuelo = this.inflight.finally(() => { this.inflight = null; });
    this.inflight = enVuelo;
    return enVuelo;
  }

  /**
   * Enciende o apaga un MODULO opcional.
   *
   * Punto unico: lo llama el administrador de Aplicaciones y nadie mas. El
   * interruptor que vivia en "Datos del negocio" se retiro precisamente para
   * que no hubiera dos sitios donde encender lo mismo y acabaran
   * contradiciendose.
   *
   * El estado sigue viviendo donde tecnicamente corresponde -`business_config`
   * en SQL, porque un modulo lo enciende el NEGOCIO y lo ven todas las cajas-.
   * Lo que cambio es quien lo administra.
   */
  async setModulo(capability: keyof Capabilities, activo: boolean): Promise<void> {
    /* El `if (capability !== 'loyalty')` que habia aqui era la razon por la
       que anadir un modulo exigia tocar este archivo. Ahora la clave viaja al
       registro y el catalogo de `modulos.ts` decide que se ofrece. */
    const clave = CapabilityService.CLAVE_DE_MODULO[capability];
    if (!clave) {
      throw new Error(`El módulo "${capability}" no se puede activar desde aquí.`);
    }
    const rs = await this.bridge.api?.modulosSet?.(clave, activo);
    if (rs && rs.success === false) {
      throw new Error(rs.error || 'No se pudo cambiar el módulo.');
    }
    // Se relee de SQL en vez de fiarse: si el guardado no cuajo, la pantalla
    // tiene que mostrarlo apagado, no lo que acabamos de pulsar.
    await this.load(true);
  }

  /** El nombre guardado, para no perderlo al escribir la configuracion. */
  private async nombreDelNegocio(): Promise<string> {
    const cfg = await this.bridge.api?.getConfig?.();
    const c = cfg?.data ?? cfg ?? {};
    return c?.business_name || c?.nombre || 'Mi negocio';
  }

  /** Cambia el perfil de ESTE dispositivo. No reinstala ni toca la base. */
  async setDeviceProfile(p: DeviceProfile): Promise<void> {
    await this.bridge.api?.setDeviceConfig?.({ deviceProfile: p });
    this.deviceProfile.set(p);
  }

  static parseBusiness(v: any): BusinessProfile {
    return String(v || '').toUpperCase() === 'HOSPITALITY' ? 'HOSPITALITY' : 'RETAIL';
  }

  static parseDevice(v: any): DeviceProfile {
    const s = String(v || '').toUpperCase();
    if (s === 'TOUCH_POS') return 'TOUCH_POS';
    if (s === 'BACKOFFICE') return 'BACKOFFICE';
    return 'RETAIL_POS';
  }
}
