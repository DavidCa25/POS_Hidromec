import { Capabilities } from './models';

/*
 * Catalogo de MODULOS OPCIONALES de Wybix.
 *
 * Configurar el sistema y activar una capacidad completa son dos cosas
 * distintas. "Datos del negocio" es donde se pone el RFC y el pie del ticket;
 * encender Fidelizacion entera desde ahi era esconder una decision grande
 * dentro de una pantalla pequena, y ademas empujaba a Configuracion hacia la
 * saturacion que ya se estaba intentando reducir.
 *
 * POR QUE UN CATALOGO ESTATICO
 * ---------------------------
 * Un modulo no es un dato del negocio: es una parte del PRODUCTO. Su nombre,
 * su descripcion y su icono viajan con la version instalada, igual que las
 * pantallas que enciende. Guardarlo en SQL significaria que una base vieja
 * describiria mal un modulo nuevo, y que habria que migrar texto.
 *
 * Lo que SI vive fuera es el estado -encendido o apagado-, y eso ya lo
 * gobierna `CapabilityService` contra `business_config`. Aqui no hay un
 * segundo sistema de banderas: solo la descripcion de lo que se puede
 * encender.
 *
 * PARA ANADIR UN MODULO
 * ---------------------
 * Una entrada en esta lista y una capacidad en `Capabilities`. Nada mas: ni
 * otra pantalla de activacion, ni otra tarjeta en Configuracion.
 */

export type ModuleCategory = 'VENTAS' | 'OPERACION' | 'INTEGRACIONES';

export interface ModuleDefinition {
  id: string;
  name: string;
  /** Una frase. Lo que el negocio gana, no como esta hecho por dentro. */
  description: string;
  /** Un par de lineas mas, para quien duda si le sirve. */
  detalle?: string;
  /** Icono Phosphor, sin el prefijo `ph-`. */
  icon: string;
  category: ModuleCategory;
  /** La capacidad de `Capabilities` que enciende. */
  capability: keyof Capabilities;
  /** A donde lleva cuando esta encendido. */
  route?: string;
  /** Que aparece en el menu al encenderlo, para decirlo antes de pulsar. */
  aparece?: string;
}

export const CATEGORIAS: Record<ModuleCategory, string> = {
  VENTAS: 'Ventas y clientes',
  OPERACION: 'Operación',
  INTEGRACIONES: 'Integraciones',
};

/**
 * Los modulos que existen HOY.
 *
 * No se listan modulos futuros: una tarjeta "Proximamente" que lleva dos anos
 * ahi deja de leerse y empieza a estorbar.
 */
export const MODULOS: ModuleDefinition[] = [
  {
    id: 'loyalty',
    name: 'Fidelización',
    description: 'Campañas, recompensas, cupones, dinámicas y rifas.',
    detalle: 'Premia solo al cobrar: un producto gratis, un cupón para la próxima visita, ' +
             'un boleto de rifa o un juego en la pantalla del cliente. Lo decide el servidor, ' +
             'igual en todas las cajas.',
    icon: 'gift',
    category: 'VENTAS',
    capability: 'loyalty',
    route: '/dashboard/fidelizacion',
    aparece: 'Fidelización, en el menú principal',
  },
];
