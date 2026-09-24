import {
  ChangeDetectionStrategy, Component, ElementRef, HostListener, Injector, OnInit,
  afterNextRender, inject,
} from '@angular/core';
import { NgIf } from '@angular/common';
import { Router } from '@angular/router';
import { ModoNavegacion, NavegacionService } from './navegacion.service';
import { WxNavModoComponent } from './wx-nav-modo.component';
import { WxDockComponent } from '../wx-dock/wx-dock.component';
import { WxSidebarComponent } from '../wx-sidebar/wx-sidebar.component';
import { GuiaService } from '../wx-guia/guia.service';
import { PaletaService } from '../wx-paleta/paleta.service';

/**
 * WX-NAVEGACION — la carcasa de la navegacion.
 *
 * Una navegacion, dos representaciones oficiales: el dock y la barra lateral.
 * Lo que es de LA NAVEGACION y no de una de sus formas vive aqui:
 *
 *   - cual de las dos se pinta, segun la eleccion de quien entro;
 *   - el paso de una a otra, con su transicion;
 *   - Ctrl+1..6, que tiene que funcionar con cualquiera de las dos montada.
 *
 * Lo demas -areas, destinos, permisos, cifras, lo activo- es del registro
 * (`NavegacionService`), que las dos leen igual. La cabecera, el contenido y
 * el router no cambian: esto no es un segundo layout, es la parte del mismo
 * layout que cambia de forma.
 */

/*
 * TIEMPOS. Salir es mas rapido que entrar: al salir la decision ya esta
 * tomada. La suma queda por debajo de 350 ms, y cada tramo dentro de
 * 140-220, que es lo que se siente como continuidad y no como espera.
 */
const SALIDA = 140;
const ENTRADA = 210;
const CURVA = 'cubic-bezier(0.23, 1, 0.32, 1)';

