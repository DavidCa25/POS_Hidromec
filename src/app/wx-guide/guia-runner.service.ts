import { Injectable, NgZone, computed, inject, signal } from '@angular/core';
import { NavigationEnd, Router } from '@angular/router';
import { filter, firstValueFrom, take } from 'rxjs';
import { CapabilityService, CartService, GiroServiciosService, MesaService, ShiftService } from '../../core';
import { MenuCatalogService } from '../../core/menu-catalog.service';
import { AuthService } from '../../services/auth.service';
import { NavegacionService } from '../wx-nav/navegacion.service';
import { ContextoGuia, Espera, EstadoGuia, Escenario, Objetivo, Paso, Presencia, Requisitos } from './guia-tipos';
import { ESCENARIOS, escenario } from './escenarios';
import { GuiaFocoService } from './guia-foco.service';
import { GuiaProgresoService } from './guia-progreso.service';
import { GuiaVozService } from './guia-voz.service';
import { FaltaPrecondicion, Servicios, hecho as hechoDeNegocio, preparacion } from './guia-acciones';

/**
 * Cuanto se espera, como mucho. Son la RED, no el mecanismo: lo que hace
 * avanzar es observar el DOM, el router y el negocio. Y solo cuentan mientras
 * la demo corre: una pausa (tomar el control) detiene el reloj.
 */
const LIMITE_OBJETIVO = 9000;
const LIMITE_DESPUES = 12000;
const LIMITE_OPCIONAL = 1800;
const LIMITE_HECHO = 15000;
const CADA_HECHO_MS = 600;

type Fase = 'oculta' | 'saludo' | 'recorrido' | 'cierre' | 'rechazo';
type Salida = 'siguiente' | 'anterior' | 'reevaluar';

/*
 * LOS ERRORES TIENEN DOS CARAS.
 *
 * Dentro: un codigo y el detalle tecnico, que se anotan en el diagnostico
 * (escenario, paso, ruta, objetivo, estado esperado y actual, tiempo, motivo).
 * Fuera: una frase para personas. «limite», «no-encontrado» o «target
 * timeout» NUNCA llegan a la pantalla.
 */
type Codigo = 'OBJETIVO_NO_ENCONTRADO' | 'PRECONDICION' | 'ESTADO_NO_ALCANZADO' | 'ACCION_FALLIDA' | 'INTERNO';
const FRASE_DE_ERROR: Record<Codigo, string> = {
  OBJETIVO_NO_ENCONTRADO: 'No encontré esta parte de Wybix.',
  PRECONDICION: 'Falta algo para continuar con este recorrido.',
  ESTADO_NO_ALCANZADO: 'Esta acción todavía no terminó.',
  ACCION_FALLIDA: 'No pude completar este paso.',
  INTERNO: 'Algo no salió como esperaba.',
};

class Cancelado extends Error { constructor() { super('cancelado'); } }
class NoEncontrado extends Error { constructor(public objetivo: Objetivo) { super('objetivo'); } }
class SinTiempo extends Error { constructor() { super('tiempo'); } }
class GuiaError extends Error {
  constructor(public codigo: Codigo, public detalle: string, public extra: Record<string, unknown> = {}) { super(codigo); }
}

export interface Diagnostico {
  t: string;
  escenario: string | null;
  paso: string | null;
  ruta: string;
  objetivo: string | null;
  esperado: string | null;
  actual: string | null;
  ms: number | null;
  codigo: string;
  motivo: string;
}

