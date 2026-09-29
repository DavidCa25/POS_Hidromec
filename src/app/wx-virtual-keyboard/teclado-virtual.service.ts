import { Injectable, inject, signal } from '@angular/core';
import { CapabilityService } from '../../core';

export type ModoTeclado = 'AUTO' | 'SIEMPRE' | 'NUNCA';
export type LayoutTeclado = 'TEXT' | 'NUMERIC' | 'MONEY' | 'QUANTITY';

type Campo = HTMLInputElement | HTMLTextAreaElement;

const TIPOS_DE_TEXTO = new Set(['text', 'search', 'number', 'tel', 'email', 'password', 'url', '']);

/**
 * EL TECLADO EN PANTALLA, PARA TODA LA APLICACION.
 *
 * No hay formularios «para tactil» y formularios «para teclado». Los campos
 * son los de siempre: este servicio mira que campo recibe el foco y, si en
 * este equipo toca, saca el teclado de Wybix, que escribe en ESE campo como
 * lo haria una persona -con el evento `input`- asi que `ngModel`, los
 * validadores y los atajos existentes funcionan sin enterarse.
 *
 * El teclado fisico sigue funcionando a la vez: aqui no se intercepta ni una
 * tecla. Lo unico que se hace al campo es ponerle `inputmode="none"` mientras
 * el teclado de Wybix esta abierto, para que Windows no saque el suyo encima,
 * y se le devuelve el que tenia al cerrarse.
 *
 * CUANDO APARECE
 *   NUNCA    jamas.
 *   SIEMPRE  en cualquier campo de escritura.
 *   AUTO     segun COMO se esta usando el equipo ahora mismo, no segun que
 *            equipo es: lo ultimo que hizo la persona fue tocar con el dedo o
 *            un lapiz -> aparece; usar el raton -> no. Una caja Touch operada
 *            con raton y teclado no lo saca.
 *
 * EL TECLADO FISICO NUNCA LO CIERRA. Si esta abierto y se escribe con el
 * fisico, sigue abierto: los dos escriben en el mismo campo. Si el fisico
 * mueve el foco a otro campo (Tab, o una pantalla que reenfoca), el teclado
 * se muda a ese campo. Solo lo cierran: perder el foco hacia algo que no es
 * un campo, un clic de RATON en otro campo (AUTO), «Listo» u ocultarlo.
 *
 * EL LAYOUT lo dice el campo con `data-teclado="TEXT|NUMERIC|MONEY|QUANTITY"`.
 * Si no lo dice, un `type="number"` o un `inputmode` numerico es NUMERIC y
 * todo lo demas es TEXT. `data-teclado="no"` lo excluye.
 */
@Injectable({ providedIn: 'root' })
export class TecladoVirtualService {
  private readonly caps = inject(CapabilityService);

  readonly modo = signal<ModoTeclado>('AUTO');
  readonly visible = signal(false);
  readonly layout = signal<LayoutTeclado>('TEXT');
  readonly esPassword = signal(false);
  /** Para QUANTITY: si admite decimales (el campo lo dice con `step`). */
  readonly decimales = signal(false);

  private campo: Campo | null = null;
  private inputmodeOriginal: string | null = null;
  /** Lo ultimo que hizo la persona. `null`: aun nada en esta sesion. */
  private modalidad: 'tactil' | 'raton' | 'teclado' | null = null;
  private cierre: any = null;
  private iniciado = false;

  /** Se llama una vez, desde el componente raiz del teclado. */
  iniciar(): void {
    if (this.iniciado) return;
    this.iniciado = true;
    void this.cargarModo();
    document.addEventListener('pointerdown', (e) => {
      this.modalidad = e.pointerType === 'touch' || e.pointerType === 'pen' ? 'tactil' : 'raton';
      /* Tocar otra vez el campo que ya tiene el foco lo vuelve a sacar, si
         alguien lo habia ocultado. `focusin` no se dispara: ya tenia el foco. */
      const t = e.target;
      if (!this.visible() && this.esCampo(t) && document.activeElement === t) {
        setTimeout(() => this.alEnfocar(t), 0);
      }
    }, true);
    /* Una tecla FISICA dice «ahora se usa el teclado». Las que genera el
       propio teclado de Wybix (`enter()`) no son de confianza y no cuentan;
       las teclas sueltas de modificador tampoco. */
    document.addEventListener('keydown', (e) => {
      if (!e.isTrusted || ['Shift', 'Control', 'Alt', 'Meta', 'CapsLock'].includes(e.key)) return;
      this.modalidad = 'teclado';
    }, true);
    document.addEventListener('focusin', (e) => this.alEnfocar(e.target), true);
    document.addEventListener('focusout', (e) => this.alDesenfocar(e as FocusEvent), true);
  }

