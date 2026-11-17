import { Injectable, NgZone, computed, inject, signal } from '@angular/core';
import type { Mensaje, Plan } from '../../shared/asistente';
import { CartService } from './cart.service';
import { VozRespuestaService } from './voz-respuesta.service';
import { CatalogService } from './catalog.service';
import { SaleService } from './sale.service';
import { CommercialService } from './commercial.service';
import type { CartLine } from './cart.service';
import type { PaymentMethod } from './models';

/*
 * WYBIX, ASISTENTE OPERATIVO — lo que necesita la pantalla.
 * Contratos en shared/asistente.ts; reglas y respuestas en electron/asistente.
 *
 * La pantalla hace UNA cosa que el proceso principal no hace: ejecutar un
 * plan confirmado con la API de siempre (window.electronAPI / window.wybix).
 * Así un cambio de precio pide el PIN del encargado igual que si se hiciera
 * desde Inventario: el preload repite la operación con la autorización.
 */

export interface Resumen {
  pendientes: number; total: number; negocio: number;
  masUrgente: { id: number; titulo: string; severidad: string } | null;
  sistema: { ok: boolean; problemas: number }; evaluadoEn: string | null;
}
export interface Entendido {
  intent: string; etiqueta: string; puntaje: number; falta: string | null;
  datos: { clave: string; texto: string; dudoso: boolean }[];
}
export type MensajeChat = Mensaje & { esperando?: unknown; intent?: string; planEstado?: 'listo' | 'ejecutando' | 'hecho' | 'fallido' | 'cancelado' };

@Injectable({ providedIn: 'root' })
export class AsistenteService {
  private readonly zona = inject(NgZone);
  private readonly cart = inject(CartService);
  private readonly catalogo = inject(CatalogService);
  private readonly voz = inject(VozRespuestaService);
  private readonly venta = inject(SaleService);
  private readonly comercial = inject(CommercialService);
  private get api() { return (window as any).electronAPI; }

  readonly mensajes = signal<MensajeChat[]>([]);
  readonly resumen = signal<Resumen | null>(null);
  readonly enviando = signal(false);
  readonly entendido = signal<Entendido | null>(null);
  readonly pendientes = computed(() => this.resumen()?.pendientes ?? 0);
  readonly hayUrgente = computed(() => ['critico', 'importante'].includes(this.resumen()?.masUrgente?.severidad ?? ''));
  /** La cara de Wybix en el chat: la del último mensaje suyo. */
  readonly cara = computed<'idle' | 'atencion' | 'exito' | 'error'>(() => {
    const m = [...this.mensajes()].reverse().find((x) => x.autor === 'wybix');
    return m?.tono === 'atencion' ? 'atencion' : m?.tono === 'exito' ? 'exito' : m?.tono === 'error' ? 'error' : 'idle';
  });
  readonly subtitulo = computed(() => {
    const r = this.resumen();
    if (!r) return 'Revisando tu negocio…';
    if (!r.total) return 'Todo en orden';
    return `${r.total} por revisar`;
  });
  private cargado = false;
  private quitarAviso: (() => void) | null = null;

  /** Una vez por ventana: el resumen y el aviso de cambios del proceso principal. */
  iniciar() {
    if (this.quitarAviso || !this.api?.asistenteResumen) return;
    this.quitarAviso = this.api.onAsistenteCambio?.(() => this.zona.run(() => void this.refrescarResumen())) ?? null;
    void this.refrescarResumen();
  }

  async refrescarResumen() {
    try { const r = await this.api?.asistenteResumen?.(); if (r?.success) this.resumen.set(r.data); } catch { /* sin sesión todavía */ }
  }

  /** Al abrir el chat: el historial y, si es la primera vez hoy, el saludo con lo pendiente. */
  async abrir() {
    if (!this.cargado) {
      this.cargado = true;
      try { const r = await this.api?.asistenteHistorial?.(); if (r?.success) this.mensajes.set(r.data || []); } catch { /* noop */ }
    }
    await this.refrescarResumen();
    const ultimo = this.mensajes().at(-1);
    const hoy = new Date().toDateString();
    if (!ultimo || new Date(ultimo.en).toDateString() !== hoy) await this.accion({ intent: 'saludo', etiqueta: 'Hola' }, true);
  }

  async enviar(texto: string) {
    const t = texto.trim();
    if (!t || this.enviando()) return;
    this.entendido.set(null);
    await this.conversar({ texto: t });
  }

