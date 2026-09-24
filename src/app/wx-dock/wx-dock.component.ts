import {
  ChangeDetectionStrategy, Component, HostListener, OnDestroy,
  computed, effect, inject, signal, untracked,
} from '@angular/core';
import { NgClass, NgFor, NgIf } from '@angular/common';
import { Router, RouterLink, RouterLinkActive } from '@angular/router';
import { WxMascotaComponent } from '../wx-mascota/wx-mascota.component';
import { PaletaService } from '../wx-paleta/paleta.service';
import { GuiaService } from '../wx-guia/guia.service';
import { WxGuiaComponent } from '../wx-guia/wx-guia.component';
import { Area, Destino, NavegacionService } from '../wx-nav/navegacion.service';

/**
 * WX-DOCK — la barra de trabajo de Wybix.
 *
 * Una de las dos formas oficiales de la navegacion; la otra es la barra
 * lateral (`wx-sidebar`). Cada persona elige la suya, y las dos pintan el
 * mismo registro (`NavegacionService`). Lo de abajo explica el modelo del
 * dock frente a la columna, que es por que la navegacion por defecto es esta.
 *
 * ================================================================
 * EL MODELO: SEIS AREAS, Y CADA UNA SE ABRE
 * ================================================================
 * El rail tenia veintiuna entradas en una columna. Encontrar algo obligaba a
 * LEER la lista entera, porque veintiuna etiquetas apiladas no se escanean: se
 * leen. Y ocupaba 250 px de ancho permanentes en pantallas donde lo que falta
 * siempre es ancho de tabla.
 *
 * Aqui hay seis areas, y cada una es un DOMINIO del negocio -no una pantalla-
 * que al abrirse ensena lo que tiene dentro: su destino principal, sus
 * subsecciones y, cuando aporta, su estado.
 *
 * ABRIR NO DEPENDE DEL RATON
 * --------------------------
 * La primera version abria el panel solo al pasar el cursor. Eso tenia dos
 * problemas, y el segundo es el grave:
 *
 *   1. Al mover el raton hacia una opcion se cruzaba el hueco entre el boton y
 *      el panel, se perdia el hover y el panel se cerraba a medio camino.
 *   2. En una pantalla tactil NO HAY CURSOR, asi que la mitad de la navegacion
 *      sencillamente no existia.
 *
 * Ahora el panel tiene dos formas de abrirse y una sola de comportarse:
 *
 *   PASAR EL CURSOR   lo asoma (solo con raton fino). Se cierra al salir.
 *   PULSAR / TOCAR    lo FIJA. Se queda hasta Escape o un clic fuera.
 *   TECLADO           Enter o espacio sobre el area lo fija igual.
 *
 * El hover es una comodidad; el clic es el contrato. Nada que se pueda hacer
 * con el raton deja de poderse hacer con el dedo.
 *
 * NADA VIVE SOLO EN Ctrl+K
 * ------------------------
 * Ctrl+K es un acelerador, no el unico camino. Los veintiun destinos del rail
 * tienen todos un sitio al que se llega pulsando: unos son el destino
 * principal de un area, otros una subseccion suya, y el resto viven en «Mas».
 *
 * LOS PERMISOS SON LOS MISMOS
 * ---------------------------
 * Cada area y cada destino pregunta por el PAQUETE que exige la operacion a la
 * que lleva, exactamente igual que preguntaba el rail. El dock no puede
 * ofrecer lo que despues se rechaza ni esconder lo que si se permite, porque
 * son las mismas preguntas y no una copia suya.
 */

/**
 * Lo que tarda el panel en cerrarse al salir el cursor.
 *
 * No es una animacion: es la tolerancia del recorrido. Un trayecto en diagonal
 * del boton a una opcion del borde roza el aire de al lado, y sin esta pausa
 * el panel se cierra en ese roce. 220 ms es suficiente para cubrirlo y
 * demasiado poco para que se note como pereza.
 */
const GRACIA = 220;