/** Si la pantalla actual ya es la del paso: exacta, o por debajo si la ruta acaba en `/**`. */
function enRuta(url: string, ruta: string): boolean {
  const actual = url.split(/[?#]/)[0];
  if (!ruta.endsWith('/**')) return actual === ruta;
  const base = ruta.slice(0, -3);
  return actual === base || actual.startsWith(base + '/');
}

/**
 * EL MOTOR DE WYBIX GUIDE.
 *
 * Lee un escenario (datos) y lo lleva paso a paso:
 *
 *   1. navega con el router real, si el paso lo pide;
 *   2. espera a que el objetivo EXISTA y se vea -observando el DOM, no con
 *      pausas fijas-;
 *   3. lo encuadra con el foco (Driver.js) y Wybix lo mira;
 *   4. lo dice, con la voz de maquina de escribir;
 *   5. en la GUIA espera a la persona; en una DEMO actua por la misma
 *      superficie que usaria una persona, pidiendo permiso antes de escribir.
 *
 * EL NEGOCIO MANDA SOBRE EL DOM. Un paso de demo se da por hecho cuando el
 * NEGOCIO lo confirma («la comanda llego a la Barra»), no cuando un boton
 * aparece: el boton puede tardar, volverse a crear o estar en otra pantalla
 * porque la persona tomo el control. El DOM sirve para señalar e interactuar.
 *
 * TOMAR EL CONTROL. Un clic o una tecla de verdad fuera del presentador pausa
 * la demo y CORTA el paso en curso: nada sigue pulsando por detras. Al
 * continuar, el motor no retoma la instruccion vieja: vuelve a mirar como esta
 * Wybix de verdad y sigue desde el ultimo paso que ya se cumplio.
 */
@Injectable({ providedIn: 'root' })
export class GuiaRunnerService {
  private readonly router = inject(Router);
  private readonly zone = inject(NgZone);
  private readonly caps = inject(CapabilityService);
  private readonly auth = inject(AuthService);
  private readonly nav = inject(NavegacionService);
  private readonly turno = inject(ShiftService);
  private readonly cart = inject(CartService);
  private readonly mesas = inject(MesaService);
  private readonly menu = inject(MenuCatalogService);
  private readonly giro = inject(GiroServiciosService);
  private readonly foco = inject(GuiaFocoService);
  readonly voz = inject(GuiaVozService);
  readonly progreso = inject(GuiaProgresoService);

  readonly fase = signal<Fase>('oculta');
  readonly escenario = signal<Escenario | null>(null);
  readonly pasos = signal<Paso[]>([]);
  readonly indice = signal(0);
  readonly estado = signal<EstadoGuia>('idle');
  readonly pausado = signal(false);
  readonly aviso = signal<string | null>(null);
  readonly esperando = signal<Espera | null>(null);
  readonly perdido = signal(false);
  readonly objetivo = signal<Element | null>(null);
  readonly demo = signal<{ autopilot: boolean; perfil: string | null; preset: string | null; motivo: string } | null>(null);
  /** Al terminar el recorrido inicial: «no volver a mostrarlo solo». */
  sinAutoAlCerrar = true;

  readonly paso = computed<Paso | null>(() => this.pasos()[this.indice()] ?? null);
  readonly total = computed(() => this.pasos().length);
  readonly esDemo = computed(() => this.escenario()?.modo === 'demo');
  readonly presencia = computed<Presencia>(() => {
    const f = this.fase();
    if (f === 'saludo' || f === 'rechazo') return 'compacto';
    return this.esDemo() ? 'demo' : 'presentador';
  });

  /** Lo ultimo que paso por dentro: para soporte y para las pruebas. */
  private readonly registro: Diagnostico[] = [];
  /** La memoria de ESTA vuelta: ids de la mesa, la comanda, la orden… */
  private mem: Record<string, any> = {};

  private general: AbortController | null = null;
  private delPaso: AbortController | null = null;
  private salidaPedida: Salida | null = null;
  private resolverBoton: ((v: 'boton' | 'saltar') => void) | null = null;
  private resolverPausa: (() => void) | null = null;
  private sello = '';
  private inicioPaso = 0;

  constructor() {
    this.foco.alTocarFuera(() => this.zone.run(() => this.tocaronFuera()));
    /* Tomar el control a mano detiene la demo: un clic o una tecla de verdad
       fuera del presentador. En la guia es al reves: la persona trabaja. */
    const tomar = (e: Event) => {
      if (!e.isTrusted || this.fase() !== 'recorrido' || !this.esDemo() || this.pausado()) return;
      if ((e.target as HTMLElement)?.closest?.('.wxgl')) return;
      if (e instanceof KeyboardEvent && (e.key === ' ' || e.key === 'Escape')) return;
      this.zone.run(() => this.pausar('Tomaste el control. Continúa cuando quieras.'));
    };
    document.addEventListener('pointerdown', tomar, true);
    document.addEventListener('keydown', tomar, true);
    document.addEventListener('keydown', (e) => {
      if (!e.isTrusted || this.fase() === 'oculta') return;
      const enCampo = (e.target as HTMLElement)?.closest?.('input, textarea, [contenteditable="true"]');
      if (e.key === 'Escape' && this.fase() === 'recorrido') { e.stopPropagation(); this.zone.run(() => this.detener()); }
      else if (e.key === ' ' && this.esDemo() && this.fase() === 'recorrido' && !enCampo) {
        e.preventDefault();
        this.zone.run(() => this.pausado() ? this.reanudar() : this.pausar());
      }
    }, true);
    window.addEventListener('resize', () => this.foco.reencuadrar());
  }

  // ================================================================ catalogo
  /** Lo que ESTA persona puede recorrer en ESTE negocio. */
  disponibles(demoCtx?: { autopilot: boolean; perfil: string | null; preset?: string | null } | null): Escenario[] {
    const ctx = this.contexto(demoCtx?.perfil ?? null, demoCtx?.preset ?? null);
    return ESCENARIOS.filter(e => {
      if (e.modo === 'demo' && !demoCtx?.autopilot) return false;
      if (!this.cumple(e.requiere, ctx)) return false;
      return e.pasos.some(p => this.cumple(p.requiere, ctx));
    });
  }

  private contexto(perfilDemo: string | null, presetDemo: string | null = null): ContextoGuia {
    const a = this.auth.acceso();
    return {
      nombre: a?.usuario ?? '',
      rutaDeVenta: this.caps.rutaDeVenta,
      touch: this.caps.touchPos,
      perfilDemo,
      presetDemo,
    };
  }

  /** La misma regla que el resto del sistema: nada de listas propias de modulos. */
  cumple(r: Requisitos | undefined, ctx: ContextoGuia): boolean {
    if (!r) return true;
    if (r.touch !== undefined && r.touch !== ctx.touch) return false;
    if (r.areas?.length) {
      const visibles = new Set(this.nav.areas().map(a => a.id));
      if (!r.areas.every(a => visibles.has(a))) return false;
    }
    if (r.capacidades?.length && !r.capacidades.every(c => !!(this.caps as any)[c])) return false;
    if (r.sinCapacidades?.length && r.sinCapacidades.some(c => !!(this.caps as any)[c])) return false;
    /* El giro lo dice GiroServiciosService, el mismo que decide las pestanas
       de Servicios: aqui no hay una lista propia de giros. */
    if (r.giro) {
      if (!this.caps.servicios) return false;
      if (r.giro.inicio && this.giro.inicio !== r.giro.inicio) return false;
      if (r.giro.usaActivos !== undefined && this.giro.usaActivos !== r.giro.usaActivos) return false;
      if (r.giro.usaAgenda !== undefined && this.giro.usaAgenda !== r.giro.usaAgenda) return false;
    }
    if (r.paquetes?.length && !r.paquetes.every(p => this.auth.puede(p))) return false;
    if (r.perfilDemo?.length && ctx.perfilDemo && !r.perfilDemo.includes(ctx.perfilDemo)) return false;
    if (r.presetDemo?.length && !(ctx.presetDemo && r.presetDemo.includes(ctx.presetDemo))) return false;
    if (r.turno !== undefined && this.turno.isOpen !== r.turno) return false;
    return true;
  }

  async contextoDemo() {
    try {
      const r = await (window as any).wybix?.guide?.contexto?.();
      const d = r?.data ?? null;
      const c = { autopilot: !!d?.autopilot, perfil: d?.perfil ?? null, preset: d?.preset ?? null, motivo: String(d?.motivo ?? '') };
      this.demo.set(c);
      return c;
    } catch {
      const c = { autopilot: false, perfil: null, preset: null, motivo: 'No se pudo comprobar si esta es una demostración.' };
      this.demo.set(c);
      return c;
    }
  }

  // ================================================================ ciclo
  /** El saludo del primer uso. No bloquea: se puede ignorar y seguir trabajando. */
  saludar(nombre: string) {
    if (this.fase() !== 'oculta') return;
    this.escenario.set(null);
    this.pasos.set([]);
    this.fase.set('saludo');
    this.estado.set('speaking');
    void this.voz.decir(`Hola, ${nombre}. Tu negocio ya está listo. ¿Te enseño Wybix? Son unos minutos.`)
      .then(() => { if (this.fase() === 'saludo') this.estado.set('waiting'); });
  }

  async iniciar(id: string): Promise<boolean> {
    const e = escenario(id);
    if (!e) return false;
    this.detener(false);

    await this.preparar();
    let perfil: string | null = null;
    let preset: string | null = null;
    if (e.modo === 'demo') {
      /* La primera guarda: sin demostracion segura, no empieza. Cada paso que
         escribe vuelve a preguntar al proceso principal. */
      const c = await this.contextoDemo();
      if (!c.autopilot) { this.rechazar(c.motivo); return false; }
      perfil = c.perfil;
      preset = c.preset;
    }
    const ctx = this.contexto(perfil, preset);
    const pasos = e.pasos.filter(p => this.cumple(p.requiere, ctx));
    if (!pasos.length) return false;

    this.sello = new Date().toISOString().replace(/\D/g, '').slice(4, 14);
    this.mem = {};
    this.escenario.set(e);
    this.pasos.set(pasos);
    this.indice.set(0);
    this.pausado.set(false);
    this.aviso.set(null);
    this.perdido.set(false);
    this.fase.set('recorrido');
    this.sinAutoAlCerrar = true;
    void this.bucle(e, ctx);
    return true;
  }

  private rechazar(motivo: string) {
    this.fase.set('rechazo');
    this.estado.set('attention');
    this.escenario.set(null);
    this.pasos.set([]);
    void this.voz.decir(`${motivo} Aquí te enseño, pero no creo datos por ti.`);
  }

  private get servicios(): Servicios {
    return { caps: this.caps, turno: this.turno, cart: this.cart, mesas: this.mesas, menu: this.menu, mem: this.mem };
  }

  private async bucle(e: Escenario, ctx: ContextoGuia) {
    const general = new AbortController();
    this.general = general;
    try {
      if (e.modo === 'demo' && e.prepara) await this.prepararDemo(e, general.signal);
      while (this.indice() < this.pasos().length) {
        if (general.signal.aborted) return;
        const i = this.indice();
        this.progreso.recordar(e.id, i);
        const salida = await this.correrPaso(e, this.pasos()[i], ctx, general.signal);
        if (general.signal.aborted) return;
        if (salida === 'reevaluar') {
          /* Tomo el control: se espera a «Continuar» y se mira el mundo como
             esta AHORA, no como lo dejamos. */
          await this.sinPausa(general.signal);
          await this.reubicar(ctx);
          continue;
        }
        this.indice.set(salida === 'anterior' ? Math.max(0, i - 1) : i + 1);
      }
      if (e.modo === 'demo' && e.verificaFinal && !(await this.verdad(e.verificaFinal))) {
        throw new GuiaError('ESTADO_NO_ALCANZADO', `verificacion final ${e.verificaFinal} en falso`,
          { esperado: e.verificaFinal, actual: 'falso' });
      }
      this.cerrar(e);
    } catch (err) {
      if (err instanceof Cancelado || general.signal.aborted) return;
      this.fallar(err);
    }
  }

  /** Lo que la demo necesita, antes del primer paso. Idempotente. */
  private async prepararDemo(e: Escenario, s: AbortSignal) {
    const f = preparacion(e.id);
    if (!f) return;
    this.estado.set('thinking');
    const r = await (window as any).wybix?.guide?.autorizar?.({ paso: 'preparar' });
    if (!r?.success) {
      this.detener(false);
      this.rechazar(r?.error || 'Esta no es una demostración segura.');
      throw new Cancelado();
    }
    const t0 = performance.now();
    try {
      await f(this.servicios);
    } catch (err) {
      throw new GuiaError('PRECONDICION', err instanceof Error ? err.message : String(err),
        { ms: Math.round(performance.now() - t0) });
    }
    if (s.aborted) throw new Cancelado();
    this.anotar({ codigo: 'PREPARADA', motivo: `memoria ${JSON.stringify(this.mem)}`, ms: Math.round(performance.now() - t0) });
  }

  /**
   * Tras tomar el control: ¿donde esta Wybix de verdad? Se busca, desde el
   * final hacia atras, el ultimo paso que YA se cumplio; se sigue desde el
   * siguiente. Si la persona llego a C, A y B quedan hechos sin repetirlos.
   */
  private async reubicar(ctx: ContextoGuia) {
    const pasos = this.pasos();
    const desde = this.indice();
    for (let j = pasos.length - 1; j >= desde; j--) {
      const c = pasos[j].logrado;
      if (c && await this.evaluar(c)) {
        this.anotar({ codigo: 'REANUDA', motivo: `ya estaba cumplido hasta «${pasos[j].id}»`, paso: pasos[j].id });
        this.indice.set(Math.min(j + 1, pasos.length));
        return;
      }
    }
    this.anotar({ codigo: 'REANUDA', motivo: `se repite «${pasos[desde]?.id}»`, paso: pasos[desde]?.id ?? null });
  }

  private async correrPaso(e: Escenario, p: Paso, ctx: ContextoGuia, general: AbortSignal): Promise<Salida> {
    const ctrl = new AbortController();
    this.delPaso = ctrl;
    this.salidaPedida = null;
    this.inicioPaso = performance.now();
    const corta = () => ctrl.abort();
    general.addEventListener('abort', corta, { once: true });
    const s = ctrl.signal;
    this.esperando.set(null);
    this.perdido.set(false);
    this.aviso.set(this.pausado() ? this.aviso() : null);
    const demo = e.modo === 'demo';

    try {
      await this.sinPausa(s);

      /* DEMO: si el negocio dice que este paso ya esta hecho -lo hizo la
         persona, o una vuelta anterior lo dejo asi-, no se repite. */
      if (demo && p.logrado && await this.evaluar(p.logrado)) {
        this.anotar({ codigo: 'YA_HECHO', motivo: 'el paso ya estaba cumplido', paso: p.id });
        return 'siguiente';
      }

      // ---------------------------------------------------------- llegar
      await this.llegar(p, ctx);

      let el: Element | null = null;
      if (p.objetivo) {
        this.estado.set('thinking');
        el = await this.encontrar(p, ctx, s);
        if (!el && p.opcional) return 'siguiente';
        if (!el && !demo) return await this.recuperar(p.objetivo, s);
        if (!el && demo) {
          /* Recuperar primero. Si el negocio ya lo tiene hecho, el paso esta
             cumplido. Si el paso solo MUESTRA algo que el negocio confirma
             («ya llego a la Barra») y la pantalla tarda en pintarlo, se dice
             sin señalar: el DOM no manda sobre la verdad. */
          if (p.logrado && await this.evaluar(p.logrado)) return 'siguiente';
          if (!p.acciones?.length && p.verifica && await this.verdad(p.verifica)) {
            this.anotar({ codigo: 'SIN_DOM', motivo: 'el negocio lo confirma; se dice sin señalar', paso: p.id,
              objetivo: this.describir(this.resolver(p.objetivo)) });
          } else {
            throw new GuiaError('OBJETIVO_NO_ENCONTRADO', `no aparecio ${this.describir(this.resolver(p.objetivo))}`,
              { objetivo: this.describir(this.resolver(p.objetivo)) });
          }
        }
      }
      this.objetivo.set(el);
      await this.foco.resaltar(el);

      /* GUIA: lo que el paso espera de la persona se escucha DESDE YA, no
         cuando Wybix termina de hablar. Quien ya sabe que hacer no tiene que
         esperar a la frase: si lo hace antes, la frase se completa y se sigue. */
      const espera: Espera | null = !demo ? (p.espera ?? { tipo: 'boton' }) : null;
      const hecho = espera && espera.tipo !== 'boton'
        ? this.cumplir(espera, el, s, 0).then(() => 'hecho' as const)
        : null;
      hecho?.catch(() => { /* cancelado con el paso */ });

      // ----------------------------------------------------------- decir
      this.estado.set('speaking');
      const dicho = this.hablar(this.formato(p.mensaje, ctx), s).then(() => 'dicho' as const);
      const primero = hecho ? await Promise.race([dicho, hecho]) : await dicho;
      const reposo: EstadoGuia = p.estado ?? (el ? 'pointing' : 'idle');
      if (primero === 'hecho') {
        this.voz.completar();
        this.estado.set('success');
        await this.esperar(650, s);
        return this.salidaPedida ?? 'siguiente';
      }
      this.estado.set(reposo);

      // --------------------------------------------------------- demo
      if (demo) {
        await this.esperar(420, s);
        for (const a of p.acciones ?? []) {
          await this.sinPausa(s);
          await this.actuar(a, p, s);
        }
        await this.confirmar(p, el, s);
        this.estado.set(reposo === 'success' ? 'success' : 'idle');
        await this.esperar(380, s);
        return this.salidaPedida ?? 'siguiente';
      }

      // --------------------------------------------------------- guia
      this.esperando.set(espera);
      if (!espera || espera.tipo === 'boton') {
        await this.boton(s);
      } else {
        this.estado.set('waiting');
        const r = await Promise.race([hecho!, this.boton(s)]);
        if (r === 'hecho') {
          /* Salio bien: Wybix lo celebra un instante y sigue. */
          this.estado.set('success');
          await this.esperar(650, s);
        }
      }
      return this.salidaPedida ?? 'siguiente';
    } catch (err) {
      if (s.aborted && this.salidaPedida && !general.aborted) return this.salidaPedida;
      if (err instanceof GuiaError) {
        err.extra['paso'] = p.id;
        err.extra['ms'] = Math.round(performance.now() - this.inicioPaso);
      }
      throw err;
    } finally {
      general.removeEventListener('abort', corta);
      this.esperando.set(null);
    }
  }

  /** Ir a la pantalla del paso, si no se esta ya en ella. */
  private async llegar(p: Paso, ctx: ContextoGuia) {
    const ruta = typeof p.ruta === 'function' ? p.ruta(ctx) : p.ruta;
    if (ruta && !enRuta(this.router.url, ruta)) {
      this.estado.set('thinking');
      this.foco.apagar();
      await this.router.navigateByUrl(ruta.replace(/\/\*\*$/, ''));
    }
  }

  /**
   * El objetivo del paso, con UNA recuperacion: si no esta y el paso sabe en
   * que pantalla vive, se vuelve a ella y se busca otra vez. Devuelve null en
   * vez de fallar: decide quien llama.
   */
  private async encontrar(p: Paso, ctx: ContextoGuia, s: AbortSignal): Promise<Element | null> {
    const o = this.resolver(p.objetivo!);
    const limite = p.limite ?? (p.opcional ? LIMITE_OPCIONAL : LIMITE_OBJETIVO);
    try {
      return await this.esperarElemento(o, s, limite);
    } catch (err) {
      if (!(err instanceof NoEncontrado)) throw err;
    }
    if (p.opcional) return null;
    const ruta = typeof p.ruta === 'function' ? p.ruta(ctx) : p.ruta;
    if (ruta) {
      this.anotar({ codigo: 'RECUPERA', motivo: 'se vuelve a la pantalla del paso', paso: p.id, objetivo: this.describir(o) });
      this.foco.apagar();
      await this.router.navigateByUrl(ruta.replace(/\/\*\*$/, ''));
      try { return await this.esperarElemento(o, s, LIMITE_OBJETIVO); } catch (err) {
        if (!(err instanceof NoEncontrado)) throw err;
      }
    }
    return null;
  }

  /**
   * Demo: ¿el paso se cumplio? Si declara un HECHO, manda el negocio. Si solo
   * declara un cambio de pantalla (`despues`), se espera ese cambio; y si no
   * llega pero el negocio ya lo tiene (`logrado`), tambien vale.
   */
  private async confirmar(p: Paso, el: Element | null, s: AbortSignal) {
    if (p.verifica) {
      this.estado.set('thinking');
      await this.cumplir({ tipo: 'hecho', nombre: p.verifica }, el, s, LIMITE_HECHO).catch(async (err) => {
        if (!(err instanceof SinTiempo)) throw err;
        throw new GuiaError('ESTADO_NO_ALCANZADO', `el hecho ${p.verifica} no se cumplio`,
          { esperado: p.verifica, actual: 'falso' });
      });
      return;
    }
    if (!p.despues) return;
    this.estado.set('thinking');
    try {
      await this.cumplir(p.despues, el, s, LIMITE_DESPUES);
    } catch (err) {
      if (!(err instanceof SinTiempo) && !(err instanceof NoEncontrado)) throw err;
      if (p.logrado && await this.evaluar(p.logrado)) return;
      throw new GuiaError('ESTADO_NO_ALCANZADO', `la pantalla no llego a ${this.describirEspera(p.despues)}`,
        { esperado: this.describirEspera(p.despues), actual: 'sin cambio' });
    }
  }

  /** El objetivo no aparecio en la guia: se dice como a una persona, y se ofrece saltar. */
  private async recuperar(o: Objetivo, s: AbortSignal): Promise<Salida> {
    this.foco.apagar();
    this.objetivo.set(null);
    this.perdido.set(true);
    this.estado.set('attention');
    this.anotar({ codigo: 'OBJETIVO_NO_ENCONTRADO', motivo: 'guia: se ofrece saltar', objetivo: this.describir(o) });
    await this.hablar('No encontré esta parte de Wybix. Puede que aquí no esté disponible. ¿Saltamos este paso?', s);
    await this.boton(s);
    this.perdido.set(false);
    return this.salidaPedida ?? 'siguiente';
  }

  /** Un error de verdad: se anota por dentro y se dice por fuera, en claro. */
  private fallar(err: unknown) {
    let codigo: Codigo = 'INTERNO';
    let detalle = err instanceof Error ? err.message : String(err);
    let extra: Record<string, unknown> = {};
    if (err instanceof GuiaError) { codigo = err.codigo; detalle = err.detalle; extra = err.extra; }
    else if (err instanceof FaltaPrecondicion) { codigo = 'PRECONDICION'; detalle = err.detalle; }
    else if (err instanceof NoEncontrado) { codigo = 'OBJETIVO_NO_ENCONTRADO'; detalle = this.describir(err.objetivo); }
    else if (err instanceof SinTiempo) { codigo = 'ESTADO_NO_ALCANZADO'; }
    this.anotar({
      codigo, motivo: detalle,
      paso: (extra['paso'] as string) ?? this.paso()?.id ?? null,
      objetivo: (extra['objetivo'] as string) ?? null,
      esperado: (extra['esperado'] as string) ?? null,
      actual: (extra['actual'] as string) ?? null,
      ms: (extra['ms'] as number) ?? null,
    });
    this.foco.apagar();
    this.objetivo.set(null);
    this.estado.set('error');
    this.aviso.set('Puedes intentarlo otra vez desde Wybix Guide.');
    void this.voz.decir(FRASE_DE_ERROR[codigo]);
  }

  private cerrar(e: Escenario) {
    this.foco.apagar();
    this.objetivo.set(null);
    this.fase.set('cierre');
    this.estado.set('success');
    const ultimo = this.pasos()[this.pasos().length - 1];
    /* Si el ultimo paso ya dijo la despedida, no se repite. */
    const despedida = e.modo === 'demo'
      ? 'Fin de la demostración. ¿Otra vuelta?'
      : 'Listo. Ya conoces lo esencial. Aquí me encuentras cuando quieras.';
    if (!ultimo || !/^Listo\.|^Fin de/.test(ultimo.mensaje)) void this.voz.decir(despedida);
    this.progreso.completar(e.id);
  }

  /** «Terminar» en el cierre. */
  terminar() {
    const e = this.escenario();
    if (e && this.fase() === 'cierre') this.progreso.completar(e.id, this.sinAutoAlCerrar);
    this.detener();
  }

  detener(borrarVoz = true) {
    this.general?.abort();
    this.general = null;
    this.delPaso?.abort();
    this.delPaso = null;
    this.resolverPausa?.();
    this.resolverPausa = null;
    this.foco.apagar();
    if (borrarVoz) this.voz.callar(); else this.voz.cancelar();
    this.objetivo.set(null);
    this.pausado.set(false);
    this.esperando.set(null);
    this.perdido.set(false);
    this.aviso.set(null);
    this.fase.set('oculta');
    this.estado.set('idle');
  }

  // ============================================================= controles
  /** Tocar el texto: si esta escribiendo, se completa; si no, avanza (si el paso lo permite). */
  tocarTexto() {
    if (this.voz.completar()) return;
    if (this.fase() === 'recorrido' && this.esperando()?.tipo === 'boton') this.continuar();
  }

  continuar() {
    if (this.voz.completar()) return;
    this.resolverBoton?.('boton');
  }

  siguiente() {
    this.salidaPedida = 'siguiente';
    if (this.resolverBoton) { this.resolverBoton('saltar'); return; }
    this.delPaso?.abort();
  }

  anterior() {
    if (this.indice() === 0) return;
    this.salidaPedida = 'anterior';
    if (this.resolverBoton) { this.resolverBoton('saltar'); return; }
    this.delPaso?.abort();
  }

  pausar(motivo?: string) {
    if (this.fase() !== 'recorrido' || this.pausado()) return;
    this.pausado.set(true);
    this.voz.pausar();
    if (motivo) this.aviso.set(motivo);
    this.estado.set('idle');
    /* En una demo, pausar CORTA el paso: ninguna accion sigue por detras
       mientras la persona trabaja. Al continuar se reevalua el mundo. */
    if (this.esDemo() && this.delPaso && !this.perdido()) {
      this.salidaPedida = 'reevaluar';
      this.delPaso.abort();
      this.foco.apagar();
    }
  }

  reanudar() {
    if (!this.pausado()) return;
    this.pausado.set(false);
    this.aviso.set(null);
    this.voz.reanudar();
    this.resolverPausa?.();
    this.resolverPausa = null;
  }

  private tocaronFuera() {
    if (this.fase() !== 'recorrido') return;
    if (this.esDemo()) { this.pausar('Tomaste el control. Continúa cuando quieras.'); return; }
    /* En la guia no se castiga: Wybix llama la atencion un momento. */
    if (this.esperando() && this.esperando()!.tipo !== 'boton') {
      this.estado.set('attention');
      setTimeout(() => { if (this.estado() === 'attention') this.estado.set('waiting'); }, 900);
    }
  }

  // ============================================================= esperas
  private boton(s: AbortSignal): Promise<'boton' | 'saltar'> {
    return new Promise((resolve, reject) => {
      const fuera = () => { this.resolverBoton = null; reject(new Cancelado()); };
      if (s.aborted) { fuera(); return; }
      s.addEventListener('abort', fuera, { once: true });
      this.resolverBoton = (v) => { s.removeEventListener('abort', fuera); this.resolverBoton = null; resolve(v); };
    });
  }

  private sinPausa(s: AbortSignal): Promise<void> {
    if (!this.pausado()) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const fuera = () => reject(new Cancelado());
      if (s.aborted) { fuera(); return; }
      s.addEventListener('abort', fuera, { once: true });
      this.resolverPausa = () => { s.removeEventListener('abort', fuera); resolve(); };
    });
  }

  private esperar(ms: number, s: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
      if (s.aborted) { reject(new Cancelado()); return; }
      const t = setTimeout(() => { s.removeEventListener('abort', fuera); resolve(); }, ms);
      const fuera = () => { clearTimeout(t); reject(new Cancelado()); };
      s.addEventListener('abort', fuera, { once: true });
    });
  }

  private async hablar(frase: string, s: AbortSignal) {
    const fuera = () => this.voz.cancelar();
    s.addEventListener('abort', fuera, { once: true });
    try {
      await this.voz.decir(frase);
    } finally {
      s.removeEventListener('abort', fuera);
    }
    if (s.aborted) throw new Cancelado();
    await this.sinPausa(s);
  }

  /** `{nombre}` es quien entro; `{activo}` / `{Activos}`, como llama el giro a lo que atiende. */
  private formato(m: string, ctx: ContextoGuia): string {
    const singular = this.giro.activoSingular || 'activo';
    const plural = this.giro.activoPlural || 'Activos';
    return m.replace('{nombre}', ctx.nombre || '')
      .replace('{activo}', singular.toLowerCase())
      .replace('{Activos}', plural.charAt(0).toUpperCase() + plural.slice(1));
  }

  /** El giro de Servicios, leido antes de filtrar. */
  async preparar(): Promise<void> {
    if (this.caps.servicios) await this.giro.cargar();
  }

  // ===================================================== el negocio (hechos)
  private async verdad(nombre: string): Promise<boolean> {
    const f = hechoDeNegocio(nombre);
    if (!f) throw new GuiaError('INTERNO', `hecho desconocido ${nombre}`);
    try { return await f(this.servicios); } catch { return false; }
  }

  /** ¿Se cumple esta condicion AHORA? Sin esperar. */
  private async evaluar(c: Espera): Promise<boolean> {
    switch (c.tipo) {
      case 'hecho': return this.verdad(c.nombre);
      case 'aparece': return !!this.buscar(this.resolver(c.objetivo));
      case 'desaparece': return !this.buscar(this.resolver(c.objetivo));
      case 'ruta': return this.router.url.startsWith(c.prefijo);
      default: return false;
    }
  }

  // ===================================================== el DOM, por contrato
  /** `{mem.x}` en una clave o estado se resuelve con la memoria de la vuelta. */
  private resolver(o: Objetivo): Objetivo {
    const r = (v?: string) => v?.replace(/\{mem\.([a-zA-Z0-9_]+)\}/g, (_m, k) => String(this.mem[k] ?? ''));
    return { guia: o.guia, clave: r(o.clave), estado: r(o.estado) };
  }

  private describir(o: Objetivo): string {
    return o.guia + (o.clave ? `[${o.clave}]` : '') + (o.estado ? `{${o.estado}}` : '');
  }

  private describirEspera(e: Espera): string {
    switch (e.tipo) {
      case 'aparece': return `aparece ${this.describir(this.resolver(e.objetivo))}`;
      case 'desaparece': return `desaparece ${this.describir(this.resolver(e.objetivo))}`;
      case 'hecho': return `hecho ${e.nombre}`;
      case 'ruta': return `ruta ${e.prefijo}`;
      default: return e.tipo;
    }
  }

  private selector(o: Objetivo): string {
    let sel = `[data-guide="${CSS.escape(o.guia)}"]`;
    if (o.clave) sel += `[data-guide-clave="${CSS.escape(o.clave)}"]`;
    if (o.estado) sel += `[data-guide-estado="${CSS.escape(o.estado)}"]`;
    return sel;
  }

  /**
   * Lo que una persona tocaria en ese punto, si NO es el objetivo. Un
   * `click()` del DOM atraviesa cualquier panel; una persona no. Pulsar a
   * traves de una hoja abierta escondia justo lo que la demo debe ensenar
   * bien (la hoja de «Abrir turno» que se quedaba encima de la caja).
   * Las capas de la propia guia no cuentan.
   */
  private tapadoPor(el: Element): Element | null {
    const r = el.getBoundingClientRect();
    const x = r.left + r.width / 2;
    const y = r.top + Math.min(r.height / 2, 20);
    if (x < 0 || y < 0 || x >= innerWidth || y >= innerHeight) return null;
    for (const h of document.elementsFromPoint(x, y)) {
      if (h.closest('wx-guide-layer, wx-guide-speaker, .driver-overlay, .driver-popover')) continue;
      return h === el || el.contains(h) || h.contains(el) ? null : h;
    }
    return null;
  }

  /** Espera un momento a que se quite lo que tapa el objetivo (una animacion
      que termina, un aviso que se va); si no se quita, la accion no se hace. */
  private async alcanzable(el: Element, guia: string, s: AbortSignal): Promise<void> {
    if (!this.tapadoPor(el)) return;
    try {
      await this.observar(() => !this.tapadoPor(el), s, LIMITE_OPCIONAL * 2);
    } catch (err) {
      if (!(err instanceof SinTiempo)) throw err;
      const t = this.tapadoPor(el);
      const quien = t ? `${t.tagName.toLowerCase()}${t.className && typeof t.className === 'string' ? '.' + t.className.trim().split(/\s+/).join('.') : ''}` : '?';
      throw new GuiaError('ACCION_FALLIDA', `${guia} está tapado por ${quien}`, { objetivo: guia, actual: `tapado por ${quien}` });
    }
  }

  private visible(el: Element): boolean {
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return false;
    const cs = getComputedStyle(el);
    return cs.visibility !== 'hidden' && cs.display !== 'none' && (el as HTMLElement).offsetParent !== null
      || cs.position === 'fixed';
  }

  buscar(o: Objetivo): Element | null {
    return Array.from(document.querySelectorAll(this.selector(o))).find(el => this.visible(el)) ?? null;
  }

  /** Espera a que el objetivo exista y se vea. Observa el DOM; el limite solo detecta que no llego. */
  private esperarElemento(o: Objetivo, s: AbortSignal, limite: number): Promise<Element> {
    const r = this.resolver(o);
    return this.observar(() => this.buscar(r), s, limite).catch((err) => {
      if (err instanceof Cancelado) throw err;
      throw new NoEncontrado(r);
    }) as Promise<Element>;
  }

  /**
   * Un reloj que solo corre mientras la demo corre. Tomar el control no gasta
   * el tiempo de un paso: antes, una pausa de 15 segundos agotaba la espera y
   * al continuar el paso ya habia fallado.
   */
  private reloj(limite: number, alAgotar: () => void): () => void {
    if (limite <= 0) return () => {};
    let usado = 0;
    let previo = performance.now();
    const t = setInterval(() => {
      const ahora = performance.now();
      if (!this.pausado()) usado += ahora - previo;
      previo = ahora;
      if (usado >= limite) { clearInterval(t); alAgotar(); }
    }, 200);
    return () => clearInterval(t);
  }

  private observar<T>(prueba: () => T | null | false, s: AbortSignal, limite: number): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const ya = prueba();
      if (ya) { resolve(ya as T); return; }
      let marco = 0;
      /*
       * FUERA DE LA ZONA DE ANGULAR. Un observador creado dentro de la zona
       * dispara la deteccion de cambios de TODA la aplicacion en cada
       * mutacion; si alguna plantilla muta el DOM al detectar, se cierra un
       * bucle de microtareas que congela la ventana. Se observa fuera y solo
       * se vuelve a entrar para dar la respuesta.
       */
      const obs = this.zone.runOutsideAngular(() => new MutationObserver(() => {
        if (marco) return;
        /* Se vuelve a mirar en el siguiente fotograma: la mutacion llega antes
           que el estilo, y un elemento recien creado aun no mide nada. */
        marco = requestAnimationFrame(() => {
          marco = 0;
          const v = prueba();
          if (v) { fin(); this.zone.run(() => resolve(v as T)); }
        });
      }));
      const parar = this.zone.runOutsideAngular(() => this.reloj(limite, () => { fin(); this.zone.run(() => reject(new SinTiempo())); }));
      const fin = () => {
        obs.disconnect();
        parar();
        if (marco) cancelAnimationFrame(marco);
        s.removeEventListener('abort', fuera);
      };
      const fuera = () => { fin(); reject(new Cancelado()); };
      this.zone.runOutsideAngular(() => obs.observe(document.body,
        { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'style', 'hidden', 'data-guide-estado'] }));
      s.addEventListener('abort', fuera, { once: true });
    });
  }

  /** Un hecho del negocio, preguntado cada poco hasta que es verdad (o se agota el tiempo). */
  private esperarHecho(nombre: string, s: AbortSignal, limite: number): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      let vivo = true;
      const fin = () => { vivo = false; parar(); s.removeEventListener('abort', fuera); };
      const fuera = () => { fin(); reject(new Cancelado()); };
      const parar = this.reloj(limite, () => { fin(); reject(new SinTiempo()); });
      s.addEventListener('abort', fuera, { once: true });
      const mirar = async () => {
        if (!vivo) return;
        if (!this.pausado() && await this.verdad(nombre)) { if (vivo) { fin(); resolve(); } return; }
        if (vivo) setTimeout(() => void mirar(), CADA_HECHO_MS);
      };
      void mirar();
    });
  }

  /** Que se cumpla lo que el paso espera. */
  private async cumplir(e: Espera, el: Element | null, s: AbortSignal, limite: number): Promise<void> {
    switch (e.tipo) {
      case 'boton': await this.boton(s); return;
      case 'hecho': await this.esperarHecho(e.nombre, s, limite); return;
      case 'aparece': await this.esperarElemento(e.objetivo, s, limite); return;
      case 'desaparece': {
        const o = this.resolver(e.objetivo);
        await this.observar(() => !this.buscar(o), s, limite);
        return;
      }
      case 'ruta': await this.observar(() => this.router.url.startsWith(e.prefijo), s, limite); return;
      case 'pulsa': {
        const blanco = e.objetivo ? await this.esperarElemento(e.objetivo, s, LIMITE_OBJETIVO) : el;
        if (!blanco) return;
        await new Promise<void>((resolve, reject) => {
          const alPulsar = () => { quitar(); setTimeout(resolve, 0); };
          const fuera = () => { quitar(); reject(new Cancelado()); };
          const quitar = () => { blanco.removeEventListener('click', alPulsar, true); s.removeEventListener('abort', fuera); };
          blanco.addEventListener('click', alPulsar, true);
          s.addEventListener('abort', fuera, { once: true });
        });
        return;
      }
      case 'valor': {
        const campo = (e.objetivo ? await this.esperarElemento(e.objetivo, s, LIMITE_OBJETIVO) : el) as HTMLInputElement | null;
        if (!campo) return;
        /* Se da por escrito cuando hay algo y la persona deja de teclear un
           momento (o sale del campo): no se salta a mitad de palabra. */
        await new Promise<void>((resolve, reject) => {
          let t: any = null;
          const listo = () => { quitar(); resolve(); };
          const alEscribir = () => { clearTimeout(t); if (String(campo.value ?? '').trim()) t = setTimeout(listo, 900); };
          const alSalir = () => { if (String(campo.value ?? '').trim()) listo(); };
          const fuera = () => { quitar(); reject(new Cancelado()); };
          const quitar = () => {
            clearTimeout(t);
            campo.removeEventListener('input', alEscribir);
            campo.removeEventListener('blur', alSalir);
            s.removeEventListener('abort', fuera);
          };
          campo.addEventListener('input', alEscribir);
          campo.addEventListener('blur', alSalir);
          s.addEventListener('abort', fuera, { once: true });
          alEscribir();
        });
        return;
      }
    }
  }

  // ============================================================= actuar (demo)
  private async autorizar(paso: Paso) {
    const r = await (window as any).wybix?.guide?.autorizar?.({ paso: paso.id });
    if (!r?.success) {
      const motivo = r?.error || 'Esta no es una demostración segura.';
      this.detener(false);
      this.rechazar(motivo);
      throw new Cancelado();
    }
  }

  /** El objetivo de una accion; si no aparece, es un error con nombre, no «limite». */
  private async objetivoDeAccion(o: Objetivo, s: AbortSignal): Promise<HTMLElement> {
    try {
      return await this.esperarElemento(o, s, LIMITE_OBJETIVO) as HTMLElement;
    } catch (err) {
      if (err instanceof NoEncontrado) {
        throw new GuiaError('OBJETIVO_NO_ENCONTRADO', `no aparecio ${this.describir(this.resolver(o))} para actuar`,
          { objetivo: this.describir(this.resolver(o)) });
      }
      throw err;
    }
  }

  private async actuar(a: NonNullable<Paso['acciones']>[number], p: Paso, s: AbortSignal) {
    switch (a.tipo) {
      case 'pausa': await this.esperar(a.ms, s); return;
      case 'navegar':
        this.foco.apagar();
        await this.router.navigateByUrl(a.ruta);
        return;
      case 'dominio': {
        await this.autorizar(p);
        const f = preparacion(a.nombre);
        if (!f) throw new GuiaError('INTERNO', `accion de dominio desconocida ${a.nombre}`);
        this.estado.set('thinking');
        try { await f(this.servicios); } catch (err) {
          throw new GuiaError('PRECONDICION', err instanceof Error ? err.message : String(err));
        }
        return;
      }
      case 'pulsar': {
        await this.autorizar(p);
        const el = await this.objetivoDeAccion(a.objetivo, s);
        await this.foco.resaltar(el);
        await this.esperar(260, s);
        await this.sinPausa(s);
        if (s.aborted) throw new Cancelado();
        await this.alcanzable(el, a.objetivo.guia, s);
        el.click();
        return;
      }
      case 'escribir': {
        await this.autorizar(p);
        const el = await this.objetivoDeAccion(a.objetivo, s) as unknown as HTMLInputElement;
        await this.foco.resaltar(el);
        await this.sinPausa(s);
        el.focus();
        await this.teclear(el, a.texto.replace('{sello}', this.sello), s);
        return;
      }
      case 'elegir': {
        await this.autorizar(p);
        const host = await this.objetivoDeAccion(a.objetivo, s);
        await this.foco.resaltar(host);
        const abrir = host.querySelector('[data-guide-parte="abrir"]') as HTMLElement | null;
        if (!abrir) throw new GuiaError('ACCION_FALLIDA', `${a.objetivo.guia} no se puede abrir`);
        await this.sinPausa(s);
        await this.alcanzable(abrir, a.objetivo.guia, s);
        abrir.click();
        const valor = a.valor?.replace(/\{mem\.([a-zA-Z0-9_]+)\}/g, (_m, k) => String(this.mem[k] ?? ''));
        /* Las opciones de ESTE control, por su VALOR (el id), nunca por su
           texto. Buscarlas en todo el documento encontraba las del control
           anterior mientras su panel terminaba de cerrarse. */
        const buscarOpcion = () => {
          const ops = Array.from(host.querySelectorAll<HTMLElement>('[data-guide-opcion]')).filter(o => this.visible(o));
          if (!ops.length) return null;
          if (valor) return ops.find(o => o.getAttribute('data-guide-valor') === valor) ?? null;
          return ops[0] ?? null;
        };
        try {
          await this.observar(buscarOpcion, s, LIMITE_OBJETIVO);
        } catch (err) {
          if (err instanceof SinTiempo) {
            throw new GuiaError('PRECONDICION', `${a.objetivo.guia} no tiene la opcion ${valor ?? '(primera)'}`,
              { objetivo: a.objetivo.guia, esperado: valor ?? 'una opcion', actual: 'sin opciones' });
          }
          throw err;
        }
        await this.esperar(320, s);
        await this.sinPausa(s);
        /* Se vuelve a buscar JUSTO antes de pulsar: al abrirse, la lista se
           vuelve a pintar y la opcion encontrada antes ya no esta en la pagina. */
        const opcion = buscarOpcion();
        if (!opcion) throw new GuiaError('ACCION_FALLIDA', `${a.objetivo.guia} perdio la opcion`);
        opcion.click();
        return;
      }
    }
  }

  /** Escribe como una persona: letra a letra, con el evento `input` de verdad. */
  private async teclear(el: HTMLInputElement, texto: string, s: AbortSignal) {
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const poner = (v: string) => {
      Object.getOwnPropertyDescriptor(proto, 'value')?.set?.call(el, v);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    };
    poner('');
    const calma = (() => { try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; } })();
    if (calma) { poner(texto); el.dispatchEvent(new Event('change', { bubbles: true })); return; }
    for (let i = 1; i <= texto.length; i++) {
      await this.sinPausa(s);
      poner(texto.slice(0, i));
      await this.esperar(texto[i - 1] === ' ' ? 40 : 55 + ((i * 5) % 30), s);
    }
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  // ============================================================ diagnostico
  private anotar(d: Partial<Diagnostico> & { codigo: string; motivo: string }) {
    const e: Diagnostico = {
      t: new Date().toISOString(),
      escenario: this.escenario()?.id ?? null,
      paso: d.paso ?? this.paso()?.id ?? null,
      ruta: this.router.url,
      objetivo: d.objetivo ?? null,
      esperado: d.esperado ?? null,
      actual: d.actual ?? null,
      ms: d.ms ?? null,
      codigo: d.codigo,
      motivo: d.motivo,
    };
    this.registro.push(e);
    if (this.registro.length > 60) this.registro.shift();
    if (!/^(YA_HECHO|REANUDA|PREPARADA|RECUPERA)$/.test(d.codigo)) console.warn('[GUIDE]', e);
  }

  /** Solo lectura: lo ultimo que anoto el motor. */
  diagnostico(): Diagnostico[] {
    return this.registro.slice();
  }

  /** La primera navegacion terminada: el saludo espera a que haya pantalla. */
  cuandoNavegue(): Promise<unknown> {
    return firstValueFrom(this.router.events.pipe(filter(e => e instanceof NavigationEnd), take(1)));
  }
}
