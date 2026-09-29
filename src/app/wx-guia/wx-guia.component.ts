import {
  AfterViewInit, ChangeDetectionStrategy, Component, ElementRef, HostListener, OnDestroy, ViewChild, computed, effect, inject, signal,
} from '@angular/core';
import { NgClass, NgFor, NgIf } from '@angular/common';
import { Router } from '@angular/router';
import { WxMascotaComponent } from '../wx-mascota/wx-mascota.component';
import { GuiaService, AvisoGuia } from './guia.service';
import { GuiaPuertaService } from '../wx-guide/guia-puerta.service';
import { GuiaProgresoService } from '../wx-guide/guia-progreso.service';
import { Escenario } from '../wx-guide/guia-tipos';

const GRUPOS: { id: Escenario['grupo']; titulo: string }[] = [
  { id: 'inicio', titulo: 'Para empezar' },
  { id: 'esencial', titulo: 'Tu día a día' },
  { id: 'giro', titulo: 'De tu negocio' },
  { id: 'demo', titulo: 'Demostración automática' },
];

/**
 * WX-GUIA — el tablero de Wybix Guide.
 *
 * Es la ENTRADA: se abre desde Wybix Mini (dock o barra), dice que se puede
 * aprender aqui, cuanto se lleva visto y como va el negocio. Los recorridos NO
 * pasan aqui: al elegir uno, el tablero se cierra y el recorrido se vive en el
 * presentador (`wx-guide-layer`), con el foco sobre la pantalla real.
 *
 * Es un panel central y no un globo junto al boton porque es un momento de
 * decidir -que aprender-, no de consultar de reojo. Aun asi es ligero: se
 * cierra con Escape, con un toque fuera o eligiendo algo.
 *
 * LA LISTA LA DECIDE EL NEGOCIO. Solo aparecen los recorridos que tienen
 * sentido aqui: la misma regla de areas, capacidades y permisos que usa la
 * navegacion. Una cafeteria ve «Mesas y cocina»; una tienda no. Las
 * demostraciones automaticas solo aparecen donde el proceso principal confirma
 * una demo segura.
 *
 * UN DETALLE DE MONTAJE: vive dentro del dock o de la barra -que son los que
 * deciden cuando existe-, pero su contenido se pinta en el <body>. El dock
 * esta centrado con `transform`, y un elemento `fixed` dentro de algo
 * transformado se coloca respecto a ESO, no a la ventana.
 */
@Component({
  selector: 'wx-guia',
  standalone: true,
  imports: [NgIf, NgFor, NgClass, WxMascotaComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './wx-guia.component.html',
  styleUrls: ['./wx-guia.component.css'],
})
export class WxGuiaComponent implements AfterViewInit, OnDestroy {
  readonly guia = inject(GuiaService);
  private readonly router = inject(Router);
  private readonly puerta = inject(GuiaPuertaService);
  readonly progreso = inject(GuiaProgresoService);

  @ViewChild('portal', { static: true }) portal!: ElementRef<HTMLElement>;

  /** Lo que esta persona puede recorrer aqui. Se calcula al abrir. */
  readonly escenarios = signal<Escenario[]>([]);

  constructor() {
    /* Al abrir se carga el motor y se pregunta si esta ventana es una demo:
       la lista de demostraciones depende de la respuesta del proceso principal. */
    effect(() => {
      if (!this.guia.abierta()) return;
      void this.puerta.runner().then(async (r) => {
        await r.preparar();
        this.escenarios.set(r.disponibles(null));
        const demo = await r.contextoDemo();
        this.escenarios.set(r.disponibles(demo));
      });
    });
  }

  readonly grupos = computed(() => GRUPOS
    .map(g => ({ ...g, escenarios: this.escenarios().filter(e => e.grupo === g.id) }))
    .filter(g => g.escenarios.length));

  /** El avance cuenta lo que se ENSEÑA; las demostraciones no son deberes. */
  readonly avance = computed(() => {
    const aprendibles = this.escenarios().filter(e => e.modo === 'guia');
    const hechos = aprendibles.filter(e => this.progreso.hecho(e.id)).length;
    const total = aprendibles.length;
    return { hechos, total, grados: total ? Math.round((hechos / total) * 360) : 0 };
  });

  ngAfterViewInit(): void { document.body.appendChild(this.portal.nativeElement); }
  ngOnDestroy(): void { this.portal.nativeElement.remove(); }

  empezar(e: Escenario) {
    this.guia.cerrar();
    void this.puerta.runner().then(r => r.iniciar(e.id));
  }

  alternarInicio(ev: Event) {
    this.progreso.fijarMostrarAlIniciar((ev.target as HTMLInputElement).checked);
  }

  reiniciar() { this.progreso.reiniciar(); }

  ir(ruta?: string) {
    if (!ruta) return;
    this.guia.cerrar();
    void this.router.navigateByUrl(ruta);
  }

  porAviso = (_: number, a: AvisoGuia) => a.area + a.texto;
  porId = (_: number, x: { id: string }) => x.id;

  @HostListener('document:keydown.escape')
  alEscapar() { if (this.guia.abierta()) this.guia.cerrar(); }

  @HostListener('document:click', ['$event'])
  alPulsarFuera(e: Event) {
    if (!this.guia.abierta()) return;
    /* El propio botón de Wybix -en el dock o en la barra lateral- no cuenta
       como "fuera": si contara, pulsarlo cerraría y volvería a abrir en el
       mismo gesto. */
    const dentro = (e.target as HTMLElement)?.closest?.('.wxg, .wxdock__pulso, .wxside__pulso');
    if (!dentro) this.guia.cerrar();
  }
}
