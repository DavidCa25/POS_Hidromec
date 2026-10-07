import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { CommercialService } from '../../core/commercial.service';
import { cotizar, validarPolitica, PoliticaComercial, Promocion, Combo, Selector, PartidaComercial, CuentaComercial } from '../../../shared/comercial';
@Component({ selector: 'app-commercial-panel', standalone: true, imports: [CommonModule, FormsModule], templateUrl: './commercial-panel.component.html', styles: [`:host{display:block;color:var(--wx-text)}.cp-head{display:flex;justify-content:space-between;gap:12px;align-items:center}.cp-tabs{display:flex;gap:8px;margin:18px 0;flex-wrap:wrap}.cp-tabs button{border-radius:20px;padding:9px 16px;border:1px solid var(--wx-edge);background:var(--wx-surface)}.cp-tabs button.on{background:#0f1826;color:white}.cp-row{display:grid;grid-template-columns:repeat(auto-fit,minmax(145px,1fr));gap:12px;margin:12px 0;align-items:end}.cp-card{padding:18px;border:1px solid var(--wx-edge);border-radius:18px;margin:14px 0;background:var(--wx-surface)}label{display:grid;gap:6px;font-size:13px}.cp-small{font-size:13px;color:var(--wx-text-muted)}select[multiple]{min-height:110px}.cp-error{color:var(--wx-red-600)}button{min-height:38px}input[type=checkbox]{width:18px;height:18px}h3{font-size:18px}h4{font-size:15px}`] })
export class CommercialPanelComponent {
    service = inject(CommercialService);
    policy: PoliticaComercial | null = null;
    tab = 'channels';
    message = '';
    busy = false;
    products: any[] = [];
    previewLines: PartidaComercial[] = [];
    previewResult: CuentaComercial | null = null;
    previewChannel = 'LOCAL';
    previewDate = new Date().toLocaleDateString('sv-SE');
    previewTime = '09:00';
    previewError = '';
    previewAudience = '';
    get categories() { return this.service.data()?.catalog.categories ?? []; }
    variants(product?: string) { const d = this.service.data(), p = d?.catalog.products.find((x: any) => x.uuid === product); return d?.catalog.modifier_groups.filter((g: any) => g.role === 'SIZE' && (!p || p.modifier_groups?.includes(g.uuid))).flatMap((g: any) => g.options.filter((o: any) => o.active)) ?? []; }
    previewAdd() { if (this.products.length)
        this.previewLines.push({ key: crypto.randomUUID(), product: this.products[0].uuid, quantity: '1', extras: '0' }); }
    preview() { try {
        this.previewResult = cotizar(this.policy!, this.products.map(p => ({ id: p.uuid, price: p.price, category: p.category_uuid })), this.previewLines, { channel: this.previewChannel, date: this.previewDate, time: this.previewTime, weekday: new Date(this.previewDate + 'T12:00:00Z').getUTCDay(), audiences: this.previewAudience ? [this.previewAudience] : [] });
        this.previewError = '';
    }
    catch (e) {
        this.previewResult = null;
        this.previewError = (e as Error).message;
    } }
    async ngOnInit() { await this.service.load(); const d = this.service.data(); if (d) {
        this.policy = structuredClone(d.policy);
        this.products = d.catalog.products.filter((x: any) => x.sellable && x.active);
    }
    else
        this.message = this.service.error(); }
    id() { return 'r_' + crypto.randomUUID().replaceAll('-', ''); }
    channel() { this.policy!.channels.push({ id: this.id(), name: 'Nuevo canal', active: true, inheritBase: false }); }
    price() { if (!this.products.length)
        return; this.policy!.prices.push({ channel: this.policy!.channels[0].id, product: this.products[0].uuid, price: Number(this.products[0].price).toFixed(2) }); }
    promo() { this.policy!.promotions.push({ id: this.id(), name: 'Nueva promoción', active: false, priority: 10, kind: 'PRICE', selector: { products: [] }, value: '0.00', channels: ['LOCAL'], weekdays: [], windows: [] }); }
    combo() { this.policy!.combos.push({ id: this.id(), name: 'Nuevo combo', active: false, price: '0.00', groups: [] }); }
    group(c: Combo) { c.groups.push({ id: this.id(), name: 'Elige un producto', quantity: 1, selector: { products: [] } }); }
    changeKind(p: Promocion) { if (p.kind === 'BUY_PAY') {
        p.buy = 2;
        p.pay = 1;
    } if (p.kind === 'ADDON') {
        p.trigger = { products: [] };
        p.triggerQty = 2;
    } }
    day(p: Promocion, d: number, on: boolean) { p.weekdays = on ? [...(p.weekdays ?? []), d] : (p.weekdays ?? []).filter(x => x !== d); }
    window(p: Promocion) { (p.windows ??= []).push({ from: '07:30', to: '10:00' }); }
    async save() { if (!this.policy || this.busy)
        return; this.busy = true; this.message = ''; try {
        for (const p of this.policy.promotions)
            if (!p.selector.products?.length && !p.selector.categories?.length)
                throw Error('Selecciona productos para cada promoción.');
        for (const c of this.policy.combos)
            for (const g of c.groups)
                if (!g.selector.products?.length && !g.selector.categories?.length)
                    throw Error('Selecciona productos para cada grupo del combo.');
        validarPolitica(this.policy);
        const r = await (window as any).electronAPI.commercialSave({ version: this.policy.version, policy: this.policy });
        if (!r.success)
            throw Error(r.error);
        this.policy = r.data;
        await this.service.load();
        this.message = 'Configuración publicada. Las cuentas se recalculan antes de cobrar.';
    }
    catch (e) {
        this.message = (e as Error).message;
    }
    finally {
        this.busy = false;
    } }
}
