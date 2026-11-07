import { AfterViewInit, Directive, ElementRef, EventEmitter, HostListener, Input, OnDestroy, Output, inject } from '@angular/core';

/**
 * NAVEGAR CON FLECHAS DENTRO DE UN BLOQUE.
 *
 *     <div wxFlechas wxFlechasInicio="[data-flechas-inicio]" (wxFlechasEscape)="cerrar()">
 *
 * En la caja se trabaja con teclado y escáner: soltar el teclado para tomar el
 * mouse a cada cobro es lo que vuelve lenta una fila. Este bloque deja que las
 * flechas muevan el foco entre sus botones, campos y renglones, y Enter
 * los activa (los botones ya lo hacen solos; un renglón con `tabindex` lo
 * resuelve con su propio `(keydown.enter)`).
 *
 * LA DIRECCIÓN ES LA DE LA PANTALLA, NO LA DEL DOM.
 * Se elige el elemento más cercano hacia donde apunta la flecha, midiendo su
 * posición real. Así funciona igual en una fila de pastillas, en una columna de
 * botones o en una cuadrícula de productos, sin declarar filas ni columnas.
 *
 * LO QUE NO SE ROBA:
 *   - ← y → dentro de un campo de texto mueven el cursor, como siempre.
 *   - Un componente que ya maneja sus flechas (wx-select abierto, wx-date) y
 *     hace `preventDefault`, se queda con ellas.
 *   - Un textarea es para escribir varias líneas: ahí no se navega.
 */
@Directive({
  selector: '[wxFlechas]',
  standalone: true,
})
export class WxFlechasDirective implements AfterViewInit, OnDestroy {
  private readonly host = inject(ElementRef<HTMLElement>);
  private timer: any;

  /** Selector del elemento que recibe el foco al aparecer el bloque. */
  @Input() wxFlechasInicio: string | null = null;

  /** Esc cierra el bloque. Un wx-select abierto lo atiende antes y no llega. */
  @Output() wxFlechasEscape = new EventEmitter<void>();

  private static readonly ENFOCABLES = [
    'a[href]',
    'button:not([disabled])',
    'input:not([disabled]):not([type=hidden])',
    'textarea:not([disabled])',
    '[tabindex]:not([tabindex="-1"])',
  ].join(',');

  ngAfterViewInit() {
    if (!this.wxFlechasInicio) return;
    /* Un tick después: el modal se pinta con *ngIf y su contenido termina de
       aparecer en la misma vuelta de detección. */
    this.timer = setTimeout(() => {
      const el = this.host.nativeElement.querySelector(this.wxFlechasInicio!) as HTMLElement | null;
      (el ?? this.enfocables()[0])?.focus();
    });
  }

  ngOnDestroy() { clearTimeout(this.timer); }

  @HostListener('keydown', ['$event'])
  alTeclear(ev: KeyboardEvent) {
    if (ev.defaultPrevented || ev.altKey || ev.ctrlKey || ev.metaKey) return;
    /* Dentro del panel abierto de un wx-select o wx-date (popover nativo) las
       teclas son suyas: Esc cierra ESE panel, no el modal entero. */
    if ((ev.target as Element | null)?.closest?.('[popover]')) return;
    if (ev.key === 'Escape' && this.wxFlechasEscape.observed) {
      ev.preventDefault();
      ev.stopPropagation();
      this.wxFlechasEscape.emit();
      return;
    }
    const dir = DIRECCIONES[ev.key];
    if (!dir) return;

    const actual = document.activeElement as HTMLElement | null;
    if (actual && this.esCampoDeTexto(actual)) {
      if (actual.tagName === 'TEXTAREA') return;
      if (dir.x !== 0) return;              // ← → mueven el cursor
    }
    /* Un componente con navegación propia (wx-select abierto, wx-date) hace
       preventDefault antes de que la tecla suba hasta aquí: ya se descartó
       arriba. Si no lo hizo, es que no quería esa flecha.

       Una zona marcada `data-flechas="propias"` (una rejilla, un lienzo) las
       maneja ella: este bloque no se mete. */
    const propia = actual?.closest('[data-flechas="propias"]');
    if (propia && propia !== this.host.nativeElement && this.host.nativeElement.contains(propia)) return;

    /* LA TECLA ES DE ESTE BLOQUE. No sigue subiendo: así un bloque de afuera
       (la pantalla entera) no la usa para sacar el foco de un modal, y el
       atajo de la venta no mueve el carrito mientras se recorren botones. */
    ev.stopPropagation();

    const lista = this.enfocables(this.ambito(actual));
    if (!lista.length) return;

    if (!actual || !this.host.nativeElement.contains(actual) || !lista.includes(actual)) {
      ev.preventDefault();
      lista[0].focus();
      return;
    }

    const siguiente = this.masCercano(actual, lista, dir);
    if (siguiente) {
      ev.preventDefault();
      siguiente.focus();
      siguiente.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
    } else if (actual.tagName === 'INPUT' && (actual as HTMLInputElement).type === 'number') {
      /* Sin vecino en esa dirección, una flecha en un campo numérico NO debe
         sumar o restar centavos a escondidas. */
      ev.preventDefault();
    }
  }

