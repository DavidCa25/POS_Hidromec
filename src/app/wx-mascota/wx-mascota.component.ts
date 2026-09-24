import {
  AfterViewInit, ChangeDetectionStrategy, Component, ElementRef, Input, OnChanges, ViewChild,
} from '@angular/core';
import { VarianteMascota, VARIANTE_BASE } from './variantes';

/**
 * WX-MASCOTA — Wybix, el personaje. DIBUJADO Y ANIMADO CON BLOBATAR.
 *
 * No es un adorno ni un icono de estado con cara: es EL indicador de estado.
 * Donde otra interfaz pondria un punto de color y una etiqueta, aqui hay una
 * figura que reacciona. Por eso solo aparece donde hay un estado del que
 * hablar, y nunca "de fondo".
 *
 * CUATRO ESTADOS, NI UNO MAS
 * --------------------------
 *   idle      El negocio va. Respira y calla. Es el 95% del tiempo.
 *   atencion  Hay algo parado. Ojos abiertos, junto a LO QUE esta parado.
 *   exito     Acaba de salir bien. Dura menos de un segundo y se va.
 *   error     Algo no se pudo hacer. Acompana al mensaje, no lo sustituye.
 *
 * Cuatro, y no las catorce poses que trae la libreria, porque un estado que el
 * usuario no sabe distinguir de un vistazo no es informacion: es ruido con
 * cara. Y `error` NUNCA reemplaza al texto del fallo: un personaje triste no
 * dice que salio mal ni como arreglarlo.
 *
 * ================================================================
 * POR QUE ESTE COMPONENTE ES UN ADAPTADOR Y NO UNA LLAMADA
 * ================================================================
 * `blobatar()` devuelve markup ESTATICO. Esta documentado en la propia
 * libreria: la capa de movimiento -respiracion, balanceo, parpadeo, sacadas
 * de la mirada y el morfeo entre poses- es CSS, y quien la monta son los
 * adaptadores de React y de Vue. Para Angular no hay adaptador.
 *
 * La primera version de esto llamaba a `blobatar()` con `animate: 'always'` y
 * daba una figura correcta y COMPLETAMENTE QUIETA, sin un solo error por
 * ninguna parte. Por eso hay adaptador aqui: `blobatar/internal` publica
 * exactamente las piezas que usan los otros dos.
 *
 *   `inner`  el interior del SVG, con sus grupos `.mo-*`
 *   `cls`    la clase del raiz: `mo-root mo-always`, y `mo-expr` si hay pose
 *   `vars`   las custom properties: las fases de cada ciclo -para que dos
 *            figuras no vayan sincronizadas- y los canales de la pose
 *
 * LO QUE HACE QUE LA POSE SE MORFEE, Y NO SALTE
 * --------------------------------------------
 * `inner` es IDENTICO para las tres poses: lo que cambia entre reposo y
 * sorpresa son solo numeros en `vars`. Asi que el interior se escribe UNA VEZ
 * y despues solo se reescriben `class` y `style` sobre el MISMO nodo. Eso es
 * lo que deja que la transicion de CSS interpole de una cara a la otra.
 *
 * Volver a escribir el interior en cada cambio daria un nodo nuevo, y un nodo
 * nuevo no transiciona desde nada: la cara cambiaria de golpe.
 *
 * ================================================================
 * POR QUE NO ENGORDA
 * ================================================================
 * 1. Las importaciones son DINAMICAS: ni el nucleo ni las poses entran en el
 *    paquete inicial. Quien solo abre el punto de venta no las carga.
 * 2. Por subruta, no el barril entero.
 * 3. Las poses se cogen una a una; la libreria las publica sueltas a proposito
 *    para que quien use cuatro no pague por catorce.
 * 4. El interior se calcula una vez por tamano y se guarda en memoria.
 * 5. `blobatar/motion.css` es lo unico que viaja siempre: 8 KB.
 *
 * ================================================================
 * EL REPARTO CON RIVE
 * ================================================================
 * BLOBATAR = PERSONA Y PRESENCIA. Esta figura y las de la gente. Respirar,
 * parpadear, mirar y cambiar de expresion son suyos, y los hace ya.
 *
 * RIVE = SISTEMA Y EVENTO. Una animacion de proceso -un respaldo que avanza y
 * termina, una sincronizacion, una conexion de MultiCaja- que una pose no
 * puede contar. No hay asset todavia; el contrato esta escrito en
 * `docs/rive-wybix.md` y el runtime NO se descarga mientras no exista.
 */

export type EstadoMascota = 'idle' | 'atencion' | 'exito' | 'error';

/**
 * QUIEN ES WYBIX.
 *
 * La semilla decide la figura, asi que es fija y no se toca: cambiarla es
 * cambiar de personaje. Lleva prefijo propio para no chocar nunca con la de
 * una persona (`u:` para usuarios, `c:` para clientes).
 */

/**
 * El color de la marca, no el de la semilla.
 *
 * Una persona recibe su color de su nombre, que es lo que hace reconocible una
 * lista de doscientos clientes. Wybix no: es marca, y su cian es el mismo cian
 * de la aplicacion. `hue 200 / tone 0.4` da #00BFC6, que es el vecino mas
 * cercano al #45B3C3 de los tokens dentro de la escala de la libreria.
 */

