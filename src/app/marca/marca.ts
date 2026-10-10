/**
 * MARCA — los huecos que un addon de cliente puede llenar.
 *
 * El núcleo nunca pregunta por un cliente. Pregunta por un HUECO: «¿hay una
 * mascota de marca?», «¿hay un fondo para Touch?». Si un addon lo llena, se usa;
 * si no, Wybix se ve como siempre. Un `if (cliente === 'X')` está prohibido.
 *
 * Los addons viven en `custom-addons/<id>/` y se incluyen AL COMPILAR
 * (`npm run dist:addon -- <id>`). Un build sin addon no lleva ni un byte suyo.
 * Detalle y reglas: `custom-addons/README.md`.
 *
 * Este archivo es el CONTRATO. Cambiarlo es cambiar lo que todos los addons
 * prometen: se agrega, no se rompe.
 */
import type { EstadoMascota } from '../wx-mascota/wx-mascota.component';

/** Una mascota ya montada en pantalla. */
export interface MascotaViva {
  /** Mismos cuatro estados que Wybix: el addon decide cómo se ven. */
  estado(estado: EstadoMascota): void;
  /** Libera bucle de animación, observadores y nodos. */
  destruir(): void;
}

/** El personaje de la marca que sustituye a Wybix (Blobatar) como mascota. */
export interface MascotaDeMarca {
  /** Cómo se llama, para lectores de pantalla. */
  nombre: string;
  /**
   * Monta el personaje dentro de `host`, que ya tiene el tamaño final.
   * Se llama fuera de la zona de Angular: el bucle de animación no dispara
   * detección de cambios.
   */
  montar(host: HTMLElement, opciones: { tam: number }): MascotaViva;
}

/**
 * Fondo de marca detrás del catálogo de Touch. Las imágenes ya traen su
 * transparencia: el núcleo no decide qué tan visible es una marca ajena.
 */
export interface FondoDeMarca {
  /** Ruta bajo `assets/addon/` para tema claro y tema oscuro. */
  claro: string;
  oscuro: string;
  /** Tamaño de cada mosaico, en CSS (`background-size`). */
  tamano: string;
}

export interface AddonWybix {
  /** Igual que su carpeta: `wybix_<cliente>`. */
  id: string;
  /** Nombre del cliente, para soporte y registros. */
  nombre: string;
  /** Carga perezosa: el motor del personaje no entra al paquete inicial. */
  mascota?: () => Promise<MascotaDeMarca>;
  /** La mascota también acompaña el cobro en Touch. */
  mascotaEnTouch?: boolean;
  fondoTouch?: FondoDeMarca;
}