  /** Un botón que Wybix ofreció. `silencioso`: no se pinta como mensaje de la persona. */
  async accion(op: { intent?: string; params?: Record<string, unknown>; etiqueta?: string; texto?: string }, silencioso = false) {
    if (op.texto && !op.intent) return this.enviar(op.texto);
    await this.conversar({ accion: { intent: op.intent, params: op.params || {}, etiqueta: op.etiqueta } }, silencioso);
  }

  private async conversar(p: unknown, silencioso = false) {
    this.enviando.set(true);
    try {
      const r = await this.api?.asistenteEnviar?.(p);
      if (r?.success) {
        const nuevos: MensajeChat[] = (r.data || []).map((m: MensajeChat) => (m.plan ? { ...m, planEstado: 'listo' } : m));
        this.mensajes.update((ms) => [...ms, ...(silencioso ? nuevos.filter((m) => m.autor === 'wybix') : nuevos)]);
        /* «Léeme las respuestas»: lo último que dijo Wybix, en voz alta. */
        const leer = nuevos.filter((m) => m.autor === 'wybix' && m.hablar).map((m) => m.texto).join(' ');
        if (leer) this.voz.hablar(leer);
      } else {
        this.mensajes.update((ms) => [...ms, { id: `e${Date.now()}`, autor: 'wybix', texto: r?.error || 'No pude responder. Intenta de nuevo.', en: new Date().toISOString(), tono: 'error' }]);
      }
    } finally { this.enviando.set(false); void this.refrescarResumen(); }
  }

  /** Lo que va entendiendo mientras se escribe (con pausa, para no consultar en cada tecla). */
  private espera: any = null;
  entender(texto: string) {
    clearTimeout(this.espera);
    if (texto.trim().length < 3) { this.entendido.set(null); return; }
    this.espera = setTimeout(async () => {
      try { const r = await this.api?.asistenteEntender?.({ texto }); this.zona.run(() => this.entendido.set(r?.success ? r.data : null)); }
      catch { this.entendido.set(null); }
    }, 250);
  }

  /**
   * Confirmar: la pantalla ejecuta el plan con la API de siempre y le dice al
   * proceso principal cómo terminó (bitácora, entrenamiento, re-evaluar).
   */
  async confirmar(m: MensajeChat) {
    const plan = m.plan as Plan | undefined;
    if (!plan?.ejecutar || m.planEstado !== 'listo') return;
    this.marcar(m.id, 'ejecutando');
    let ok = false, error: string | null = null;
    try {
      const fn = this.resolver(plan.ejecutar.api);
      if (!fn) throw new Error('Esta caja no tiene esa función.');
      const e = plan.ejecutar as { args?: unknown[]; payload?: unknown };
      const r = Array.isArray(e.args) ? await fn(...e.args) : await fn(e.payload);
      ok = r?.success !== false && !r?.error;
      error = ok ? null : (r?.error || r?.message || 'La operación no se completó.');
    } catch (e: any) { ok = false; error = e?.message || 'La operación no se completó.'; }
    this.marcar(m.id, ok ? 'hecho' : 'fallido');
    await this.reportar(plan.id, { ok, error });
  }

  async cancelar(m: MensajeChat) {
    const plan = m.plan as Plan | undefined;
    if (!plan || m.planEstado !== 'listo') return;
    this.marcar(m.id, 'cancelado');
    await this.reportar(plan.id, { cancelado: true });
  }

  private async reportar(planId: string, r: { ok?: boolean; error?: string | null; cancelado?: boolean }) {
    try {
      const x = await this.api?.asistenteResultado?.({ planId, ...r });
      if (x?.success) this.mensajes.update((ms) => [...ms, ...(x.data || [])]);
    } catch { /* el plan queda en borrador y caduca solo */ }
    void this.refrescarResumen();
  }

  private marcar(id: string, estado: MensajeChat['planEstado']) {
    this.mensajes.update((ms) => ms.map((x) => (x.id === id ? { ...x, planEstado: estado } : x)));
  }

  /**
   * «Cóbrale 2 cocas y una sabritas»: deja los productos en la cuenta activa
   * antes de llevar a Venta. Cobrar sigue siendo de la pantalla (forma de
   * pago, ticket, cajón). Un producto con opciones (tamaño, sabor) no se
   * carga a ciegas: se avisa y se agrega a mano.
   */
  async cargarCarrito(lineas: { productId: number; cantidad: number }[]) {
    try { await this.catalogo.load(); } catch { /* sin catálogo no hay nada que cargar */ }
    const omitidos: string[] = [];
    let agregados = 0;
    for (const l of lineas || []) {
      const p = this.catalogo.findById(Number(l.productId));
      if (!p || p.has_modifiers || !(Number(l.cantidad) > 0)) { omitidos.push(p?.product_name || `producto ${l.productId}`); continue; }
      this.cart.addProduct(CatalogService.toLineSource(p), Number(l.cantidad));
      agregados++;
    }
    if (omitidos.length) {
      this.mensajes.update((ms) => [...ms, { id: `c${Date.now()}`, autor: 'wybix', en: new Date().toISOString(), tono: 'atencion',
        texto: `No cargué ${omitidos.join(', ')}: ${omitidos.length === 1 ? 'tiene' : 'tienen'} opciones que se eligen en Venta.` }]);
    }
    return { agregados, omitidos };
  }

