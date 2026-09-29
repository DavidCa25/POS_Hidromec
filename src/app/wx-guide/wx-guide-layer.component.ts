import {
  ChangeDetectionStrategy, Component, DestroyRef, NgZone, OnInit, computed, effect, inject, signal,
} from '@angular/core';
import { NgClass, NgFor, NgIf } from '@angular/common';
import { NavigationEnd, Router } from '@angular/router';
import { filter } from 'rxjs';
import { AuthService } from '../../services/auth.service';
import { GuiaService } from '../wx-guia/guia.service';
import { GuiaRunnerService } from './guia-runner.service';
import { GuiaProgresoService } from './guia-progreso.service';
import { GuiaVozService } from './guia-voz.service';
import { GuiaFocoService } from './guia-foco.service';
import { WxGuideSpeakerComponent } from './wx-guide-speaker.component';
import { ESCENARIO_INICIAL } from './escenarios';

interface Caja { x: number; y: number; w: number; h: number; }

/**
 * WX-GUIDE-LAYER — el presentador.
 *
 * Todo lo que Wybix dice durante un recorrido, una demo o el primer uso pasa
 * por esta franja: el mismo material oscuro del dock, Wybix asomandose por
 * encima, el texto escribiendose y el avance en segmentos. No es un modal:
 * no tapa la pantalla que se esta enseñando y se aparta si el objetivo queda
 * debajo (sube arriba de la pantalla).
 *
 * Tres presencias de la misma figura (ver `Presencia`):
 *   presentador  asomada por encima de la franja, 84 px
 *   demo         protagonista, 104 px, con los mandos de la demo
 *   compacto     la cabeza del globo, 52 px: saludo y avisos rapidos
 *
 * Y el visor: cuatro esquinas sobre el objetivo, encima del hueco que abre
 * Driver. Es la parte «camara» del presentador.
 */
