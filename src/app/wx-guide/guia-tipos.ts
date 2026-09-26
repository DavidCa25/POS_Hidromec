/*
 * WYBIX GUIDE — EL CONTRATO DE UN RECORRIDO.
 *
 * Un recorrido es DATOS: que pantalla, que elemento, que se dice, que se
 * espera y, en una demostracion, que se hace. El motor (`GuiaRunnerService`)
 * no sabe nada de ventas ni de inventario: sabe navegar, esperar, señalar,
 * hablar y actuar. Un escenario nuevo es un archivo mas en `escenarios/`, no
 * un cambio en el motor.
 *
 * Los elementos se señalan SOLO por `data-guide` (y, en una lista, por
 * `data-guide-clave`). Nunca por clase, posicion o texto: una clase cambia
 * con el diseño y un recorrido que dependiera de ella se romperia sin avisar.
 */

/** Como esta Wybix ahora. Cambia la expresion y el gesto, jamas el personaje. */
export type EstadoGuia =
  | 'idle' | 'speaking' | 'pointing' | 'waiting' | 'thinking' | 'success' | 'attention' | 'error';

/**
 * Como se presenta Wybix. Es la MISMA figura con otro encuadre:
 *   presentador  asomandose por encima de la franja (recorridos)
 *   demo         mas grande, protagonista (demostracion automatica)
 *   compacto     cabeza del globo, pequeño (consejos y primer uso)
 */
export type Presencia = 'presentador' | 'demo' | 'compacto';

/** Un elemento de la pantalla, por su contrato `data-guide`. */
export interface Objetivo {
  guia: string;
  /**
   * En una lista: `data-guide-clave`. Siempre un identificador estable (el id
   * de la mesa, de la comanda; el SKU de un producto), nunca el texto que se
   * ve. Puede venir de la memoria de la vuelta: `{mem.comandaId}`.
   */
  clave?: string;
  /** `data-guide-estado`: la primera mesa LIBRE, por ejemplo. */
  estado?: string;
}

/** Lo que tiene que ser verdad para mostrar un escenario o un paso. */
export interface Requisitos {
  /** Areas de la navegacion que esta persona ve (misma regla que el dock). */
  areas?: string[];
  /** Capacidades del negocio: 'hospitality', 'mesas', 'comandas', 'servicios'… */
  capacidades?: string[];
  /** Capacidades que NO debe tener (una variante del paso para el otro caso). */
  sinCapacidades?: string[];
  /**
   * El giro de Servicios, tal como lo describe `GiroServiciosService`: por
   * donde empieza el dia, si trabaja sobre algo (vehiculo, equipo) y si tiene
   * agenda. Implica Servicios encendido.
   */
  giro?: { inicio?: 'agenda' | 'ordenes'; usaActivos?: boolean; usaAgenda?: boolean };
  /** Paquetes de permisos (AuthService.puede). */
  paquetes?: string[];
  /** Solo en una caja Touch, o solo fuera de ella. */
  touch?: boolean;
  /** Perfiles de demo en los que tiene sentido (Demo Manager). */
  perfilDemo?: string[];
  /** Giros de la demo de Servicios (`demo_preset`): TALLER_AUTOMOTRIZ, BELLEZA… */
  presetDemo?: string[];
  /**
   * El turno de esta caja: abierto (true) o no (false). Un recorrido que pasa
   * por Venta ENSEÑA a abrirlo cuando falta, en vez de toparse con el aviso.
   */
  turno?: boolean;
}

/** Que completa un paso en la guia manual. */
export type Espera =
  | { tipo: 'boton' }                                   // «Siguiente» / «Entendido»
  | { tipo: 'pulsa'; objetivo?: Objetivo }              // la persona toca el objetivo
  | { tipo: 'aparece'; objetivo: Objetivo }             // algo nuevo en pantalla
  | { tipo: 'desaparece'; objetivo: Objetivo }          // se cerro / se guardo
  | { tipo: 'valor'; objetivo?: Objetivo }              // escribio algo en el campo
  | { tipo: 'ruta'; prefijo: string }                   // llego a una pantalla
  | { tipo: 'hecho'; nombre: string };                  // el NEGOCIO lo confirma (guia-acciones)

