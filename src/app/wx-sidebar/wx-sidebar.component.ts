import {
  ChangeDetectionStrategy, Component, EventEmitter, Output, computed, effect, inject, signal, untracked,
} from '@angular/core';
import { NgClass, NgFor, NgIf } from '@angular/common';
import { RouterLink } from '@angular/router';
import { Area, Destino, DestinoMas, NavegacionService } from '../wx-nav/navegacion.service';
import { WxNavModoComponent } from '../wx-nav/wx-nav-modo.component';
import { WxMascotaComponent } from '../wx-mascota/wx-mascota.component';
import { WxGuiaComponent } from '../wx-guia/wx-guia.component';
import { GuiaService } from '../wx-guia/guia.service';
import { PaletaService } from '../wx-paleta/paleta.service';

/**
 * WX-SIDEBAR — la barra lateral de Wybix.
 *
 * Es la columna que tuvo Wybix antes del dock (dashboard.html en el padre de
 * 3af2bc3), recuperada con su aspecto: navy de marca en los dos temas, 250 px
 * y 68 plegada, destinos de 44 px, el activo con barra de acento e icono
 * relleno, y los submenus que se despliegan en su sitio.
 *
 * Lo que NO se recupero es su arquitectura. El rail declaraba su propio menu
 * con veinte `*ngIf` sueltos y cuatro booleanos de «desplegable abierto»;
 * esta barra no declara nada: pinta lo que dice `NavegacionService`, lo mismo
 * que pinta el dock. Un area con un solo destino es un enlace; con varios, un
 * grupo que se despliega. «Mas» se separa en negocio y sistema, que eran los
 * cortes del rail.
 */
@Component({
  selector: 'wx-sidebar',
  standalone: true,
  imports: [NgIf, NgFor, NgClass, RouterLink, WxNavModoComponent, WxMascotaComponent, WxGuiaComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './wx-sidebar.component.html',
  styleUrls: ['./wx-sidebar.component.css'],
})
export class WxSidebarComponent {
  /** Pulsar el tirador: la barra se va y vuelve el dock. */
  @Output() usarDock = new EventEmitter<void>();

  readonly nav = inject(NavegacionService);
  readonly guia = inject(GuiaService);
  private readonly paleta = inject(PaletaService);

  readonly areas = this.nav.areas;
  readonly plegada = this.nav.plegada;

  readonly negocio = computed<DestinoMas[]>(() => this.nav.mas().filter(d => d.grupo === 'negocio'));
  readonly sistema = computed<DestinoMas[]>(() => this.nav.mas().filter(d => d.grupo === 'sistema'));

  /** Los grupos desplegados. El del area activa se abre solo. */
  private readonly abiertos = signal<ReadonlySet<string>>(new Set());

  constructor() {
    /* Al llegar a una pantalla, su grupo queda abierto: se ve donde se esta
       sin tener que desplegar nada. Los que ya estaban abiertos se quedan. */
    effect(() => {
      this.nav.ruta();
      const activa = this.nav.areas().find(a => this.nav.esActiva(a) && this.nav.tienePanel(a));
      if (!activa) return;
      untracked(() => {
        if (!this.abiertos().has(activa.id)) this.abiertos.set(new Set([...this.abiertos(), activa.id]));
      });
    });
  }

  destinosDe(a: Area): Destino[] { return this.nav.destinosDe(a); }
  tienePanel(a: Area): boolean { return this.nav.tienePanel(a); }
  esActiva(a: Area): boolean { return this.nav.esActiva(a); }
  esActivoDestino(d: Destino): boolean { return this.nav.esActivoDestino(d); }
  estaAbierto(a: Area): boolean { return !this.plegada() && this.abiertos().has(a.id); }

  /**
   * Plegada no caben los submenus. Pulsar un grupo entonces despliega la barra
   * y abre el grupo: ningun destino queda detras de un icono que no lleva a
   * ninguna parte.
   */
  alternarGrupo(a: Area) {
    const s = new Set(this.abiertos());
    if (this.plegada()) {
      this.nav.fijarPlegada(false);
      s.add(a.id);
    } else if (s.has(a.id)) {
      s.delete(a.id);
    } else {
      s.add(a.id);
    }
    this.abiertos.set(s);
  }

  alternarPlegada() { this.nav.fijarPlegada(!this.plegada()); }

  buscar() { this.guia.cerrar(); this.paleta.abrir(); }

  /* La misma cara que en el dock y en Inicio: sale del mismo calculo. */
  readonly estadoWybix = computed<'idle' | 'atencion'>(() =>
    this.guia.hayPendientes() ? 'atencion' : 'idle');

  alternarGuia(e: Event) {
    e.stopPropagation();
    if (this.guia.abierta()) this.guia.cerrar(); else this.guia.abrir();
  }

  porId = (_: number, a: Area) => a.id;
  porRuta = (_: number, d: Destino) => d.ruta + d.texto;
}