  // ------------------------------------------------------------------ modo
  private async cargarModo() {
    try {
      const cfg = await (window as any).electronAPI?.getDeviceConfig?.();
      const m = String(cfg?.teclado?.modo ?? cfg?.data?.teclado?.modo ?? '').toUpperCase();
      if (m === 'SIEMPRE' || m === 'NUNCA' || m === 'AUTO') this.modo.set(m);
    } catch { /* sin configuracion: AUTO */ }
  }

  async fijarModo(m: ModoTeclado): Promise<boolean> {
    try {
      const r = await (window as any).electronAPI?.setDeviceConfig?.({ teclado: { modo: m } });
      if (r && r.success === false) return false;
      this.modo.set(m);
      if (m === 'NUNCA') this.cerrar();
      return true;
    } catch {
      return false;
    }
  }

  // ----------------------------------------------------------------- foco
  private esCampo(el: EventTarget | null): el is Campo {
    if (el instanceof HTMLTextAreaElement) return !el.readOnly && !el.disabled;
    if (!(el instanceof HTMLInputElement)) return false;
    return TIPOS_DE_TEXTO.has((el.getAttribute('type') || '').toLowerCase()) && !el.readOnly && !el.disabled;
  }

  private debeAparecer(el: Campo): boolean {
    if (el.dataset['teclado'] === 'no') return false;
    const m = this.modo();
    if (m === 'NUNCA') return false;
    if (m === 'SIEMPRE') return true;
    /* AUTO. Sin nada hecho todavia, se supone lo del equipo: una caja Touch
       con pantalla tactil empieza en tactil; todo lo demas, en raton. */
    const modo = this.modalidad ?? (this.caps.touchPos && navigator.maxTouchPoints > 0 ? 'tactil' : 'raton');
    if (modo === 'tactil') return true;
    /* Con el teclado fisico no se ABRE, pero si ya estaba abierto se queda:
       escribir o tabular con el fisico no le quita el teclado a quien lo usa. */
    if (modo === 'teclado') return this.visible();
    return false;
  }

  private layoutDe(el: Campo): LayoutTeclado {
    const d = String(el.dataset['teclado'] || '').toUpperCase();
    if (d === 'TEXT' || d === 'NUMERIC' || d === 'MONEY' || d === 'QUANTITY') return d;
    const tipo = (el.getAttribute('type') || '').toLowerCase();
    const im = (el.getAttribute('inputmode') || '').toLowerCase();
    if (tipo === 'number' || im === 'numeric' || im === 'decimal' || tipo === 'tel') return 'NUMERIC';
    return 'TEXT';
  }

  private alEnfocar(t: EventTarget | null) {
    if ((t as HTMLElement)?.closest?.('.wxvk')) return;
    if (!this.esCampo(t)) return;
    /* El MISMO campo vuelve a recibir el foco (una pantalla que reenfoca al
       teclear, o blur+focus): el teclado ya es suyo y se queda. */
    if (t === this.campo && this.visible()) { clearTimeout(this.cierre); return; }
    if (!this.debeAparecer(t)) { this.cerrar(); return; }
    clearTimeout(this.cierre);
    this.soltarCampo();
    this.campo = t;
    this.inputmodeOriginal = t.getAttribute('inputmode');
    t.setAttribute('inputmode', 'none');
    this.layout.set(this.layoutDe(t));
    this.esPassword.set(t instanceof HTMLInputElement && t.type === 'password');
    const step = t.getAttribute('step') || '';
    this.decimales.set(step === 'any' || step.includes('.') || t.dataset['decimal'] === 'si');
    this.visible.set(true);
    requestAnimationFrame(() => this.aLaVista());
  }

  /**
   * Al perder el foco se cierra, pero con una pausa: si el foco pasa a otro
   * campo -Tab, o tocar el siguiente- el teclado no baja para volver a subir.
   */
  private alDesenfocar(e: FocusEvent) {
    if (e.target !== this.campo) return;
    const siguiente = e.relatedTarget as HTMLElement | null;
    if (siguiente?.closest?.('.wxvk')) return;
    clearTimeout(this.cierre);
    this.cierre = setTimeout(() => {
      if (document.activeElement !== this.campo) this.cerrar();
    }, 120);
  }