/** Lo que hace Wybix solo, en una demostracion. */
export type Accion =
  | { tipo: 'pulsar'; objetivo: Objetivo }
  | { tipo: 'escribir'; objetivo: Objetivo; texto: string }
  | { tipo: 'elegir'; objetivo: Objetivo; valor?: string }
  | { tipo: 'navegar'; ruta: string }
  | { tipo: 'dominio'; nombre: string }
  | { tipo: 'pausa'; ms: number };

export interface Paso {
  id: string;
  /** Se navega aqui con el router antes del paso, salvo que ya se este EN ella
      (ruta exacta: `/touch` no es `/touch/mesas`). Terminada en `/**`, vale
      cualquier pantalla de debajo: `/dashboard/ordenes-de-servicio/**`.
      Puede depender del negocio. */
  ruta?: string | ((c: ContextoGuia) => string);
  /** Lo que se señala. Sin objetivo, Wybix habla sin foco. */
  objetivo?: Objetivo;
  /** Lo que dice. `{nombre}` es quien entro. */
  mensaje: string;
  /** El estado mientras espera (por defecto: `pointing` con objetivo, `idle` sin el). */
  estado?: EstadoGuia;
  /** Guia manual: que lo completa. Por defecto, un boton. */
  espera?: Espera;
  /** El texto del boton cuando la espera es un boton. */
  cta?: 'Siguiente' | 'Entendido' | 'Empezar' | 'Terminar';
  /** Demo automatica: lo que hace Wybix, en orden. */
  acciones?: Accion[];
  /** Demo: que esperar despues de actuar en la PANTALLA (un formulario que se abre). */
  despues?: Espera;
  /**
   * La verdad del paso: un HECHO del negocio (`guia-acciones`). Manda sobre el
   * DOM: si el negocio dice que ya paso, el paso esta hecho aunque el boton
   * aun no se haya pintado.
   */
  verifica?: string;
  /**
   * Si esto ya es verdad, el paso esta HECHO y no se repite: al reanudar tras
   * tomar el control, o si la persona ya lo hizo a mano. Casi siempre es el
   * mismo hecho que `verifica`.
   */
  logrado?: Espera;
  requiere?: Requisitos;
  /** Si el objetivo no existe en esta pantalla, el paso se salta (un campo que depende del producto). */
  opcional?: boolean;
  /** Cuanto se espera al objetivo, en ms. Para el primer campo de un
      formulario que tarda en abrir (o que no abre: sin clientes no hay cita). */
  limite?: number;
}

export interface Escenario {
  id: string;
  titulo: string;
  descripcion: string;
  minutos: number;
  /** `guia` enseña (nunca crea datos); `demo` actua, y solo en una demo segura. */
  modo: 'guia' | 'demo';
  grupo: 'inicio' | 'esencial' | 'giro' | 'demo';
  icono: string;
  requiere?: Requisitos;
  /**
   * Demo: lo que necesita antes del primer paso se prepara con la preparacion
   * del mismo id (`guia-acciones`). Idempotente.
   */
  prepara?: boolean;
  /** Lo que la demo da por hecho, dicho para personas (informes y diagnostico). */
  necesita?: string[];
  /** Demo: el hecho que confirma que todo el recorrido llego a su fin. */
  verificaFinal?: string;
  pasos: Paso[];
}

/** Lo que el motor sabe del negocio y de quien opera, para decidir rutas y filtros. */
export interface ContextoGuia {
  nombre: string;
  rutaDeVenta: string;
  touch: boolean;
  perfilDemo: string | null;
  /** El giro de la demo de Servicios, si lo hay. */
  presetDemo: string | null;
}
