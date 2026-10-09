import { RegisterService } from '../services/register.service';
import { Injectable, inject, effect, signal, DestroyRef } from '@angular/core';
import { CartService, Cart } from './cart.service';
import { ElectronBridge } from './electron-bridge.service';
import { vigente, type PoliticaComercial } from '../../shared/comercial';
export interface Cotizacion {
    id: string;
    registerId: number;
    total: string;
    gross: string;
    discount: string;
    lines: any[];
    channel: string;
    channelName: string;
    version: number;
}
@Injectable({ providedIn: 'root' })
export class CommercialService {
    readonly data = signal<any>(null);
    readonly error = signal('');
    readonly now = signal(Date.now());
    private loadedAt = Date.now();
    private ticker = setInterval(() => { this.now.set(Date.now()); const c = this.carts.activeCart(); if (this.data()) this.schedule(c); }, 1000);
    context() {
      const data = this.data(), stamp = data?.wallTime;
      const date = stamp ? new Date(Date.parse(stamp + 'Z') + this.now() - this.loadedAt) : new Date(this.now());
      return { channel: this.carts.activeCart().commercial?.channel ?? 'LOCAL', date: stamp ? date.toISOString().slice(0,10) : date.toLocaleDateString('sv-SE'), time: stamp ? date.toISOString().slice(11,16) : date.toTimeString().slice(0,5), weekday: stamp ? date.getUTCDay() : date.getDay() };
    }
    get offersNow() { const p = this.policy, ctx = this.context(); return p ? [...p.promotions.filter(r => vigente(r,ctx)), ...p.combos.filter(r => vigente(r,ctx))] : []; }
    volumeHints() {
      this.carts.version(); const cart = this.carts.activeCart(), data = this.data();
      return (this.policy?.promotions ?? []).filter(r => r.kind === 'VOLUME' && vigente(r,this.context())).map(r => {
        const applied = cart.commercial?.quote?.lines.some(l => l.audit?.rule === r.id);
        const groups = new Map<string,number>();
        for (const l of cart.lines.filter(l => !l.combo)) {
          const uuid = data?.ids.find((x:any) => x.id === l.productId)?.uuid;
          const p = data?.catalog.products.find((x:any) => x.uuid === uuid);
          const size = l.options.map(o => data?.optionIds.find((x:any) => x.id === o.optionId)?.uuid).find(id => data?.catalog.modifier_groups.some((g:any) => g.role === 'SIZE' && g.options.some((o:any) => o.uuid === id)));
          if (!p || !((!r.selector.products?.length && !r.selector.categories?.length) || r.selector.products?.includes(uuid) || r.selector.categories?.includes(p.category_uuid)) || (r.selector.variants?.length && !r.selector.variants.includes(size))) continue;
          const quoted = cart.commercial?.quote?.lines.filter(q => q.audit?.source === String(l.lineId));
          const quantity = quoted?.length ? quoted.filter(q => !q.audit?.rule || q.audit.rule === r.id).reduce((a,q) => a+Number(q.qty),0) : l.qty;
          const key = r.mixProducts === false ? JSON.stringify([uuid,size]) : '*'; groups.set(key,(groups.get(key)??0)+quantity);
        }
        const count = Math.max(0,...groups.values()), remaining = Math.max(0,(r.minimumQty??2)-count);
        return { id:r.id, name:r.name, applied, text: applied ? 'Mayoreo aplicado' : remaining ? 'Faltan '+remaining+' piezas para mayoreo' : 'Se comprueba al cotizar; respeta la prioridad de ofertas' };
      });
    }
    private register = inject(RegisterService);
    private bridge = inject(ElectronBridge);
    private carts = inject(CartService);
    private timers = new Map<number, ReturnType<typeof setTimeout>>();
    private requests = new Map<number, number>();
    constructor() { inject(DestroyRef).onDestroy(()=>{clearInterval(this.ticker);for(const t of this.timers.values())clearTimeout(t);}); effect(() => { this.carts.version(); const cart = this.carts.activeCart(); const data = this.data(); if (data)
        this.schedule(cart); }); void this.load(); }
    get policy(): PoliticaComercial | undefined { return this.data()?.policy; }
    async load() { try {
        const r = await this.bridge.api?.commercialCatalog?.();
        if (r?.success) {
            this.loadedAt = Date.now(); this.data.set(r.data);
            this.error.set('');
        }
        else
            this.error.set(r?.error ?? 'No se pudo cargar la configuración comercial.');
    }
    catch {
        this.error.set('No se pudo cargar la configuración comercial.');
    } }
    private payload(cart: Cart) { return { version: this.policy?.version, coupon: cart.coupon?.code, orderReference: cart.commercial?.orderReference, channel: cart.commercial?.channel ?? 'LOCAL', audiences: cart.commercial?.audiences ?? [], lines: cart.lines.map(l => ({ key: String(l.lineId), productId: l.productId, qty: l.qty, note: l.note, options: l.options, combo: l.combo })), registerId: null }; }
    signature(cart: Cart) { return JSON.stringify([this.payload(cart), this.context().date, this.context().time]); }
    catalogPrice(id: number, base: number, variant?: string): number | null {
        this.carts.version();
        const channel = this.carts.activeCart().commercial?.channel ?? 'LOCAL';
        const product = this.data()?.ids.find((x: any) => x.id === id)?.uuid;
        const policy = this.policy;
        if (!policy) return base;
        const c = policy.channels.find(c => c.id === channel && c.active);
        if (!c) return null;
        const price = policy.prices.find(x => x.channel === channel && x.product === product && x.variant === variant)
          ?? policy.prices.find(x => x.channel === channel && x.product === product && !x.variant);
        return price ? Number(price.price) : c.inheritBase ? base : null;
    }
    hasVariantPrices(id: number): boolean {
        this.carts.version();
        const channel = this.carts.activeCart().commercial?.channel ?? 'LOCAL';
        const product = this.data()?.ids.find((x: any) => x.id === id)?.uuid;
        return !!this.policy?.prices.some(x => x.channel === channel && x.product === product && !!x.variant);
    }
    enabled(cart: Cart) { return !cart.transient && !cart.meta?.['ordenServicio'] && !!this.policy && ((cart.commercial?.channel ?? 'LOCAL') !== 'LOCAL' || this.policy.prices.some(x => x.channel === 'LOCAL') || this.policy.promotions.some(x => x.active) || cart.lines.some(l => l.combo) || !!cart.coupon); }
    private schedule(cart: Cart) { if (!this.enabled(cart) || !cart.lines.length) {
        if (cart.commercial?.quote) {
            cart.commercial.quote = undefined;
            this.carts.notify();
        }
        return;
    }
    const sig=this.signature(cart),state=cart.commercial;
    // La comprobación final del cobro usa la misma firma y debe terminar.
    // El refresco de pantalla no puede cancelarla por encontrar la cotización
    // anterior en caché. Una cantidad distinta sí invalida la petición.
    if(state?.pending && state.requestedSignature===sig)return;
    // Si se quita y se repone una pieza antes del debounce, la cotización
    // anterior vuelve a ser válida. Cancelar el cálculo intermedio también
    // debe liberar pending: de lo contrario el carrito queda en precio base.
    if(state?.signature===sig && state.quote){
      clearTimeout(this.timers.get(cart.id));this.timers.delete(cart.id);
      if(state.pending){this.requests.set(cart.id,(this.requests.get(cart.id)??0)+1);state.pending=false;state.requestedSignature=sig;this.carts.notify();}
      return;
    }
    if((state?.signature===sig&&state.error)||(state?.pending&&state.requestedSignature===sig))return;
    clearTimeout(this.timers.get(cart.id)); cart.commercial ??= { channel: 'LOCAL', audiences: [] }; cart.commercial.pending = true; cart.commercial.requestedSignature = sig; this.carts.notify(); this.timers.set(cart.id, setTimeout(() => { void this.prepare(cart).catch(() => { }); }, 180)); }
    async prepare(cart: Cart, force = false): Promise<Cotizacion | null> {
        clearTimeout(this.timers.get(cart.id));
        if (force || !this.data())
            await this.load();
        if (!this.data())
            throw Error(this.error() || 'No se pudo comprobar la configuración comercial.');
        if (force && this.error())
            throw Error(this.error());
        // load() puede disparar el efecto de refresco mientras se espera IPC.
        // Esta petición sustituye también ese debounce recién programado.
        clearTimeout(this.timers.get(cart.id));
        if (!this.enabled(cart) || !cart.lines.length) {
            if (cart.commercial) {
                cart.commercial.quote = undefined;
                cart.commercial.pending = false;
            }
            return null;
        }
        const state = cart.commercial ??= { channel: 'LOCAL', audiences: [] }, sig = this.signature(cart);
        if (!force && state.signature === sig && state.quote) {
            state.pending=false;state.requestedSignature=sig;this.carts.notify();return state.quote;
        }
        const request = (this.requests.get(cart.id) ?? 0) + 1;
        this.requests.set(cart.id, request);
        state.pending = true;
        state.error = '';
        state.requestedSignature = sig;
        try {
            const r = await this.bridge.api.commercialQuote({ ...this.payload(cart), registerId: this.register.registerId });
            if (this.requests.get(cart.id) !== request || cart.commercial !== state || this.signature(cart) !== sig)
                throw Error('Cambió la cuenta mientras se calculaba. Revisa el total.');
            if (!r.success)
                throw Error(r.error);
            state.quote = r.data;
            state.signature = sig;
            if (cart.coupon && r.data.coupon)
                cart.coupon.amountApplied = Number(r.data.coupon.amountApplied);
            return r.data;
        }
        catch (e) {
            if (this.requests.get(cart.id) === request && cart.commercial === state && this.signature(cart) === sig) {
                state.quote = undefined;
                state.signature = sig;
                state.error = (e as Error).message;
            }
            throw e;
        }
        finally {
            if (this.requests.get(cart.id) === request && cart.commercial === state && this.signature(cart) === sig)
                state.pending = false;
            this.carts.notify();
        }
    }
    changeChannel(channel: string) { const c = this.carts.activeCart(); if (c.lines.some(l => l.enviada != null))
        throw Error('La cuenta ya tiene una comanda enviada. Conserva su canal.'); c.commercial = { channel, audiences: [] }; this.carts.notify(); }
}
