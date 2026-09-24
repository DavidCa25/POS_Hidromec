import { Injectable, signal } from '@angular/core';

/**
 * Quien abre y cierra la paleta.
 *
 * Vive en un servicio y no en un `@Input` porque la abren dos sitios que no se
 * conocen: el boton del dock y el atajo de teclado, que escucha el documento
 * entero. Pasarla por atadura obligaba a que la carcasa hiciera de cartero
 * entre dos componentes hermanos.
 */
@Injectable({ providedIn: 'root' })
export class PaletaService {
  readonly abierta = signal(false);

  abrir() { this.abierta.set(true); }
  cerrar() { this.abierta.set(false); }
  alternar() { this.abierta.update(v => !v); }
}
