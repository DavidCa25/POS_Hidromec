import {
  AfterViewChecked, ChangeDetectionStrategy, Component, ElementRef, OnInit, inject, signal,
} from '@angular/core';
import { NgClass, NgFor, NgIf } from '@angular/common';
import { TecladoVirtualService } from './teclado-virtual.service';

const LETRAS = [
  ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'],
  ['q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'o', 'p'],
  ['a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l', 'ñ'],
  ['z', 'x', 'c', 'v', 'b', 'n', 'm', ',', '.', '-'],
];
const SIMBOLOS = [
  ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'],
  ['@', '#', '$', '%', '&', '*', '(', ')', '/', ':'],
  ['á', 'é', 'í', 'ó', 'ú', 'ü', '¿', '?', '¡', '!'],
  ['_', '+', '=', '"', "'", ';', ',', '.', '-', '·'],
];

/**
 * WX-VIRTUAL-KEYBOARD — el teclado en pantalla de Wybix.
 *
 * Uno solo, montado una vez en la raiz. Lo que escribe y cuando aparece lo
 * decide `TecladoVirtualService`; aqui solo se pintan las teclas.
 *
 * Las teclas actuan en `pointerdown` y lo cancelan: asi el campo NUNCA pierde
 * el foco, el cursor se queda donde estaba y el teclado fisico -si lo hay-
 * sigue escribiendo en el mismo sitio. Por eso tampoco entran en el orden de
 * tabulacion: Tab sigue yendo de campo en campo.
 *
 * Texto ocupa el ancho de abajo; numeros, dinero y cantidades son un teclado
 * compacto en la esquina, que tapa lo minimo.
 */
@Component({
  selector: 'wx-virtual-keyboard',
  standalone: true,
  imports: [NgIf, NgFor, NgClass],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
  <div class="wxvk" *ngIf="t.visible()" [ngClass]="'wxvk--' + t.layout().toLowerCase()"
       role="group" aria-label="Teclado en pantalla">

    <!-- ---------------------------------------------------------- TEXTO -->
    <ng-container *ngIf="t.layout() === 'TEXT'">
      <div class="wxvk__fila" *ngFor="let fila of (simbolos() ? simbolosFilas : letras)">
        <button type="button" tabindex="-1" class="wxvk__k" *ngFor="let k of fila"
                (pointerdown)="tecla($event, k)">{{ mostrar(k) }}</button>
      </div>
      <div class="wxvk__fila">
        <button type="button" tabindex="-1" class="wxvk__k wxvk__k--mod" [class.on]="mayus()"
                (pointerdown)="accion($event, 'mayus')" aria-label="Mayúsculas">
          <i class="ph ph-arrow-fat-up" aria-hidden="true"></i>
        </button>
        <button type="button" tabindex="-1" class="wxvk__k wxvk__k--mod" [class.on]="simbolos()"
                (pointerdown)="accion($event, 'simbolos')">{{ simbolos() ? 'abc' : '#+=' }}</button>
        <button type="button" tabindex="-1" class="wxvk__k wxvk__k--espacio" (pointerdown)="tecla($event, ' ')">espacio</button>
        <button type="button" tabindex="-1" class="wxvk__k wxvk__k--mod" (pointerdown)="accion($event, 'borrar')" aria-label="Borrar">
          <i class="ph ph-backspace" aria-hidden="true"></i>
        </button>
        <button type="button" tabindex="-1" class="wxvk__k wxvk__k--mod" (pointerdown)="accion($event, 'siguiente')">Siguiente</button>
        <button type="button" tabindex="-1" class="wxvk__k wxvk__k--listo" (pointerdown)="accion($event, 'enter')">Listo</button>
        <button type="button" tabindex="-1" class="wxvk__k wxvk__k--mod" (pointerdown)="accion($event, 'cerrar')" aria-label="Ocultar teclado">
          <i class="ph ph-caret-down" aria-hidden="true"></i>
        </button>
      </div>
    </ng-container>

    <!-- -------------------------------------------- NUMEROS, DINERO, CANTIDAD -->
    <ng-container *ngIf="t.layout() !== 'TEXT'">
      <div class="wxvk__pad">
        <button type="button" tabindex="-1" class="wxvk__k" *ngFor="let k of ['7','8','9','4','5','6','1','2','3']"
                (pointerdown)="tecla($event, k)">{{ k }}</button>
        <button type="button" tabindex="-1" class="wxvk__k" *ngIf="t.layout() === 'MONEY'" (pointerdown)="tecla($event, '00')">00</button>
        <button type="button" tabindex="-1" class="wxvk__k"
                *ngIf="t.layout() === 'NUMERIC' || (t.layout() === 'QUANTITY' && t.decimales())"
                (pointerdown)="tecla($event, '.')">.</button>
        <button type="button" tabindex="-1" class="wxvk__k wxvk__k--mod"
                *ngIf="t.layout() === 'QUANTITY' && !t.decimales()"
                (pointerdown)="accion($event, 'menos')" aria-label="Uno menos">−</button>
        <button type="button" tabindex="-1" class="wxvk__k" (pointerdown)="tecla($event, '0')">0</button>
        <button type="button" tabindex="-1" class="wxvk__k wxvk__k--mod" (pointerdown)="accion($event, 'borrar')" aria-label="Borrar">
          <i class="ph ph-backspace" aria-hidden="true"></i>
        </button>
        <button type="button" tabindex="-1" class="wxvk__k wxvk__k--mod" *ngIf="t.layout() === 'QUANTITY'"
                (pointerdown)="accion($event, 'mas')" aria-label="Uno más">+</button>
        <button type="button" tabindex="-1" class="wxvk__k wxvk__k--mod" *ngIf="t.layout() !== 'QUANTITY'"
                (pointerdown)="accion($event, 'limpiar')">Borrar todo</button>
        <button type="button" tabindex="-1" class="wxvk__k wxvk__k--mod" (pointerdown)="accion($event, 'cerrar')" aria-label="Ocultar teclado">
          <i class="ph ph-caret-down" aria-hidden="true"></i>
        </button>
        <button type="button" tabindex="-1" class="wxvk__k wxvk__k--listo wxvk__k--ancho" (pointerdown)="accion($event, 'enter')">Listo</button>
      </div>
    </ng-container>
  </div>
  `,
  styleUrls: ['./wx-virtual-keyboard.component.css'],
})
export class WxVirtualKeyboardComponent implements OnInit, AfterViewChecked {
  readonly t = inject(TecladoVirtualService);
  private readonly el = inject(ElementRef<HTMLElement>);

  readonly letras = LETRAS;
  readonly simbolosFilas = SIMBOLOS;
  readonly mayus = signal(false);
  readonly simbolos = signal(false);
  private altoVisto = 0;

  ngOnInit(): void { this.t.iniciar(); }

  /* Cuando cambia el alto (texto <-> numeros) el campo se vuelve a acomodar. */
  ngAfterViewChecked(): void {
    const panel = this.el.nativeElement.querySelector('.wxvk') as HTMLElement | null;
    const alto = panel?.offsetHeight ?? 0;
    if (alto && alto !== this.altoVisto) { this.altoVisto = alto; this.t.aLaVista(alto); }
    if (!panel) this.altoVisto = 0;
  }

  mostrar(k: string): string { return this.mayus() ? k.toUpperCase() : k; }

  tecla(e: Event, k: string) {
    e.preventDefault();
    this.t.escribir(this.mayus() ? k.toUpperCase() : k);
    if (this.mayus()) this.mayus.set(false);
  }

  accion(e: Event, a: 'mayus' | 'simbolos' | 'borrar' | 'limpiar' | 'enter' | 'siguiente' | 'cerrar' | 'mas' | 'menos') {
    e.preventDefault();
    switch (a) {
      case 'mayus': this.mayus.update(v => !v); break;
      case 'simbolos': this.simbolos.update(v => !v); break;
      case 'borrar': this.t.borrar(); break;
      case 'limpiar': this.t.limpiar(); break;
      case 'enter': this.t.enter(); break;
      case 'siguiente': this.t.siguiente(); break;
      case 'cerrar': this.t.cerrar(); break;
      case 'mas': this.t.paso(1); break;
      case 'menos': this.t.paso(-1); break;
    }
  }
}
