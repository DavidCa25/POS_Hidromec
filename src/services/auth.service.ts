import { Injectable, computed, signal } from '@angular/core';

/**
 * QUIÉN ENTRÓ, SEGÚN EL PROCESO PRINCIPAL.
 *
 * ESTO NO DECIDE NADA
 * -------------------
 * Lo que hay aquí sirve para PINTAR: qué entradas del menú se dibujan, qué
 * botón se ve. La autorización de verdad vive en el proceso principal, que
 * comprueba el paquete antes de ejecutar cada canal sensible. Si alguien
 * abriera la consola y llamara al canal a mano, la respuesta sería la misma:
 * «Tu usuario no tiene acceso a esta operación.»
 *
 * Esconder un botón no es seguridad; es cortesía. Las dos cosas hacen falta,
 * pero no son la misma y no se pueden confundir.
 *
 * DE DÓNDE SALEN LOS PAQUETES
 * ---------------------------
 * De `auth:sesion`, es decir, del mismo catálogo que autoriza. No se calculan
 * aquí a partir del rol: una segunda tabla de permisos en el renderer se
 * separaría de la primera en la primera prisa, y entonces la interfaz ofrecería
 * cosas que el backend rechaza —o, peor, escondería cosas que sí se pueden.
 */

/** Los códigos que viven en `users.rol`. No se reescriben: cambia la etiqueta. */
export type RolUsuario = 'admin' | 'supervisor' | 'cajero';

/**
 * Los siete paquetes. Es una copia del catálogo del proceso principal, y la
 * prueba `scripts/pruebas/sesion-permisos.mjs` comprueba que no se separen.
 */
export const PAQUETES = {
  VENTAS_OPERAR: 'VENTAS_OPERAR',
  VENTAS_SUPERVISAR: 'VENTAS_SUPERVISAR',
  INVENTARIO_OPERAR: 'INVENTARIO_OPERAR',
  REPORTES_VER: 'REPORTES_VER',
  CONFIGURACION_ADMINISTRAR: 'CONFIGURACION_ADMINISTRAR',
  SERVICIOS_OPERAR: 'SERVICIOS_OPERAR',
  SERVICIOS_ADMINISTRAR: 'SERVICIOS_ADMINISTRAR',
} as const;

export type Paquete = typeof PAQUETES[keyof typeof PAQUETES];

/** El retrato que devuelve el proceso principal. */
export interface AccesoSesion {
  userId: number;
  usuario: string;
  rol: RolUsuario | 'sin-rol';
  rolEtiqueta: string;
  rolConocido: boolean;
  permisos: string[];
}

export interface UsuarioSesion {
  id: number;
  nombre: string;
  rol: RolUsuario;
}

@Injectable({ providedIn: 'root' })
export class AuthService {

  /** El retrato vigente. `null` significa que no hay nadie dentro. */
  private readonly _acceso = signal<AccesoSesion | null>(null);
  readonly acceso = this._acceso.asReadonly();

  private get api(): any { return (window as any).electronAPI; }

  constructor() {
    /* Una copia en localStorage para que recargar la ventana no deje el
       encabezado en blanco un instante. Es una CACHÉ DE DIBUJO: el proceso
       principal la corrige en cuanto responde, y si dice que no hay sesión,
       se borra. Nunca es la autoridad. */
    try {
      const guardado = localStorage.getItem('accesoActual');
      if (guardado) this._acceso.set(JSON.parse(guardado) as AccesoSesion);
    } catch { /* caché ilegible: se repuebla al reconciliar */ }

    void this.reconciliar();
  }

  // ------------------------------------------------------------ lo que hay

  readonly permisos = computed(() => new Set(this._acceso()?.permisos ?? []));

  /** ¿La interfaz debe ofrecer esto? El backend lo vuelve a comprobar igual. */
  puede(paquete: Paquete | string): boolean {
    return this.permisos().has(paquete);
  }

  /** Cómo se llama su rol en pantalla. */
  readonly rolEtiqueta = computed(() => this._acceso()?.rolEtiqueta ?? 'Sin rol asignado');

  /**
   * Su rol viene de una versión que este binario no conoce.
   *
   * No se le da el rol más restringido: se le dan CERO paquetes. Operador
   * puede vender y abrir turno, y regalar eso a un valor que nadie entiende
   * sería peor que dejar a la persona sin acceso. Entra, se identifica, y un
   * administrador lo resuelve desde la pantalla de usuarios.
   */
  readonly sinRol = computed(() => {
    const a = this._acceso();
    return !!a && !a.rolConocido;
  });

  get usuarioActual(): UsuarioSesion | null {
    const a = this._acceso();
    return a ? { id: a.userId, nombre: a.usuario, rol: a.rol as RolUsuario } : null;
  }

  get usuarioActualId(): number | null { return this._acceso()?.userId ?? null; }

  get usuarioActualRol(): RolUsuario | null {
    const a = this._acceso();
    return a && a.rolConocido ? (a.rol as RolUsuario) : null;
  }

  get esAdmin(): boolean { return this._acceso()?.rol === 'admin'; }

  /**
   * Abrir el cajón sin una venta detrás.
   *
   * Antes decía `admin || cajero`, que era justo al revés de lo que se quería:
   * es una de las tres operaciones contra las que nació el blindaje anti robo
   * hormiga, y quien la tenía por omisión era precisamente quien está en la
   * caja. Ahora es el paquete de supervisión, con autorización presencial para
   * quien no lo tenga.
   */
  get puedeAbrirCajon(): boolean { return this.puede(PAQUETES.VENTAS_SUPERVISAR); }

  get puedeRegistrarVenta(): boolean { return this.puede(PAQUETES.VENTAS_OPERAR); }

  // ------------------------------------------------------------- el ciclo

  /**
   * Pregunta al proceso principal quién hay dentro y se queda con su respuesta.
   *
   * Se llama al construir el servicio y después de cada cambio que pueda
   * afectar a los permisos. Si el proceso principal dice que no hay sesión
   * —porque la ventana es nueva tras un fallo, o porque desactivaron a esa
   * persona desde otra caja—, esto se vacía y la interfaz deja de ofrecer nada.
   */
  async reconciliar(): Promise<AccesoSesion | null> {
    try {
      const r = await this.api?.sesion?.();
      const acceso = (r?.success && r.data) ? r.data as AccesoSesion : null;
      this.fijar(acceso);
      return acceso;
    } catch {
      /* Sin puente —pruebas, navegador— se conserva lo que hubiera. */
      return this._acceso();
    }
  }

  /** Tras un login correcto: el retrato viene del proceso principal. */
  entrar(acceso: AccesoSesion) { this.fijar(acceso); }

  async salir() {
    try { await this.api?.cerrarSesion?.(); } catch { /* igualmente se limpia */ }
    this.fijar(null);
  }

  /** Compatibilidad con el código que todavía llama `logout()`. */
  logout() { void this.salir(); }

  private fijar(acceso: AccesoSesion | null) {
    this._acceso.set(acceso);
    try {
      if (acceso) localStorage.setItem('accesoActual', JSON.stringify(acceso));
      else localStorage.removeItem('accesoActual');
      /* La clave vieja desaparece: guardaba un rol que el renderer se creía. */
      localStorage.removeItem('usuarioActual');
    } catch { /* sin almacenamiento: la sesión sigue viva en el proceso */ }
  }
}