  /**
   * DÓNDE SE PUEDE MOVER EL FOCO.
   *
   * Si hay un diálogo abierto dentro del bloque, solo dentro de él: con la
   * pantalla entera como bloque, una flecha no puede llevar el foco a los
   * botones que quedaron detrás del modal. Sirve también para los diálogos
   * que no traen su propio `wxFlechas`.
   */
  private ambito(actual: HTMLElement | null): HTMLElement {
    const host = this.host.nativeElement as HTMLElement;
    const dentro = actual && host.contains(actual) ? actual.closest(DIALOGOS) as HTMLElement | null : null;
    if (dentro && dentro !== host && host.contains(dentro)) return dentro;
    const abiertos = Array.from(host.querySelectorAll(DIALOGOS) as NodeListOf<HTMLElement>)
      .filter(d => d.getClientRects().length > 0);
    return abiertos.length ? abiertos[abiertos.length - 1] : host;
  }

  /** El primer elemento útil del bloque: el marcado, el activo o el primero. */
  static enfocarZona(zona: HTMLElement | null): boolean {
    if (!zona) return false;
    const marcado = zona.querySelector('[data-flechas-inicio], .is-on, [aria-current="page"]') as HTMLElement | null;
    const lista = WxFlechasDirective.visibles(zona);
    const destino = marcado && lista.includes(marcado) ? marcado : lista[0];
    destino?.focus();
    return !!destino;
  }

  private static visibles(raiz: HTMLElement): HTMLElement[] {
    return Array.from(raiz.querySelectorAll(WxFlechasDirective.ENFOCABLES) as NodeListOf<HTMLElement>)
      .filter(el => !el.hidden && !el.closest('[hidden]') && el.getClientRects().length > 0
        && getComputedStyle(el).visibility !== 'hidden'
        && !el.classList.contains('btn-close'));
  }

  private enfocables(raiz: HTMLElement = this.host.nativeElement): HTMLElement[] {
    return Array.from(raiz.querySelectorAll(WxFlechasDirective.ENFOCABLES) as NodeListOf<HTMLElement>)
      .filter(el => !el.hidden && !el.closest('[hidden]') && el.getClientRects().length > 0
        && getComputedStyle(el).visibility !== 'hidden'
        && !el.classList.contains('btn-close'));
  }

  private esCampoDeTexto(el: HTMLElement): boolean {
    return el.tagName === 'TEXTAREA' || el.isContentEditable ||
      (el.tagName === 'INPUT' && !['checkbox', 'radio', 'button', 'submit'].includes((el as HTMLInputElement).type));
  }

  /**
   * El vecino en la dirección pedida: se premia ir derecho y se castiga
   * desviarse, para que ↓ desde un botón baje al de abajo y no al de la
   * esquina que queda un poco más cerca en diagonal.
   */
  private masCercano(desde: HTMLElement, lista: HTMLElement[], dir: { x: number; y: number }): HTMLElement | null {
    const a = desde.getBoundingClientRect();
    const ax = a.left + a.width / 2, ay = a.top + a.height / 2;
    let mejor: HTMLElement | null = null, puntos = Infinity;
    /* ← → se quedan en la MISMA fila. Al final de una fila de pastillas, →
       saltaba en diagonal al botón Confirmar; ahí lo correcto es no moverse. */
    const enFila = (b: DOMRect) => b.bottom > a.top && b.top < a.bottom;
    for (const el of lista) {
      if (el === desde) continue;
      const b = el.getBoundingClientRect();
      if (dir.x !== 0 && !enFila(b)) continue;
      const bx = b.left + b.width / 2, by = b.top + b.height / 2;
      const dx = bx - ax, dy = by - ay;
      const avance = dx * dir.x + dy * dir.y;
      if (avance <= 1) continue;
      /* Si se traslapan en el otro eje, están «en línea»: desviación cero. */
      const lateral = dir.x !== 0
        ? (b.bottom > a.top && b.top < a.bottom ? 0 : Math.abs(dy))
        : (b.right > a.left && b.left < a.right ? 0 : Math.abs(dx));
      const p = avance + lateral * 3;
      if (p < puntos) { puntos = p; mejor = el; }
    }
    return mejor;
  }
}

/** Lo que cuenta como diálogo abierto: Bootstrap, los de Wybix y los ARIA. */
const DIALOGOS = '.modal.show .modal-content, .wx-dialogo, [aria-modal="true"], .refund-dialog';

const DIRECCIONES: Record<string, { x: number; y: number }> = {
  ArrowUp: { x: 0, y: -1 },
  ArrowDown: { x: 0, y: 1 },
  ArrowLeft: { x: -1, y: 0 },
  ArrowRight: { x: 1, y: 0 },
};