@Component({
  selector: 'wx-guide-layer',
  standalone: true,
  imports: [NgIf, NgFor, NgClass, WxGuideSpeakerComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './wx-guide-layer.component.html',
  styleUrls: ['./wx-guide-layer.component.css'],
})
export class WxGuideLayerComponent implements OnInit {
  readonly runner = inject(GuiaRunnerService);
  readonly voz = inject(GuiaVozService);
  readonly progreso = inject(GuiaProgresoService);
  readonly guia = inject(GuiaService);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly zone = inject(NgZone);
  private readonly destroy = inject(DestroyRef);
  private readonly foco = inject(GuiaFocoService);

  readonly visor = signal<Caja | null>(null);
  readonly arriba = signal(false);
  readonly base = signal(20);
  /** Lo que ocupa la barra lateral: la franja se centra en lo que queda. */
  readonly izquierda = signal(0);
  readonly angosto = signal(false);
  /** Saludo: «No volver a mostrar automáticamente». */
  noVolver = false;
  /** A quien ya se le ofrecio en esta sesion de la ventana (una vez por persona). */
  private ofrecidoA: number | null = null;
  private marco = 0;
  /* El objetivo puede cambiar de tamaño despues de encuadrado: el selector de
     mesas abre pequeño y crece al llegar las mesas. Sin esto, la franja se
     decidia con el tamaño de antes y acababa encima de «Sin mesa». */
  private tamano: ResizeObserver | null = null;
  private readonly remedir = () => {
    if (!this.marco) this.marco = requestAnimationFrame(() => { this.marco = 0; this.zone.run(() => this.medir()); });
  };

  readonly segmentos = computed(() =>
    Array.from({ length: this.runner.total() }, (_, i) => ({ i, hecho: i < this.runner.indice(), actual: i === this.runner.indice() })));

  readonly tam = computed(() => {
    const p = this.runner.presencia();
    if (p === 'compacto' || this.angosto()) return 52;
    return p === 'demo' ? 104 : 84;
  });

  readonly esInicial = computed(() => this.runner.escenario()?.id === ESCENARIO_INICIAL);

  constructor() {
    /* Cada cambio de objetivo o de fase se vuelve a medir. */
    effect(() => {
      const el = this.runner.objetivo();
      this.runner.fase();
      this.runner.indice();
      queueMicrotask(() => this.medir());
      this.tamano?.disconnect();
      this.tamano = null;
      if (el && typeof ResizeObserver !== 'undefined') {
        /* Y el hueco de Driver con el: si no, el velo tapa lo que crecio. */
        this.tamano = new ResizeObserver(() => { this.foco.reencuadrar(); this.remedir(); });
        this.tamano.observe(el);
      }
    });
    this.destroy.onDestroy(() => this.tamano?.disconnect());
  }

  ngOnInit(): void {
    /*
     * La puerta de fuera: el gestor de demostraciones (o quien presenta) puede
     * arrancar un recorrido sin tocar la pantalla. Pasa por el MISMO motor, asi
     * que una demo automatica sigue exigiendo el permiso del proceso principal
     * en cada paso: esto no abre nada que la interfaz no abriera.
     */
    (window as any).wybixGuide = {
      iniciar: (id: string) => this.zone.run(() => this.runner.iniciar(id)),
      detener: () => this.zone.run(() => this.runner.detener()),
      fase: () => this.runner.fase(),
      /* Solo lectura: en que paso va y que pasos le tocaron a ESTE negocio. */
      paso: () => ({
        escenario: this.runner.escenario()?.id ?? null,
        id: this.runner.paso()?.id ?? null,
        indice: this.runner.indice(),
        pasos: this.runner.pasos().map(p => p.id),
        espera: this.runner.esperando()?.tipo ?? null,
        perdido: this.runner.perdido(),
        pausado: this.runner.pausado(),
      }),
      /* Solo lectura: lo que el motor anoto por dentro (codigos, pasos, tiempos). */
      diagnostico: () => this.runner.diagnostico(),
    };
    this.destroy.onDestroy(() => { delete (window as any).wybixGuide; });

    const volver = this.remedir;
    /* El teclado en pantalla o un modal pueden aparecer sin que cambie el
       objetivo: se vuelve a medir, un fotograma despues, solo con la guia
       visible. Fuera de la zona de Angular: no dispara deteccion de cambios. */
    const obs = this.zone.runOutsideAngular(() => new MutationObserver(() => {
      if (this.runner.fase() !== 'oculta') volver();
    }));
    this.zone.runOutsideAngular(() => obs.observe(document.body, { childList: true, subtree: true }));
    this.destroy.onDestroy(() => obs.disconnect());
    window.addEventListener('scroll', volver, true);
    window.addEventListener('resize', volver);
    this.destroy.onDestroy(() => {
      window.removeEventListener('scroll', volver, true);
      window.removeEventListener('resize', volver);
    });

    /*
     * EL PRIMER USO. Despues del alta y del acceso, en la primera pantalla de
     * trabajo, Wybix se ofrece. Una vez por sesion, sin bloquear nada: la
     * franja se puede ignorar y el trabajo sigue.
     */
    const sub = this.router.events.pipe(filter(e => e instanceof NavigationEnd)).subscribe(() => {
      const uid = this.auth.acceso()?.userId ?? null;
      if (uid == null || this.ofrecidoA === uid || this.runner.fase() !== 'oculta') return;
      const url = this.router.url;
      if (!url.startsWith('/dashboard') || /quickstart|setup/.test(url)) return;
      if (!this.progreso.debeOfrecer(ESCENARIO_INICIAL)) return;
      this.ofrecidoA = uid;
      setTimeout(() => {
        if (this.runner.fase() !== 'oculta') return;
        this.runner.saludar(this.auth.acceso()?.usuario ?? '');
      }, 700);
    });
    this.destroy.onDestroy(() => sub.unsubscribe());
  }

  /**
   * ZONAS SEGURAS. La franja no tiene un sitio fijo: se pone donde MENOS
   * estorba. Candidatas: abajo (sobre el Dock) y arriba. Cada una se puntua por
   * lo que taparia, con peso:
   *
   *   teclado en pantalla   no se tapa nunca (peso muy alto)
   *   el objetivo           su parte baja pesa mas: ahi viven las acciones de
   *                         un dialogo («Sin mesa», «Agendar», «Cobrar»)
   *   un modal abierto      su pie, con los botones
   *   un aviso (SweetAlert) va por encima de la franja, pero no se le tapa
 *   lo que se elige      panel del Dock, lista o menu abiertos: nunca
   *
   * Con histeresis: solo cambia de lado si el otro es claramente mejor, para
   * que no salte de un lado a otro con cada paso.
   */
  private medir() {
    this.angosto.set(window.innerWidth < 640);
    const alto = window.innerHeight;
    const dock = document.querySelector('.wxdock')?.getBoundingClientRect();
    const base = dock && dock.height ? Math.max(20, alto - dock.top + 14) : 20;
    if (base !== this.base()) this.base.set(base);

    const lateral = document.querySelector('.wxside') as HTMLElement | null;
    const rl = lateral && lateral.offsetParent !== null ? lateral.getBoundingClientRect() : null;
    const izq = rl && rl.width > 0 && rl.left < 4 && window.innerWidth > 900 ? Math.round(rl.right) : 0;
    if (izq !== this.izquierda()) this.izquierda.set(izq);

    const el = this.runner.objetivo();
    const r = el && el.isConnected ? el.getBoundingClientRect() : null;
    const v = this.visor();
    const nuevo = r ? { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) } : null;
    /* Solo si cambio: medir no debe provocar otra medicion. */
    if (!v || !nuevo || v.x !== nuevo.x || v.y !== nuevo.y || v.w !== nuevo.w || v.h !== nuevo.h) this.visor.set(nuevo);

    /* La altura real de la franja, con la figura que asoma. */
    const franja = document.querySelector('.wxgl') as HTMLElement | null;
    const h = (franja?.offsetHeight || 130) + 44;
    const zonas = {
      abajo: { top: alto - base - h, bottom: alto - base },
      arriba: { top: 20, bottom: 20 + h },
    };

    type Obst = { top: number; bottom: number; peso: number };
    const obst: Obst[] = [];
    if (r) {
      const corte = r.top + r.height * 0.6;
      obst.push({ top: r.top, bottom: corte, peso: 1 });
      obst.push({ top: corte, bottom: r.bottom, peso: 3 });
    }
    const visible = (x: Element | null) => {
      if (!x) return null;
      const b = x.getBoundingClientRect();
      return b.width > 0 && b.height > 0 ? b : null;
    };
    const teclado = visible(document.querySelector('.wxvk'));
    if (teclado) obst.push({ top: teclado.top, bottom: teclado.bottom, peso: 12 });
    const modal = visible(document.querySelector('.modal.show .modal-content, .cierre-modal .modal-content, [role="dialog"][aria-modal="true"]'));
    if (modal) obst.push({ top: modal.bottom - Math.min(90, modal.height * 0.3), bottom: modal.bottom, peso: 2 });
    const aviso = visible(document.querySelector('.swal2-popup'));
    if (aviso) obst.push({ top: aviso.top, bottom: aviso.bottom, peso: 2 });
    /* Lo que la persona esta ELIGIENDO -el panel del Dock, una lista o un
       menu abiertos- no se tapa nunca: con la guia en pausa, la franja se
       quedaba encima de «Cocina» en el Dock. */
    const eligiendo = [...document.querySelectorAll('.wxdock__panel, [role="listbox"], [role="menu"]')]
      .filter(x => !x.closest('wx-guide-layer')).map(visible).filter((b): b is DOMRect => !!b);
    for (const b of eligiendo) obst.push({ top: b.top, bottom: b.bottom, peso: 12 });

    const tapa = (z: { top: number; bottom: number }) => obst.reduce((t, o) =>
      t + Math.max(0, Math.min(z.bottom, o.bottom) - Math.max(z.top, o.top)) * o.peso, 0);
    const abajo = tapa(zonas.abajo);
    const arriba = tapa(zonas.arriba);
    const ahora = this.arriba();
    /* Histeresis: cambiar solo si el otro lado tapa claramente menos. */
    if (!ahora && arriba < abajo * 0.7) this.arriba.set(true);
    else if (ahora && abajo < arriba * 0.7) this.arriba.set(false);
    else if (!r && !teclado && !modal && !aviso && !eligiendo.length) this.arriba.set(false);
  }

  // ------------------------------------------------------------- saludo
  aceptar() {
    this.progreso.decidirPrimerUso('aceptado');
    this.runner.detener();
    void this.runner.iniciar(ESCENARIO_INICIAL);
  }

  ahoraNo() {
    this.progreso.decidirPrimerUso(this.noVolver ? 'nunca' : 'pospuesto');
    this.runner.detener();
  }

  alternarNoVolver(ev: Event) { this.noVolver = (ev.target as HTMLInputElement).checked; }
  alternarSinAuto(ev: Event) { this.runner.sinAutoAlCerrar = (ev.target as HTMLInputElement).checked; }

  repetir() {
    const e = this.runner.escenario();
    if (e) void this.runner.iniciar(e.id);
  }
}