/**
 * De estado a pose.
 *
 * `surprised` y no `mad` ni `scared` para la atencion: lo que tiene que decir
 * es "mira esto", no "algo horrible esta pasando". Un personaje que se asusta
 * cada vez que faltan tres filtros cansa en una semana.
 */
const POSE: Record<EstadoMascota, 'idle' | 'surprised' | 'happy' | 'sad'> = {
  idle: 'idle',
  atencion: 'surprised',
  exito: 'happy',
  /* `sad` y no `scared` ni `mad`: lo que hay que comunicar es "no salio", no
     culpar a quien lo intento. */
  error: 'sad',
};

type Piezas = { cls: string; vars: string; inner: string };

/** La libreria, cargada una sola vez para toda la aplicacion. */
let motor: Promise<((tam: number, pose: string, semilla: string, hue: number, tone: number) => Piezas) | null> | null = null;

function cargarMotor() {
  motor ??= Promise.all([
    import('blobatar/internal'),
    import('blobatar/expression'),
  ])
    .then(([interno, expr]: [any, any]) => {
      const poses: Record<string, any> = {
        idle: expr.idle, surprised: expr.surprised, happy: expr.happy, sad: expr.sad,
      };
      const cache = new Map<string, Piezas>();
      /* La clave lleva la variante: dos apariencias distintas no pueden
         compartir piezas, o una se pintaria con la cara de la otra. */
      return (tam: number, pose: string, semilla: string, hue: number, tone: number): Piezas => {
        const clave = `${semilla}|${hue}|${tone}|${tam}|${pose}`;
        const ya = cache.get(clave);
        if (ya) return ya;
        const p = interno._parts(semilla, {
          size: tam,
          expression: poses[pose],
          /* `always` y no `hover`: la mascota respira este donde este el raton.
             Con `hover` habria que pasarle el cursor por encima para que diera
             senales de vida, que es lo contrario de lo que tiene que decir. */
          animate: 'always',
          hue, tone,
          background: false,
        });
        const piezas: Piezas = {
          cls: p.cls ?? '',
          vars: p.vars ? interno.serializeVars(p.vars) : '',
          inner: p.inner ?? '',
        };
        cache.set(clave, piezas);
        return piezas;
      };
    })
    .catch(() => null);
  return motor;
}

@Component({
  selector: 'wx-mascota',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
  <svg #figura viewBox="0 0 100 100"
       [attr.width]="size" [attr.height]="size"
       [attr.role]="alt ? 'img' : null"
       [attr.aria-label]="alt || null"
       [attr.aria-hidden]="alt ? null : 'true'"></svg>
  `,
  styles: [`
    :host { display: inline-flex; flex: none; }
    svg { display: block; overflow: visible; }
  `],
})
export class WxMascotaComponent implements OnChanges, AfterViewInit {
  /** Que esta pasando. Lo decide quien la coloca, no ella. */
  @Input() estado: EstadoMascota = 'idle';

  @Input() size = 72;

  /**
   * Lo que oye quien no ve la figura. Vacio = decorativa: al lado siempre hay
   * texto que dice lo mismo, y oirlo dos veces es ruido.
   */
  @Input() alt = '';

  /**
   * QUIEN es esta mascota.
   *
   * Sin esto, toda la aplicacion pintaba exactamente el mismo personaje.
   * La variante decide la APARIENCIA —forma y color—; `estado` decide la
   * EXPRESION. Son cosas distintas: la misma variante pasa por los cuatro
   * estados sin convertirse en otro.
   *
   * Nunca se sortea aqui. Quien la pasa la ha calculado ya de una semilla
   * estable: el id de una persona, o la sesion en el caso de Wybix Guide.
   */
  @Input() variante: VarianteMascota = VARIANTE_BASE;

  @ViewChild('figura') figura?: ElementRef<SVGSVGElement>;

  /** Con que se escribio el interior, para no reescribirlo sin motivo.
      Lleva la variante: otra apariencia es otra figura, no el mismo nodo. */
  private dibujado = '';

  ngAfterViewInit(): void { void this.pintar(); }

  ngOnChanges(): void {
    /* La primera pasada llega antes de que exista el SVG; de esa se encarga
       `ngAfterViewInit`. */
    if (this.figura) void this.pintar();
  }

  private async pintar(): Promise<void> {
    const el = this.figura?.nativeElement;
    if (!el) return;

    const hacer = await cargarMotor();
    if (!hacer) return;

    const v = this.variante ?? VARIANTE_BASE;
    const p = hacer(this.size, POSE[this.estado], v.semilla, v.hue, v.tone);

    /*
     * El interior solo se escribe cuando cambia el TAMANO, nunca al cambiar de
     * estado: reescribirlo daria un nodo nuevo y la cara saltaria en vez de
     * morfearse.
     *
     * `innerHTML` directo y no una atadura de Angular: lo que se escribe lo
     * genera la libreria a partir de una semilla fija que esta aqui arriba. No
     * hay nada de fuera en ese texto, asi que no hay nada que desinfectar.
     */
    const firma = `${v.semilla}|${this.size}`;
    if (this.dibujado !== firma) {
      el.innerHTML = p.inner;
      this.dibujado = firma;
    }

    el.setAttribute('class', p.cls);
    el.setAttribute('style', p.vars);
  }
}