  cerrar() {
    clearTimeout(this.cierre);
    this.soltarCampo();
    this.visible.set(false);
    document.documentElement.classList.remove('wx-teclado-abierto');
  }

  private soltarCampo() {
    if (!this.campo) return;
    if (this.inputmodeOriginal == null) this.campo.removeAttribute('inputmode');
    else this.campo.setAttribute('inputmode', this.inputmodeOriginal);
    this.campo = null;
    this.inputmodeOriginal = null;
  }

  /**
   * Que el teclado no tape el campo. La pagina recibe un relleno abajo del
   * alto del teclado -para que haya a donde desplazarse- y el campo se lleva
   * a la vista.
   */
  aLaVista(alto?: number) {
    if (!this.campo) return;
    const h = alto ?? (document.querySelector('.wxvk') as HTMLElement | null)?.offsetHeight ?? 0;
    document.documentElement.style.setProperty('--wx-teclado-alto', `${h}px`);
    document.documentElement.classList.add('wx-teclado-abierto');
    const r = this.campo.getBoundingClientRect();
    if (r.bottom > window.innerHeight - h - 12 || r.top < 0) {
      this.campo.scrollIntoView({ block: 'center', behavior: 'auto' });
    }
  }

  // ----------------------------------------------------------- escribir
  /** Escribe en el campo como lo haria una persona: con el evento `input`. */
  escribir(texto: string) {
    const c = this.campo;
    if (!c) return;
    let valor = c.value;
    let ini = valor.length, fin = valor.length;
    try {
      if (c.selectionStart != null && c.selectionEnd != null) { ini = c.selectionStart; fin = c.selectionEnd; }
    } catch { /* type=number no tiene seleccion: se escribe al final */ }

    if (this.layout() === 'MONEY' && texto) {
      const futuro = valor.slice(0, ini) + texto + valor.slice(fin);
      if (!/^\d*(\.\d{0,2})?$/.test(futuro)) return;
    }
    if (texto === '.' && valor.includes('.') && this.layout() !== 'TEXT') return;

    valor = valor.slice(0, ini) + texto + valor.slice(fin);
    this.poner(valor, ini + texto.length);
  }

  borrar() {
    const c = this.campo;
    if (!c) return;
    let valor = c.value;
    let ini = valor.length, fin = valor.length;
    try {
      if (c.selectionStart != null && c.selectionEnd != null) { ini = c.selectionStart; fin = c.selectionEnd; }
    } catch { /* sin seleccion */ }
    if (ini === fin && ini > 0) ini -= 1;
    valor = valor.slice(0, ini) + valor.slice(fin);
    this.poner(valor, ini);
  }

  limpiar() { this.poner('', 0); }

  /** Suma o resta a una cantidad. Nunca por debajo de cero. */
  paso(delta: number) {
    const c = this.campo;
    if (!c) return;
    const n = Number(String(c.value).replace(',', '.')) || 0;
    const nuevo = Math.max(0, Math.round((n + delta) * 1000) / 1000);
    this.poner(String(nuevo), String(nuevo).length);
  }

  private poner(valor: string, cursor: number) {
    const c = this.campo;
    if (!c) return;
    const proto = c instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value')?.set?.call(c, valor);
    c.dispatchEvent(new Event('input', { bubbles: true }));
    try { c.setSelectionRange(cursor, cursor); } catch { /* type=number */ }
  }

  /** «Listo»: lo mismo que pulsar Enter en el campo, y el teclado se va. */
  enter() {
    const c = this.campo;
    if (!c) return;
    const opts = { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true } as KeyboardEventInit;
    const abajo = c.dispatchEvent(new KeyboardEvent('keydown', opts));
    c.dispatchEvent(new KeyboardEvent('keyup', opts));
    if (abajo && c instanceof HTMLInputElement && c.form) c.form.requestSubmit?.();
    c.blur();
    this.cerrar();
  }

  /** «Siguiente»: el siguiente campo de escritura, como Tab. */
  siguiente() {
    const c = this.campo;
    if (!c) return;
    const todos = Array.from(document.querySelectorAll<HTMLElement>('input, textarea'))
      .filter(el => this.esCampo(el) && el.offsetParent !== null && el.tabIndex >= 0);
    const i = todos.indexOf(c);
    const sig = todos[i + 1];
    if (sig) sig.focus(); else this.enter();
  }

  hayCampo(): boolean { return !!this.campo; }
}
