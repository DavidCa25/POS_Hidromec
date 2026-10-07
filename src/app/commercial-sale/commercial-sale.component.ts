import { AuthService } from '../../services/auth.service';
import {
  Component,
  Input,
  inject,
  ElementRef,
  HostListener,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { CommercialService } from '../../core/commercial.service';
import { CartService } from '../../core/cart.service';
import { WxSelectComponent, WxOpcion } from '../wx-select/wx-select.component';
import { WxMultiSelectComponent } from '../wx-multi-select/wx-multi-select.component';
@Component({
  selector: 'app-commercial-sale',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    WxSelectComponent,
    WxMultiSelectComponent,
  ],
  template: ` <section
      *ngIf="service.policy as p"
      class="cs"
      [class.cs--touch]="touch"
      aria-label="Canal y ofertas de la cuenta"
    >
      <label
        class="cs-channel"
        ><i *ngIf="touch" class="ph ph-storefront" aria-hidden="true"></i>
        <span>{{ touch ? 'Precios' : 'Canal' }}</span>
        <wx-select
          [opciones]="channelOptions"
          [disabled]="channelLocked"
          [ngModel]="cart.activeCart().commercial?.channel ?? 'LOCAL'"
          (ngModelChange)="change($event)"
        ></wx-select
      ></label>
      <ng-template #accountOptions>
        <button
          *ngIf="p.combos.some(active)"
          type="button"
          (click)="showCombo($event)"
        >
          Agregar combo
        </button>
        <ng-container *ngIf="cart.activeCart().commercial as c"
          ><label *ngIf="c.channel !== 'LOCAL'"
            >Folio de plataforma<input
              aria-label="Folio de plataforma"
              maxlength="100"
              [(ngModel)]="c.orderReference"
              (ngModelChange)="cart.notify()" /></label
        ></ng-container>
        <label *ngFor="let audience of audiences"
          ><input
            type="checkbox"
            [disabled]="!auth.puede('VENTAS_SUPERVISAR')"
            [ngModel]="
              cart.activeCart().commercial?.audiences?.includes(audience)
            "
            (ngModelChange)="eligible(audience, $event)"
          />
          {{ audience }}</label
        >
      </ng-template>
      <ng-container
        *ngIf="!touch"
        [ngTemplateOutlet]="accountOptions"
      ></ng-container>
      <button *ngIf="touch" type="button" class="cs-more"
        aria-label="Combos y opciones" [attr.popovertarget]="optionsId"
        [style.anchor-name]="optionsAnchor"
        [class.cs-more--alert]="message || cart.activeCart().commercial?.error"
        [attr.title]="message || cart.activeCart().commercial?.error || 'Combos y opciones'">
        <i class="ph" [class.ph-warning-circle]="message || cart.activeCart().commercial?.error"
          [class.ph-dots-three]="!(message || cart.activeCart().commercial?.error)" aria-hidden="true"></i>
      </button>
      <div *ngIf="touch" [id]="optionsId" popover data-anclado
        class="wx-pop cs-options" [style.--wx-anchor]="optionsAnchor"
        role="dialog" aria-label="Combos y opciones">
        <strong>Combos y opciones</strong>
        <ng-container [ngTemplateOutlet]="accountOptions"></ng-container>
        <ng-container [ngTemplateOutlet]="accountStatus"></ng-container>
      </div>
      <ng-container *ngIf="!touch" [ngTemplateOutlet]="accountStatus"></ng-container>
      <ng-template #accountStatus>
      <p *ngIf="cart.activeCart().meta?.['commercialNotice']" role="status">
        {{ cart.activeCart().meta?.['commercialNotice'] }}
      </p>
      <span *ngIf="cart.activeCart().commercial?.pending" role="status"
        >Calculando precios…</span
      ><span
        *ngIf="cart.activeCart().commercial?.quote as q"
        [hidden]="touch && +q.discount === 0"
        >{{ q.channelName }} · Ahorro
        {{ q.discount | currency: 'MXN' : 'symbol-narrow' }}</span
      >
      <p *ngIf="message || cart.activeCart().commercial?.error" role="alert">
        {{ message || cart.activeCart().commercial?.error }}
      </p>
      </ng-template>
    </section>
    <div
      *ngIf="open"
      class="cs-modal"
      role="dialog"
      aria-modal="true"
      aria-label="Elegir combo"
    >
      <div class="cs-panel">
        <h3>Arma tu combo</h3>
        <label
          >Combo<wx-select
            placeholder="Elige un combo"
            [opciones]="comboOptions"
            [(ngModel)]="comboId"
            (ngModelChange)="selections = {}; optionSelections = {}"
          ></wx-select></label
        ><ng-container *ngIf="combo as c"
          ><div *ngFor="let g of c.groups">
            <h4>{{ g.name }} · {{ g.quantity }} elección(es)</h4>
            <label *ngFor="let n of range(g.quantity)"
              >Elección {{ n + 1
              }}<wx-select
                placeholder="Elige producto"
                [buscable]="true"
                [opciones]="productOptions(g.selector)"
                [(ngModel)]="selections[g.id + ':' + n]"
                (ngModelChange)="resetOptions(g.id + ':' + n)"
              ></wx-select
            ></label>
            <div *ngFor="let n of range(g.quantity)">
              <label
                *ngFor="let group of optionsFor(selections[g.id + ':' + n])"
                >{{ group.name }} · Elección {{ n + 1
                }}<wx-multi-select
                  [etiqueta]="group.name"
                  [opciones]="modifierOptions(group)"
                  [(values)]="
                    optionSelections[g.id + ':' + n + ':' + group.uuid]
                  "
                ></wx-multi-select
              ></label>
            </div></div
        ></ng-container>
        <p role="alert">{{ message }}</p>
        <div class="cs-actions">
          <button type="button" (click)="closeCombo()">Cancelar</button
          ><button type="button" (click)="add()">Agregar combo</button>
        </div>
      </div>
    </div>`,
  styles: [
    `
      .cs {
        display: flex;
        gap: 12px;
        align-items: center;
        flex-wrap: wrap;
        padding: 12px 16px;
        border: 1px solid var(--wx-edge);
        border-radius: 16px;
        margin: 8px 0;
        background: var(--wx-raised);
        color: var(--wx-text);
        font-size: 13px;
      }
      .cs label {
        display: flex;
        align-items: center;
        gap: 8px;
      }
      .cs--touch {
        flex-wrap: nowrap;
        height: var(--tp-tap, 44px);
        box-sizing: border-box;
        margin: 0 16px 12px;
        padding: 0 0 0 12px;
        gap: 0;
        border-color: var(--wx-edge-soft);
        border-radius: var(--wx-radius-md);
        background: transparent;
        font-size: var(--wx-text-sm);
      }
      .cs--touch .cs-channel {
        flex: 1;
        min-width: 0;
        gap: 10px;
        color: var(--wx-text-muted);
      }
      .cs-channel > i { font-size: 18px; color: var(--wx-text-dim); }
      .cs--touch wx-select {
        flex: 1;
        min-width: 0;
        --wx-select-height: 42px;
        --wx-select-padding: 0;
        --wx-select-background: transparent;
        --wx-select-border: 0;
        --wx-select-color: var(--wx-accent-text);
      }
      .cs.cs--touch .cs-more {
        flex: 0 0 44px;
        height: 42px;
        min-height: 0;
        padding: 0;
        border: 0;
        background: transparent;
        color: var(--wx-text-muted);
        font-size: 20px;
      }
      .cs.cs--touch .cs-more--alert { color: var(--wx-danger); }
      .cs-options {
        --wx-pop-area: bottom span-left;
        width: min(300px, calc(100vw - 32px));
        max-height: min(360px, 70dvh);
        padding: 16px;
        overflow: auto;
      }
      .cs-options label {
        display: flex;
        flex-wrap: wrap;
        margin-top: 10px;
      }
      .cs-options span, .cs-options p { display: block; margin-top: 10px; }
      .cs-options button {
        margin: 8px 0;
        width: 100%;
      }
      .cs input:not([type='checkbox']),
      .cs button,
      .cs-panel button {
        min-height: 40px;
        border: 1px solid var(--wx-edge);
        border-radius: 12px;
        padding: 8px 12px;
        background: var(--wx-surface);
        color: var(--wx-text);
      }
      .cs p {
        width: 100%;
        margin: 0;
        color: var(--wx-danger);
      }
      .cs-modal {
        position: fixed;
        inset: 0;
        background: var(--wx-dialogo-velo);
        display: grid;
        place-items: center;
        z-index: 10500;
        padding: 20px;
      }
      .cs-panel {
        background: var(--wx-surface);
        color: var(--wx-text);
        border-radius: 24px;
        padding: 24px;
        width: min(520px, 100%);
        max-height: 90dvh;
        overflow: auto;
      }
      .cs-panel label {
        display: grid;
        gap: 6px;
        margin: 12px 0;
      }
      .cs-panel h3 {
        font-size: 21px;
      }
      .cs-panel h4 {
        font-size: 16px;
        margin-top: 20px;
      }
      .cs-actions {
        display: flex;
        justify-content: flex-end;
        gap: 12px;
      }
    `,
  ],
})
export class CommercialSaleComponent {
  @Input() touch = false;
  get channelLocked() {
    return this.cart.activeCart().lines.some((l) => l.enviada != null);
  }
  async ngOnInit() {
    await this.service.load();
  }
  private host: ElementRef<HTMLElement> = inject(ElementRef);
  private returnFocus: HTMLElement | null = null;
  readonly optionsId = 'cs-options-' + crypto.randomUUID();
  readonly optionsAnchor = '--' + this.optionsId;
  showCombo(event: Event) {
    const options = this.host.nativeElement.querySelector<HTMLElement>('.cs-options');
    this.returnFocus = this.touch
      ? this.host.nativeElement.querySelector<HTMLElement>('.cs-more')
      : event.currentTarget as HTMLElement;
    if (options?.matches(':popover-open')) options.hidePopover();
    this.open = true;
    this.message = '';
    setTimeout(
      () =>
        this.host.nativeElement
          .querySelector<HTMLElement>('.cs-panel [role=combobox]')
          ?.focus(),
      0,
    );
  }
  closeCombo() {
    this.open = false;
    this.returnFocus?.focus();
  }
  @HostListener('document:keydown', ['$event'])
  key(event: KeyboardEvent) {
    if (!this.open) return;
    if (
      event.key === 'Escape' &&
      !this.host.nativeElement.querySelector(':popover-open')
    ) {
      event.preventDefault();
      event.stopPropagation();
      this.closeCombo();
    }
    if (event.key === 'Tab') {
      const nodes = [
        ...this.host.nativeElement.querySelectorAll<HTMLElement>(
          '.cs-panel button,.cs-panel input',
        ),
      ].filter(
        (x) => !x.hasAttribute('disabled') && x.getClientRects().length > 0,
      );
      const first = nodes[0],
        last = nodes[nodes.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    }
  }
  auth = inject(AuthService);
  service = inject(CommercialService);
  cart = inject(CartService);
  open = false;
  comboId = '';
  selections: Record<string, string> = {};
  optionSelections: Record<string, string[]> = {};
  message = '';
  active = (x: any) => x.active;
  get channelOptions(): WxOpcion[] {
    return (
      this.service.policy?.channels.map((c) => ({
        valor: c.id,
        etiqueta: c.name,
        desactivada: !c.active,
      })) ?? []
    );
  }
  get comboOptions(): WxOpcion[] {
    return (
      this.service.policy?.combos.map((c) => ({
        valor: c.id,
        etiqueta: c.name,
        nota: this.money(c.price),
        desactivada: !c.active,
      })) ?? []
    );
  }
  productOptions(selector: any): WxOpcion[] {
    return this.eligibleProducts(selector).map((p: any) => ({
      valor: p.uuid,
      etiqueta: p.nombre,
    }));
  }
  modifierOptions(group: any): WxOpcion[] {
    return group.options
      .filter((o: any) => o.active)
      .map((o: any) => ({
        valor: o.uuid,
        etiqueta: o.name,
        nota: '+' + this.money(o.price_delta),
      }));
  }
  money(value: any) {
    return Number(value).toLocaleString('es-MX', {
      style: 'currency',
      currency: 'MXN',
    });
  }
  get audiences() {
    return [
      ...new Set(
        this.service.policy?.promotions
          .filter((x) => x.active && x.audience)
          .map((x) => x.audience!) ?? [],
      ),
    ];
  }
  resetOptions(key: string) {
    for (const k of Object.keys(this.optionSelections))
      if (k.startsWith(key + ':')) delete this.optionSelections[k];
  }
  optionsFor(uuid: string) {
    const d = this.service.data(),
      p = d?.catalog.products.find((x: any) => x.uuid === uuid);
    return (
      d?.catalog.modifier_groups.filter((g: any) =>
        p?.modifier_groups?.includes(g.uuid),
      ) ?? []
    );
  }
  get combo() {
    return this.service.policy?.combos.find((x) => x.id === this.comboId);
  }
  range(n: number) {
    return Array.from({ length: n }, (_, i) => i);
  }
  eligibleProducts(s: any) {
    return (this.service.data()?.catalog.products ?? []).filter(
      (x: any) =>
        x.active &&
        x.sellable &&
        ((!s.products?.length && !s.categories?.length) ||
          s.products?.includes(x.uuid) ||
          s.categories?.includes(x.category_uuid)),
    );
  }
  change(id: string) {
    try {
      this.service.changeChannel(id);
      this.message = '';
    } catch (e) {
      this.message = (e as Error).message;
    }
  }
  eligible(a: string, on: boolean) {
    const c = this.cart.activeCart();
    c.commercial ??= { channel: 'LOCAL', audiences: [] };
    c.commercial.audiences = on
      ? [...c.commercial.audiences, a]
      : c.commercial.audiences.filter((x) => x !== a);
    this.cart.notify();
  }
  add() {
    this.message = '';
    try {
      const c = this.combo;
      if (!c?.active) throw Error('Elige un combo activo.');
      const channel = this.cart.activeCart().commercial?.channel ?? 'LOCAL';
      if (c.channels?.length && !c.channels.includes(channel))
        throw Error('Este combo no está disponible en el canal elegido.');
      const data = this.service.data(),
        pending: any[] = [];
      const instance = crypto.randomUUID();
      for (const g of c.groups)
        for (let i = 0; i < g.quantity; i++) {
          const uuid = this.selections[g.id + ':' + i],
            p = this.eligibleProducts(g.selector).find(
              (x: any) => x.uuid === uuid,
            );
          if (!p) throw Error('Completa todas las elecciones.');
          const id = data.ids.find((x: any) => x.uuid === uuid)?.id;
          if (!id) throw Error('Producto no disponible.');
          const options: any[] = [];
          for (const modGroup of this.optionsFor(uuid)) {
            const selected =
              this.optionSelections[g.id + ':' + i + ':' + modGroup.uuid] ?? [];
            if (
              selected.length <
                Math.max(modGroup.min_select, modGroup.required ? 1 : 0) ||
              selected.length > modGroup.max_select
            )
              throw Error('Revisa las opciones de ' + modGroup.name);
            for (const optionUuid of selected) {
              const option = modGroup.options.find(
                  (x: any) => x.uuid === optionUuid,
                ),
                ref = data.optionIds.find((x: any) => x.uuid === optionUuid);
              if (!option || !ref) throw Error('Opción no disponible.');
              options.push({
                groupId: ref.group_id,
                optionId: ref.id,
                groupName: modGroup.name,
                optionName: option.name,
                priceDelta: Number(option.price_delta),
                quantity: 1,
              });
            }
          }
          pending.push({ p, id, group: g.id, options });
        }
      for (const x of pending) {
        const l = this.cart.makeLine(
          {
            productId: x.id,
            productName: x.p.nombre,
            unitPrice: Number(x.p.price),
            inventoryMode: x.p.inventory_mode,
            tasaIva: Number(x.p.tasa_iva ?? 0.16),
          },
          1,
          x.options,
        );
        l.combo = { id: c.id, instance, group: x.group };
        this.cart.activeCart().lines.push(l);
      }
      this.cart.notify();
      this.closeCombo();
    } catch (e) {
      this.message = (e as Error).message;
    }
  }
}