@Component({
  selector: 'wx-navegacion',
  standalone: true,
  imports: [NgIf, WxDockComponent, WxSidebarComponent, WxNavModoComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <wx-sidebar *ngIf="nav.modo() === 'sidebar'" (usarDock)="cambiar('dock')"></wx-sidebar>
    <ng-container *ngIf="nav.modo() === 'dock'">
      <wx-dock></wx-dock>
      <wx-nav-modo desde="dock" (cambiar)="cambiar('sidebar')"></wx-nav-modo>
    </ng-container>
  `,
  styles: [':host { display: contents; }'],
})
export class WxNavegacionComponent implements OnInit {
  readonly nav = inject(NavegacionService);
  private readonly router = inject(Router);
  private readonly guia = inject(GuiaService);
  private readonly paleta = inject(PaletaService);
  private readonly injector = inject(Injector);
  private readonly host = inject(ElementRef<HTMLElement>);

  private cambiando = false;

  ngOnInit(): void {
    /* Una sola carga para las dos formas: las cifras son de la navegacion, y
       la guia se comparte con Inicio. */
    void this.nav.cargarDatos();
    void this.guia.cargar();
  }

  /**
   * DE UNA FORMA A LA OTRA, SIN QUE NADA BRINQUE.
   *
   *   Dock -> barra   el dock baja y se apaga; la barra entra desde el borde
   *                   izquierdo mientras el contenido se desplaza a su nuevo
   *                   sitio.
   *   Barra -> dock   la barra se repliega a la izquierda; el contenido
   *                   recupera el ancho deslizandose; el dock sube.
   *
   * El contenido no se anima con `width` sino con FLIP: se mide donde estaba
   * y donde queda, y se desplaza con `translate` de lo uno a lo otro. Todo es
   * `translate` y `opacity`, con la API de animaciones del navegador. Se anima
   * `translate` y no `transform` porque el dock ya usa `transform` para
   * centrarse, y pisarlo lo descolocaria.
   *
   * No se navega ni se recarga nada: la ruta, el estado de la pantalla y lo
   * que estuviera escrito siguen donde estaban.
   */
  async cambiar(destino: ModoNavegacion): Promise<void> {
    if (this.cambiando || this.nav.modo() === destino) return;
    this.cambiando = true;
    try {
      /* Nada flotando huerfano: el panel de la guia y Ctrl+K se cierran. Los
         paneles del dock y sus menus se van con el propio dock. */
      this.guia.cerrar();
      this.paleta.cerrar();

      const quieto = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
      const contenido = document.querySelector<HTMLElement>('.dashboard-content');
      const antes = contenido?.getBoundingClientRect().left ?? 0;

      if (!quieto) await this.salir(this.nav.modo());

      this.nav.fijarModo(destino);
      await this.renderizado();

      if (quieto) return;
      const despues = contenido?.getBoundingClientRect().left ?? 0;
      await this.entrar(destino, contenido, antes - despues);
    } finally {
      this.cambiando = false;
    }
  }

  private async salir(modo: ModoNavegacion): Promise<void> {
    const opts: KeyframeAnimationOptions = { duration: SALIDA, easing: CURVA, fill: 'forwards' };
    const animaciones: Animation[] = [];
    if (modo === 'dock') {
      const dock = this.buscar('.wxdock');
      const tirador = this.buscar('.wxmodo.es-dock');
      if (dock) animaciones.push(dock.animate(
        [{ translate: '0 0', opacity: 1 }, { translate: '0 16px', opacity: 0 }], opts));
      if (tirador) animaciones.push(tirador.animate([{ opacity: 1 }, { opacity: 0 }], opts));
    } else {
      const barra = this.buscar('.wxside');
      if (barra) animaciones.push(barra.animate(
        [{ translate: '0 0' }, { translate: '-100% 0' }], opts));
    }
    await Promise.all(animaciones.map(a => a.finished.catch(() => undefined)));
  }

  private async entrar(modo: ModoNavegacion, contenido: HTMLElement | null, dx: number): Promise<void> {
    const opts: KeyframeAnimationOptions = { duration: ENTRADA, easing: CURVA };
    const animaciones: Animation[] = [];

    if (contenido && Math.abs(dx) > 0.5) {
      animaciones.push(contenido.animate(
        [{ translate: `${dx}px 0` }, { translate: '0 0' }], opts));
    }

    if (modo === 'sidebar') {
      const barra = this.buscar('.wxside');
      if (barra) animaciones.push(barra.animate(
        [{ translate: '-100% 0' }, { translate: '0 0' }], opts));
    } else {
      const dock = this.buscar('.wxdock');
      const tirador = this.buscar('.wxmodo.es-dock');
      if (dock) animaciones.push(dock.animate(
        [{ translate: '0 18px', opacity: 0 }, { translate: '0 0', opacity: 1 }], opts));
      if (tirador) animaciones.push(tirador.animate(
        [{ opacity: 0 }, { opacity: 1 }], { ...opts, delay: 80 }));
    }
    await Promise.all(animaciones.map(a => a.finished.catch(() => undefined)));
  }

  private buscar(sel: string): HTMLElement | null {
    return (this.host.nativeElement.parentElement ?? document).querySelector(sel);
  }

  /** Espera a que Angular haya pintado el modo nuevo. */
  private renderizado(): Promise<void> {
    return new Promise(res => afterNextRender(() => res(), { injector: this.injector }));
  }

  // -------------------------------------------------------------- atajos
  /*
   * Ctrl+1..6 saltan DIRECTO al destino principal de cada area. Viven aqui y
   * no en el dock porque son de la navegacion: con la barra lateral el dock
   * no esta montado y los atajos tienen que seguir funcionando. Ctrl+K es de
   * la paleta, que tampoco depende de ninguna de las dos formas.
   */
  @HostListener('document:keydown', ['$event'])
  alTeclear(e: KeyboardEvent) {
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && /^[1-6]$/.test(e.key)) {
      const areas = this.nav.areas();
      const i = Number(e.key) - 1;
      if (i < areas.length) {
        e.preventDefault();
        this.guia.cerrar();
        void this.router.navigateByUrl(areas[i].ruta);
      }
    }
  }
}