  /**
   * Planes que ejecuta la pantalla con sus propios servicios, no una función
   * de preload. Cada uno está declarado en electron/asistente/cobertura.js
   * (PANTALLA) con el canal que termina invocando.
   */
  private readonly pantalla: Record<string, (p: any) => Promise<any>> = {
    cobrar: (p) => this.cobrar(p),
  };

  /**
   * «Cóbrale 2 cocas en efectivo», confirmado: la MISMA venta que el botón
   * Cobrar (SaleService.checkout: turno, cotización, ticket, cajón, premios y
   * cupones), en una cuenta aparte para no tocar la que la caja tiene abierta.
   * Si con las ofertas el total ya no es el de la tarjeta, no cobra.
   */
  async cobrar(p: { lineas: { productId: number; cantidad: number }[]; metodo: PaymentMethod; recibido?: number | null; total: number }) {
    /* Recién leído: precio y existencia de ahora, y productos dados de alta
       después de abrir Venta (la tarjeta los cotizó con la base). */
    try { await this.catalogo.load(true); } catch { /* se valida abajo */ }
    const lineas: CartLine[] = [];
    for (const l of p?.lineas || []) {
      const x = this.catalogo.findById(Number(l.productId));
      if (!x) return { success: false, error: 'Uno de los productos ya no está en el catálogo.' };
      if (x.has_modifiers) return { success: false, error: `${x.product_name} lleva opciones: cóbralo en Venta.` };
      lineas.push(this.cart.makeLine(CatalogService.toLineSource(x), Number(l.cantidad)));
    }
    if (!lineas.length) return { success: false, error: 'La cuenta está vacía.' };
    const antes = this.cart.activeCart().id;
    const cuenta = this.cart.createCart();
    if (!cuenta) return { success: false, error: 'Hay demasiadas cuentas abiertas en Venta: cierra una y vuelve a intentarlo.' };
    cuenta.lines = lineas;
    this.cart.notify();
    const soltar = () => { this.cart.closeCart(cuenta.id); this.cart.switchTo(antes); };
    try {
      await this.comercial.prepare(cuenta, true);
      const total = CartService.totalsOf(cuenta).total;
      if (Math.abs(total - Number(p.total)) > 0.01) {
        soltar();
        return { success: false, error: `El total cambió a $${total.toFixed(2)} (ofertas o precios). No cobré: pídemelo otra vez.` };
      }
      const efectivo = p.metodo === 'EFECTIVO';
      const r = await this.venta.checkout({ method: p.metodo, received: efectivo ? (p.recibido ?? total) : null },
                                           { openDrawer: efectivo, autoPrint: true });
      if (!r.ok) { soltar(); return { success: false, error: r.error || 'No se pudo registrar la venta.' }; }
      /* checkout ya cerró la cuenta del asistente; se vuelve a la de la caja. */
      this.cart.switchTo(antes);
      return { success: true, saleId: r.saleId, total: r.total, cambio: r.change };
    } catch (e: any) {
      soltar();
      return { success: false, error: e?.message || 'No se pudo registrar la venta.' };
    }
  }

  /** «wybix.produccion.merma» → window.wybix.produccion.merma; «pantalla.cobrar» → this.pantalla.cobrar. */
  private resolver(ruta: string): ((...a: unknown[]) => Promise<any>) | null {
    const [raiz, ...partes] = String(ruta || '').split('.');
    if (raiz === 'pantalla') return partes.length === 1 && Object.hasOwn(this.pantalla, partes[0]) ? this.pantalla[partes[0]] : null;
    if (raiz !== 'electronAPI' && raiz !== 'wybix') return null;
    let obj: any = (window as any)[raiz];
    for (let i = 0; i < partes.length - 1; i++) obj = obj?.[partes[i]];
    const fn = obj?.[partes[partes.length - 1]];
    return typeof fn === 'function' ? fn.bind(obj) : null;
  }
}
