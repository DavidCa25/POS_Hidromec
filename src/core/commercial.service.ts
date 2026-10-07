import { RegisterService } from '../services/register.service';
import { Injectable, inject, effect, signal } from '@angular/core';
import { CartService, Cart } from './cart.service';
import { ElectronBridge } from './electron-bridge.service';
import type { PoliticaComercial } from '../../shared/comercial';
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
    private register = inject(RegisterService);
    private bridge = inject(ElectronBridge);
    private carts = inject(CartService);
    private timers = new Map<number, ReturnType<typeof setTimeout>>();
    private requests = new Map<number, number>();
    constructor() { effect(() => { this.carts.version(); const cart = this.carts.activeCart(); const data = this.data(); if (data)
        this.schedule(cart); }); void this.load(); }
    get policy(): PoliticaComercial | undefined { return this.data()?.policy; }
    async load() { try {
        const r = await this.bridge.api?.commercialCatalog?.();
        if (r?.success) {
            this.data.set(r.data);
            this.error.set('');
        }
        else
            this.error.set(r?.error ?? 'No se pudo cargar la configuración comercial.');
    }
    catch {
        this.error.set('No se pudo cargar la configuración comercial.');
    } }
    private payload(cart: Cart) { return { version: this.policy?.version, coupon: cart.coupon?.code, orderReference: cart.commercial?.orderReference, channel: cart.commercial?.channel ?? 'LOCAL', audiences: cart.commercial?.audiences ?? [], lines: cart.lines.map(l => ({ key: String(l.lineId), productId: l.productId, qty: l.qty, note: l.note, options: l.options, combo: l.combo })), registerId: null }; }
    signature(cart: Cart) { return JSON.stringify(this.payload(cart)); }
    catalogPrice(id: number, base: number): number | null { const channel = this.carts.activeCart().commercial?.channel ?? 'LOCAL', product = this.data()?.ids.find((x: any) => x.id === id)?.uuid, policy = this.policy; if (!policy)
        return base; const c = policy.channels.find(c => c.id === channel && c.active), price = policy.prices.find(x => x.channel === channel && x.product === product && !x.variant); return price ? Number(price.price) : c?.inheritBase ? base : null; }
    enabled(cart: Cart) { return !cart.transient && !cart.meta?.['ordenServicio'] && !!this.policy && ((cart.commercial?.channel ?? 'LOCAL') !== 'LOCAL' || this.policy.prices.some(x => x.channel === 'LOCAL') || this.policy.promotions.some(x => x.active) || cart.lines.some(l => l.combo) || !!cart.coupon); }
    private schedule(cart: Cart) { if (!this.enabled(cart) || !cart.lines.length) {
        if (cart.commercial?.quote) {
            cart.commercial.quote = undefined;
            this.carts.notify();
        }
        return;
    } const sig = this.signature(cart); if (cart.commercial?.signature === sig || (cart.commercial?.pending && cart.commercial.requestedSignature === sig))
        return; clearTimeout(this.timers.get(cart.id)); cart.commercial ??= { channel: 'LOCAL', audiences: [] }; cart.commercial.pending = true; cart.commercial.requestedSignature = sig; this.carts.notify(); this.timers.set(cart.id, setTimeout(() => { void this.prepare(cart).catch(() => { }); }, 180)); }
    async prepare(cart: Cart, force = false): Promise<Cotizacion | null> {
        clearTimeout(this.timers.get(cart.id));
        if (force || !this.data())
            await this.load();
        if (!this.data())
            throw Error(this.error() || 'No se pudo comprobar la configuración comercial.');
        if (force && this.error())
            throw Error(this.error());
        if (!this.enabled(cart) || !cart.lines.length) {
            if (cart.commercial) {
                cart.commercial.quote = undefined;
                cart.commercial.pending = false;
            }
            return null;
        }
        const state = cart.commercial ??= { channel: 'LOCAL', audiences: [] }, sig = this.signature(cart);
        if (!force && state.signature === sig && state.quote)
            return state.quote;
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
