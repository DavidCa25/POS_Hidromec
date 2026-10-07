import { AuthService } from '../../services/auth.service';
import { Component, inject, ElementRef, HostListener } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { CommercialService } from '../../core/commercial.service';
import { CartService } from '../../core/cart.service';
@Component({ selector: 'app-commercial-sale', standalone: true, imports: [CommonModule, FormsModule], template: `
<section *ngIf="service.policy as p" class="cs" aria-label="Canal y ofertas de la cuenta">
<p *ngIf="cart.activeCart().meta?.['commercialNotice']" role="status">{{cart.activeCart().meta?.['commercialNotice']}}</p>
<label>Canal <select aria-label="Canal" [ngModel]="cart.activeCart().commercial?.channel??'LOCAL'" (ngModelChange)="change($event)"><option *ngFor="let c of p.channels" [value]="c.id" [disabled]="!c.active">{{c.name}}</option></select></label>
<button *ngIf="p.combos.some(active)" type="button" (click)="showCombo($event)">Agregar combo</button>
<ng-container *ngIf="cart.activeCart().commercial as c"><label *ngIf="c.channel!=='LOCAL'">Folio de plataforma<input aria-label="Folio de plataforma" maxlength="100" [(ngModel)]="c.orderReference" (ngModelChange)="cart.notify()"></label></ng-container>
<label *ngFor="let audience of audiences"><input type="checkbox" [disabled]="!auth.puede('VENTAS_SUPERVISAR')" [ngModel]="cart.activeCart().commercial?.audiences?.includes(audience)" (ngModelChange)="eligible(audience,$event)"> {{audience}}</label>
<span *ngIf="cart.activeCart().commercial?.pending" role="status">Calculando precios…</span><span *ngIf="cart.activeCart().commercial?.quote as q">{{q.channelName}} · Ahorro {{q.discount|currency:'MXN':'symbol-narrow'}}</span>
<p *ngIf="message||cart.activeCart().commercial?.error" role="alert">{{message||cart.activeCart().commercial?.error}}</p>
</section>
<div *ngIf="open" class="cs-modal" role="dialog" aria-modal="true" aria-label="Elegir combo"><div class="cs-panel"><h3>Arma tu combo</h3><label>Combo<select [(ngModel)]="comboId" (ngModelChange)="selections={}"><option value="">Elige un combo</option><option *ngFor="let c of service.policy?.combos" [value]="c.id" [disabled]="!c.active">{{c.name}} · {{c.price|currency:'MXN':'symbol-narrow'}}</option></select></label><ng-container *ngIf="combo as c"><div *ngFor="let g of c.groups"><h4>{{g.name}} · {{g.quantity}} elección(es)</h4><label *ngFor="let n of range(g.quantity)">Elección {{n+1}}<select [(ngModel)]="selections[g.id+':'+n]" (ngModelChange)="resetOptions(g.id+':'+n)"><option value="">Elige producto</option><option *ngFor="let pr of eligibleProducts(g.selector)" [value]="pr.uuid">{{pr.nombre}}</option></select></label><div *ngFor="let n of range(g.quantity)"><label *ngFor="let group of optionsFor(selections[g.id+':'+n])">{{group.name}} · Elección {{n+1}}<select multiple [(ngModel)]="optionSelections[g.id+':'+n+':'+group.uuid]"><option *ngFor="let o of group.options" [value]="o.uuid">{{o.name}} · +{{o.price_delta|currency:'MXN':'symbol-narrow'}}</option></select></label></div></div></ng-container><p role="alert">{{message}}</p><div class="cs-actions"><button type="button" (click)="closeCombo()">Cancelar</button><button type="button" (click)="add()">Agregar combo</button></div></div></div>`, styles: [`.cs{display:flex;gap:12px;align-items:center;flex-wrap:wrap;padding:12px 16px;border:1px solid var(--wx-edge);border-radius:16px;margin:8px 0;background:var(--wx-raised);color:var(--wx-text);font-size:13px}.cs label{display:flex;align-items:center;gap:8px}.cs select,.cs button,.cs-panel select,.cs-panel button{min-height:40px;border:1px solid var(--wx-edge);border-radius:12px;padding:8px 12px;background:var(--wx-surface);color:var(--wx-text)}.cs p{width:100%;margin:0;color:var(--wx-red-600)}.cs-modal{position:fixed;inset:0;background:#07152688;display:grid;place-items:center;z-index:10500;padding:20px}.cs-panel{background:var(--wx-surface);color:var(--wx-text);border-radius:24px;padding:24px;width:min(520px,100%);max-height:90dvh;overflow:auto}.cs-panel label{display:grid;gap:6px;margin:12px 0}.cs-panel h3{font-size:21px}.cs-panel h4{font-size:16px;margin-top:20px}.cs-actions{display:flex;justify-content:flex-end;gap:12px}`] })
export class CommercialSaleComponent {
    async ngOnInit() { await this.service.load(); }
    private host: ElementRef<HTMLElement> = inject(ElementRef);
    private returnFocus: HTMLElement | null = null;
    showCombo(event: Event) { this.returnFocus = event.currentTarget as HTMLElement; this.open = true; this.message = ''; setTimeout(() => this.host.nativeElement.querySelector<HTMLElement>('.cs-panel select')?.focus(), 0); }
    closeCombo() { this.open = false; this.returnFocus?.focus(); }
    @HostListener('document:keydown', ['$event'])
    key(event: KeyboardEvent) { if (!this.open)
        return; if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        this.closeCombo();
    } if (event.key === 'Tab') {
        const nodes = [...this.host.nativeElement.querySelectorAll<HTMLElement>('.cs-panel select,.cs-panel button')].filter(x => !x.hasAttribute('disabled'));
        const first = nodes[0], last = nodes[nodes.length - 1];
        if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last?.focus();
        }
        else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first?.focus();
        }
    } }
    auth = inject(AuthService);
    service = inject(CommercialService);
    cart = inject(CartService);
    open = false;
    comboId = '';
    selections: Record<string, string> = {};
    optionSelections: Record<string, string[]> = {};
    message = '';
    active = (x: any) => x.active;
    get audiences() { return [...new Set(this.service.policy?.promotions.filter(x => x.active && x.audience).map(x => x.audience!) ?? [])]; }
    resetOptions(key: string) { for (const k of Object.keys(this.optionSelections))
        if (k.startsWith(key + ':'))
            delete this.optionSelections[k]; }
    optionsFor(uuid: string) { const d = this.service.data(), p = d?.catalog.products.find((x: any) => x.uuid === uuid); return d?.catalog.modifier_groups.filter((g: any) => p?.modifier_groups?.includes(g.uuid)) ?? []; }
    get combo() { return this.service.policy?.combos.find(x => x.id === this.comboId); }
    range(n: number) { return Array.from({ length: n }, (_, i) => i); }
    eligibleProducts(s: any) { return (this.service.data()?.catalog.products ?? []).filter((x: any) => x.active && x.sellable && ((!s.products?.length && !s.categories?.length) || s.products?.includes(x.uuid) || s.categories?.includes(x.category_uuid))); }
    change(id: string) { try {
        this.service.changeChannel(id);
        this.message = '';
    }
    catch (e) {
        this.message = (e as Error).message;
    } }
    eligible(a: string, on: boolean) { const c = this.cart.activeCart(); c.commercial ??= { channel: 'LOCAL', audiences: [] }; c.commercial.audiences = on ? [...c.commercial.audiences, a] : c.commercial.audiences.filter(x => x !== a); this.cart.notify(); }
    add() { this.message = ''; try {
        const c = this.combo;
        if (!c?.active)
            throw Error('Elige un combo activo.');
        const channel = this.cart.activeCart().commercial?.channel ?? 'LOCAL';
        if (c.channels?.length && !c.channels.includes(channel))
            throw Error('Este combo no está disponible en el canal elegido.');
        const data = this.service.data(), pending: any[] = [];
        const instance = crypto.randomUUID();
        for (const g of c.groups)
            for (let i = 0; i < g.quantity; i++) {
                const uuid = this.selections[g.id + ':' + i], p = this.eligibleProducts(g.selector).find((x: any) => x.uuid === uuid);
                if (!p)
                    throw Error('Completa todas las elecciones.');
                const id = data.ids.find((x: any) => x.uuid === uuid)?.id;
                if (!id)
                    throw Error('Producto no disponible.');
                const options: any[] = [];
                for (const modGroup of this.optionsFor(uuid)) {
                    const selected = this.optionSelections[g.id + ':' + i + ':' + modGroup.uuid] ?? [];
                    if (selected.length < Math.max(modGroup.min_select, modGroup.required ? 1 : 0) || selected.length > modGroup.max_select)
                        throw Error('Revisa las opciones de ' + modGroup.name);
                    for (const optionUuid of selected) {
                        const option = modGroup.options.find((x: any) => x.uuid === optionUuid), ref = data.optionIds.find((x: any) => x.uuid === optionUuid);
                        if (!option || !ref)
                            throw Error('Opción no disponible.');
                        options.push({ groupId: ref.group_id, optionId: ref.id, groupName: modGroup.name, optionName: option.name, priceDelta: Number(option.price_delta), quantity: 1 });
                    }
                }
                pending.push({ p, id, group: g.id, options });
            }
        for (const x of pending) {
            const l = this.cart.makeLine({ productId: x.id, productName: x.p.nombre, unitPrice: Number(x.p.price), inventoryMode: x.p.inventory_mode, tasaIva: Number(x.p.tasa_iva ?? .16) }, 1, x.options);
            l.combo = { id: c.id, instance, group: x.group };
            this.cart.activeCart().lines.push(l);
        }
        this.cart.notify();
        this.closeCombo();
    }
    catch (e) {
        this.message = (e as Error).message;
    } }
}
