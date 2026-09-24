import {
  ChangeDetectionStrategy, Component, Input, OnChanges, signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';

/**
 * WX-AVATAR — una cara para cada cliente, cada usuario y cada profesional.
 *
 * Una lista de doscientos clientes en la que todas las filas empiezan igual se
 * lee peor de lo que parece: el ojo no tiene dónde agarrarse y hay que leer el
 * nombre entero de cada una. Una figura distinta por persona, siempre la misma
 * para la misma persona, da ese agarre sin pedirle una foto a nadie.
 *
 * DE DÓNDE SALE
 * -------------
 * De `blobatar`, que convierte una cadena en una figura geométrica de forma
 * determinista: el mismo nombre produce siempre el mismo dibujo, en esta caja
 * y en la de al lado, hoy y dentro de un año. No hay archivos que subir, ni
 * carpeta que respaldar, ni imágenes que se pierdan al restaurar.
 *
 * ================================================================
 * POR QUÉ ESTO NO ENGORDA WYBIX
 * ================================================================
 * Cuatro decisiones, y ninguna es opcional:
 *
 * 1. NO se instaló `@blobatar/react`. Pide React 18 como dependencia par, y
 *    esto es Angular: habría metido un segundo framework entero en el paquete
 *    para dibujar un círculo. El núcleo no depende de nada y devuelve SVG.
 *
 * 2. Se importa `blobatar/uri`, no el paquete entero. El barril arrastra
 *    además las utilidades de color y de rasgos; la subruta trae sólo el
 *    generador de la URI.
 *
 * 3. La importación es DINÁMICA. El módulo no entra en el paquete inicial:
 *    se descarga la primera vez que se dibuja un avatar y no antes. Quien
 *    sólo abre el punto de venta no lo carga nunca.
 *
 * 4. El resultado se GUARDA EN MEMORIA por semilla. Volver a pintar la misma
 *    tabla, ordenarla o filtrarla no vuelve a generar nada: la figura de un
 *    cliente se calcula una vez por sesión.
 *
 * Mientras el módulo llega —unos milisegundos— se dibujan las iniciales sobre
 * un fondo derivado de la misma semilla. No es un hueco: es lo que se ve si
 * el módulo no llegara nunca, y funciona igual.
 */

/** Lo ya calculado, por semilla y tamaño. Vive mientras viva la ventana. */
const CACHE = new Map<string, string>();

/** El módulo, cargado una sola vez para toda la aplicación. */
let generador: Promise<(nombre: string, opts?: any) => string> | null = null;

function cargarGenerador() {
  /* `blobatar/uri` y no `blobatar`: el barril trae de paso el color y los
     rasgos, que aquí no se usan. */
  generador ??= import('blobatar/uri')
    .then(m => m.blobatarUri)
    .catch(() => {
      /* Sin módulo se conservan las iniciales. Un avatar es decoración útil,
         no un dato: que no llegue no puede romper una pantalla de clientes. */
      return null as any;
    });
  return generador;
}

@Component({
  selector: 'wx-avatar',
  standalone: true,
  imports: [CommonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
  <span class="wx-av" [style.width.px]="size" [style.height.px]="size"
        [style.border-radius]="cuadrado ? '22%' : '50%'"
        [class.wx-av--limpio]="sinFondo"
        [attr.role]="alt ? 'img' : null" [attr.aria-label]="alt || null"
        [attr.aria-hidden]="alt ? null : 'true'"
        [style.background]="uri() ? 'transparent' : respaldo()">
    <img *ngIf="uri() as u" [src]="u" alt="" [width]="size" [height]="size"
         [style.border-radius]="cuadrado ? '22%' : '50%'" draggable="false">
    <span *ngIf="!uri()" class="wx-av__ini" [style.font-size.px]="size * 0.4">{{ iniciales() }}</span>
  </span>
  `,
  styles: [`
    .wx-av {
      display: inline-flex; align-items: center; justify-content: center;
      flex: none; overflow: hidden; user-select: none;
      box-shadow: inset 0 0 0 1px rgb(0 0 0 / 0.06);
    }
    /* Sin placa tampoco hay aro: el aro solo existia para rematar la placa. */
    .wx-av--limpio { box-shadow: none; overflow: visible; }
    .wx-av img { display: block; }
    .wx-av__ini { color: #fff; font-weight: 650; letter-spacing: -0.02em; line-height: 1; }
  `],
})
export class WxAvatarComponent implements OnChanges {
  /**
   * De qué persona es. Se usa tal cual como semilla, así que tiene que ser
   * ESTABLE: el nombre del cliente sirve, pero si un cliente se renombra
   * cambia de cara. Cuando haya un identificador, mándalo junto al nombre
   * (`'c:' + id`) y la cara sobrevive al cambio de nombre.
   */
  @Input({ required: true }) semilla = '';

  /** Lo que se lee en pantalla. Sólo para las iniciales del respaldo. */
  @Input() nombre = '';

  @Input() size = 32;

  /** Cuadrado con esquinas suaves, para listas densas. */
  @Input() cuadrado = false;

  /**
   * Sin la placa de fondo.
   *
   * Blobatar dibuja por defecto un disco claro detras de la figura, que sobre
   * una superficie clara la separa de la fila. Sobre el dock -navy- ese disco
   * se convierte en un circulo blanco alrededor de la cara, y la figura pasa
   * de ser una persona a ser una pegatina. Aqui se apaga y la forma respira
   * directamente sobre la superficie, que es lo que hace bien.
   */
  @Input() sinFondo = false;

  /**
   * Texto para quien no ve la figura. Vacío = decorativo, y entonces el
   * lector de pantalla lo salta: al lado siempre va el nombre escrito, y
   * oírlo dos veces es ruido.
   */
  @Input() alt = '';

  readonly uri = signal<string | null>(null);

  ngOnChanges(): void {
    const clave = `${this.semilla}|${this.size}|${this.cuadrado ? 'q' : 'c'}|${this.sinFondo ? 'n' : 'f'}`;
    const ya = CACHE.get(clave);
    if (ya) { this.uri.set(ya); return; }

    this.uri.set(null);
    if (!this.semilla) return;

    void cargarGenerador().then(hacer => {
      if (!hacer) return;
      try {
        const u = hacer(this.semilla, {
          size: this.size,
          background: this.sinFondo ? false : (this.cuadrado ? 'squircle' : 'circle'),
        });
        CACHE.set(clave, u);
        /* Si mientras llegaba el módulo la fila pasó a ser de otra persona
           -una tabla que se reordena- no se pinta la cara equivocada. */
        if (`${this.semilla}|${this.size}|${this.cuadrado ? 'q' : 'c'}|${this.sinFondo ? 'n' : 'f'}` === clave) this.uri.set(u);
      } catch { /* se queda con las iniciales */ }
    });
  }

  iniciales(): string {
    const partes = String(this.nombre || this.semilla).trim().split(/\s+/).filter(Boolean);
    if (!partes.length) return '?';
    const a = partes[0][0] ?? '';
    const b = partes.length > 1 ? (partes[partes.length - 1][0] ?? '') : '';
    return (a + b).toUpperCase();
  }

  /**
   * El color del respaldo, derivado de la misma semilla.
   *
   * Un gris para todos delataría el hueco; un color por persona hace que el
   * respaldo se parezca a lo que va a aparecer. Se queda en la banda oscura
   * del tono para que el blanco de las iniciales pase contraste.
   */
  respaldo(): string {
    let h = 0;
    const s = this.semilla || this.nombre;
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 360;
    return `hsl(${h} 42% 38%)`;
  }
}