@Component({
  selector: 'wx-dock',
  standalone: true,
  imports: [NgIf, NgFor, NgClass, RouterLink, RouterLinkActive, WxMascotaComponent, WxGuiaComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './wx-dock.component.html',
  styleUrls: ['./wx-dock.component.css'],
})
export class WxDockComponent implements OnDestroy {
  /** El area cuyo panel esta a la vista, y si se quedo fijado con un clic. */
  readonly panel = signal<string | null>(null);
  readonly fijado = signal(false);

  readonly crearAbierto = signal(false);
  readonly masAbierto = signal(false);

  /** «Mas acciones» dentro del boton de crear. */
  readonly crearTodo = signal(false);

  private cierre: any = null;

  private readonly router = inject(Router);
  private readonly nav = inject(NavegacionService);
  private readonly paleta = inject(PaletaService);
  readonly guia = inject(GuiaService);

  constructor() {
    /* Navegar cierra lo que estuviera abierto: el panel ya cumplio. */
    effect(() => { this.nav.ruta(); untracked(() => this.cerrarTodo()); });
  }

  ngOnDestroy(): void { clearTimeout(this.cierre); }

  /*
   * EL DOCK NO DECLARA SU MENU.
   *
   * Las areas, sus destinos, «Mas» y «Crear» salen de `NavegacionService`,
   * que es tambien de donde los lee la barra lateral. Aqui queda solo lo que
   * es del dock: como se abren sus paneles.
   */
  readonly areas = this.nav.areas;
  readonly mas = this.nav.mas;
  destinosDe(a: Area): Destino[] { return this.nav.destinosDe(a); }
  tienePanel(a: Area): boolean { return this.nav.tienePanel(a); }

  /**
   * Primero lo que este negocio hace muchas veces al dia; el resto detras de
   * «Mas acciones». Una lista de ocho obliga a leerla entera cada vez.
   */
  readonly crearFrecuentes = computed<Destino[]>(() => this.nav.crear().slice(0, 4));
  readonly crearResto = computed<Destino[]>(() => this.nav.crear().slice(4));

  // ------------------------------------------------------------ busqueda
  esActiva(a: Area): boolean { return this.nav.esActiva(a); }
  esActivoDestino(d: Destino): boolean { return this.nav.esActivoDestino(d); }

  /*
   * TRACKBY, Y NO ES OPCIONAL.
   *
   * Estas listas se recalculan cuando cambian los permisos, los modulos o los
   * datos. Sin `trackBy`, cada recalculo devuelve objetos nuevos y `ngFor`
   * destruye y reconstruye TODO el dock, incluidos sus `routerLinkActive`, que
   * a su vez vuelven a marcar el componente para revision. Eso no es lento: es
   * un bucle que deja el hilo del renderer colgado y la ventana en blanco.
   * Paso exactamente eso la primera vez que se probo.
   */
  porId = (_: number, a: Area) => a.id;
  porRuta = (_: number, d: Destino) => d.ruta + d.texto;

  // ------------------------------------------------------------- aperturas
  /** El cursor asoma el panel; no lo fija. */
  asomar(a: Area) {
    if (!this.tienePanel(a)) return;
    clearTimeout(this.cierre);
    if (this.fijado()) return;         // uno fijado manda sobre el cursor
    this.cerrarPopovers();
    this.panel.set(a.id);
  }

  /** Al salir el cursor se cierra, pero con gracia (ver GRACIA). */
  retirar() {
    if (this.fijado()) return;
    clearTimeout(this.cierre);
    this.cierre = setTimeout(() => this.panel.set(null), GRACIA);
  }

  /** Quedarse dentro del panel cancela el cierre en curso. */
  sostener() { clearTimeout(this.cierre); }

  /**
   * Pulsar o tocar un area CON panel: lo fija. Volver a pulsar lo cierra.
   * Las areas sin panel son enlaces y no pasan por aqui.
   */
  pulsar(a: Area, _e: Event) {
    clearTimeout(this.cierre);
    const yaEstaba = this.panel() === a.id && this.fijado();
    this.cerrarTodo();
    if (!yaEstaba) { this.panel.set(a.id); this.fijado.set(true); }
  }

  alternarCrear() {
    const v = !this.crearAbierto();
    this.cerrarTodo();
    this.crearAbierto.set(v);
    this.crearTodo.set(false);
  }

  verMasAcciones() { this.crearTodo.set(true); }

  alternarMas() {
    const v = !this.masAbierto();
    this.cerrarTodo();
    this.masAbierto.set(v);
  }

  private cerrarPopovers() {
    this.crearAbierto.set(false);
    this.masAbierto.set(false);
  }

  cerrarTodo() {
    clearTimeout(this.cierre);
    this.guia.cerrar();
    this.cerrarPopovers();
    this.panel.set(null);
    this.fijado.set(false);
    this.crearTodo.set(false);
  }

  ir(ruta: string) {
    this.cerrarTodo();
    void this.router.navigateByUrl(ruta);
  }

  /** El boton de la lupa y Ctrl+K abren lo mismo, desde sitios distintos. */
  abrirBuscador() { this.cerrarTodo(); this.paleta.abrir(); }

  // -------------------------------------------------------------- teclado
  /* Ctrl+1..6 y Ctrl+K no viven aqui: son de la carcasa de navegacion y
     funcionan igual con barra lateral, sin el dock montado. Escape si: cierra
     lo que este dock tenga abierto. */
  @HostListener('document:keydown.escape')
  alEscapar() { this.cerrarTodo(); }

  @HostListener('document:click', ['$event'])
  alPulsarFuera(e: Event) {
    const dentro = (e.target as HTMLElement)?.closest?.('.wxdock, .wxdock-pop, .wxdock-panel');
    if (!dentro) this.cerrarTodo();
  }

  /**
   * EL ESTADO DE WYBIX MINI.
   *
   * Sale de la GUIA, no de los datos del dock. Antes lo calculaba el dock por
   * su cuenta y habia dos opiniones sobre el mismo negocio: la cara del dock
   * podia decir "todo en orden" mientras Inicio decia "3 cosas pendientes".
   * Una sola fuente, y la cara del dock, la de Inicio y la del panel dicen
   * siempre lo mismo porque son el mismo calculo.
   */
  readonly estadoWybix = computed<'idle' | 'atencion'>(() =>
    this.guia.hayPendientes() ? 'atencion' : 'idle');

  /** Pulsar la figura abre el resumen. No navega a ninguna parte. */
  alternarGuia(e: Event) {
    e.stopPropagation();
    const abierta = this.guia.abierta();
    this.cerrarTodo();
    if (!abierta) this.guia.abrir();
  }
}
