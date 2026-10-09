import {
  Component,
  inject,
  ViewChild,
  ElementRef,
  OnDestroy,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { Subscription } from 'rxjs';
import { CommercialService } from '../../core/commercial.service';
import {
  cotizar,
  validarPolitica,
  PoliticaComercial,
  Selector,
  PartidaComercial,
  CuentaComercial,
} from '../../../shared/comercial';
import { WxSelectComponent, WxOpcion } from '../wx-select/wx-select.component';
import { WxDateComponent } from '../wx-date/wx-date.component';
import { WxMultiSelectComponent } from '../wx-multi-select/wx-multi-select.component';
import { WxMenuComponent, WxMenuOpcion } from '../wx-menu/wx-menu.component';
import { InventoryTabsComponent } from '../inventory-tabs/inventory-tabs.component';
type Offer = { id: string; type: 'promotion' | 'combo'; item: any };
@Component({
  selector: 'app-commercial-panel',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    RouterLink,
    WxSelectComponent,
    WxDateComponent,
    WxMultiSelectComponent,
    WxMenuComponent,
    InventoryTabsComponent,
  ],
  templateUrl: './commercial-panel.component.html',
  styleUrls: ['./commercial-panel.component.css'],
})
export class CommercialPanelComponent implements OnDestroy {
  readonly service = inject(CommercialService);
  private route = inject(ActivatedRoute);
  private subscription: Subscription;
  @ViewChild('editor') editor?: ElementRef<HTMLDialogElement>;
  @ViewChild('removeDialog') removeDialog?: ElementRef<HTMLDialogElement>;
  policy: PoliticaComercial | null = null;
  settings: PoliticaComercial | null = null;
  products: any[] = [];
  view = 'offers';
  message = '';
  busy = false;
  loading = true;
  filter = '';
  statusFilter = 'all';
  offerKind = 'all';
  selected: Offer | null = null;
  draft: Offer | null = null;
  newDraft = false;
  step = 0;
  editorError = '';
  pendingDelete: Offer | null = null;
  previewLines: PartidaComercial[] = [];
  get hasVolume(){return this.policy?.promotions.some(p=>p.kind==='VOLUME')??false;}
  previewResult: CuentaComercial | null = null;
  previewChannel = 'LOCAL';
  previewDate = this.today();
  previewTime = '09:00';
  previewAudience = '';
  previewError = '';
  previewIncludeOthers = false;
  readonly days = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
  readonly weekdayOrder = [1, 2, 3, 4, 5, 6, 0];
  readonly typeOptions: WxOpcion[] = [
    { valor: 'VOLUME', etiqueta: 'Mayoreo por cantidad', nota: 'Precio desde un mínimo de piezas' },
    {
      valor: 'PRICE',
      etiqueta: 'Precio especial',
      nota: 'Un precio fijo por unidad',
    },
    {
      valor: 'PERCENT',
      etiqueta: 'Porcentaje',
      nota: 'Descuento sobre el precio',
    },
    {
      valor: 'AMOUNT',
      etiqueta: 'Importe por unidad',
      nota: 'Resta una cantidad fija',
    },
    {
      valor: 'BUY_PAY',
      etiqueta: 'Compra N / paga M',
      nota: 'Por ejemplo, lleva 2 y paga 1',
    },
    {
      valor: 'ADDON',
      etiqueta: 'Producto adicional',
      nota: 'Un precio al cumplir una compra',
    },
  ];
  readonly createOptions: WxMenuOpcion[] = [
    { valor: 'promotion', etiqueta: 'Crear promoción', icono: 'ph ph-tag' },
    { valor: 'combo', etiqueta: 'Crear combo', icono: 'ph ph-stack' },
    { valor: 'volume', etiqueta: 'Crear mayoreo', icono: 'ph ph-package' },
  ];
  constructor() {
    this.subscription = this.route.queryParamMap.subscribe(
      (p) =>
        (this.view =
          p.get('view') === 'prices'
            ? 'prices'
            : p.get('view') === 'channels'
              ? 'channels'
              : 'offers'),
    );
  }
  ngOnDestroy() {
    this.subscription.unsubscribe();
  }
  async ngOnInit() {
    await this.reload();
  }
  today() {
    return new Date().toLocaleDateString('sv-SE');
  }
  id() {
    return 'r_' + crypto.randomUUID().replaceAll('-', '');
  }
  money(v: any) {
    const n = Number(v);
    return Number.isFinite(n)
      ? n.toLocaleString('es-MX', { style: 'currency', currency: 'MXN' })
      : '—';
  }
  number(v: any) {
    return Number(v ?? 0);
  }
  amount(v: any) {
    return v == null ? '' : Number(v).toFixed(2);
  }
  get categories() {
    return this.service.data()?.catalog.categories ?? [];
  }
  get productOptions(): WxOpcion[] {
    return this.products.map((p) => ({
      valor: p.uuid,
      etiqueta: p.nombre,
      nota: this.money(p.price),
    }));
  }
  get categoryOptions(): WxOpcion[] {
    return this.categories.map((c: any) => ({
      valor: c.uuid,
      etiqueta: c.nombre,
    }));
  }
  get channelOptions(): WxOpcion[] {
    return (
      (this.settings ?? this.policy)?.channels.map((c) => ({
        valor: c.id,
        etiqueta: c.name,
        desactivada: !c.active,
      })) ?? []
    );
  }
  get variantOptions(): WxOpcion[] {
    return this.variants().map((v: any) => ({
      valor: v.uuid,
      etiqueta: v.name,
      nota: 'Ajuste ' + this.money(v.price_delta),
    }));
  }
  variants(product?: string) {
    const d = this.service.data(),
      p = d?.catalog.products.find((x: any) => x.uuid === product);
    return (
      d?.catalog.modifier_groups
        .filter(
          (g: any) =>
            g.role === 'SIZE' && (!p || p.modifier_groups?.includes(g.uuid)),
        )
        .flatMap((g: any) => g.options.filter((o: any) => o.active)) ?? []
    );
  }
  priceVariants(product: string): WxOpcion[] {
    return [
      { valor: undefined, etiqueta: 'Cualquier tamaño' },
      ...this.variants(product).map((v: any) => ({
        valor: v.uuid,
        etiqueta: v.name,
      })),
    ];
  }
  get offers(): Offer[] {
    return this.policy
      ? [
          ...this.policy.promotions.map((item) => ({
            id: item.id,
            type: 'promotion' as const,
            item,
          })),
          ...this.policy.combos.map((item) => ({
            id: item.id,
            type: 'combo' as const,
            item,
          })),
        ].sort((a, b) => this.statusOrder(a) - this.statusOrder(b))
      : [];
  }
  private statusOrder(o: Offer) {
    return ['Activa', 'Programada', 'Inactiva', 'Vencida'].indexOf(
      this.status(o),
    );
  }
  trackOffer(_index: number, offer: Offer) {
    return offer.type + ':' + offer.id;
  }
  get visibleOffers() {
    const q = this.filter.trim().toLowerCase();
    return this.offers.filter(
      (o) =>
        (this.offerKind === 'all' || (this.offerKind === 'volume' ? o.item.kind === 'VOLUME' : this.offerKind === 'combo' ? o.type === 'combo' : o.type === 'promotion' && o.item.kind !== 'VOLUME')) &&
        o.item.name.toLowerCase().includes(q) &&
        (this.statusFilter === 'all' ||
          (this.statusFilter === 'active'
            ? this.status(o) === 'Activa'
            : this.status(o) === 'Programada')),
    );
  }
  status(o: Offer) {
    if (!o.item.active) return 'Inactiva';
    if (o.item.starts && o.item.starts > this.today()) return 'Programada';
    if (o.item.ends && o.item.ends < this.today()) return 'Vencida';
    return 'Activa';
  }
  compactMoney(v: any) {
    return Number(v).toLocaleString('es-MX', {
      style: 'currency',
      currency: 'MXN',
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    });
  }
  badge(o: Offer) {
    const r = o.item;
    if (o.type === 'combo') return this.compactMoney(r.price);
    if (r.kind === 'BUY_PAY') return r.buy + '×' + r.pay;
    if (r.kind === 'PERCENT') return Number(r.value) + '%';
    return (
      (r.kind === 'AMOUNT' ? '−' : r.kind === 'ADDON' ? '+' : '') +
      this.compactMoney(r.value)
    );
  }
  badgeFont(o: Offer) {
    const length = this.badge(o).length;
    return length > 3
      ? Math.max(20, Math.min(46, 132 / (length * 0.66))) + 'px'
      : null;
  }
  kindLabel(o: Offer) {
    if(o.item.kind === 'VOLUME') return 'Desde ' + o.item.minimumQty + ' piezas';
    return o.type === 'combo'
      ? 'Combo'
      : o.item.kind === 'ADDON'
        ? 'Adicional'
        : o.item.kind === 'BUY_PAY'
          ? 'Lleva y paga'
          : o.item.kind === 'PERCENT'
            ? 'Descuento'
            : 'Precio especial';
  }
  description(o: Offer) {
    const r = o.item;
    if (o.type === 'combo')
      return r.groups.map((g: any) => g.quantity + ' ' + g.name).join(' + ');
    if (r.kind === 'VOLUME') return 'Mayoreo desde ' + r.minimumQty + ' piezas' + (r.mixProducts !== false ? ' · Puedes mezclar productos elegibles.' : ' del mismo producto y tamaño.');
    if (r.kind === 'BUY_PAY')
      return 'Lleva ' + r.buy + ' y paga ' + r.pay + '.';
    if (r.kind === 'ADDON')
      return (
        'Precio adicional al comprar ' + r.triggerQty + ' unidades elegibles.'
      );
    if (r.kind === 'PERCENT')
      return (
        Number(r.value) +
        '% de descuento' +
        (r.audience ? ' con elegibilidad.' : '.')
      );
    return r.kind === 'AMOUNT'
      ? 'Descuento por cada unidad elegible.'
      : 'Precio especial por unidad.';
  }
  schedule(o: Offer, compact = false) {
    const r = o.item;
    const weekdays = [...(r.weekdays ?? [])].sort();
    const days =
      weekdays.join(',') === '1,2,3,4,5'
        ? 'Lun a Vie'
        : weekdays.length
          ? weekdays.map((d: number) => this.days[d]).join(', ')
          : 'Todos los días';
    if (!r.windows?.length && (compact || !weekdays.length)) return days;
    return (
      days +
      ' · ' +
      (r.windows?.length
        ? r.windows.map((w: any) => w.from + '–' + w.to).join(' / ')
        : 'Todo el día')
    );
  }
  channelLabel(o: Offer) {
    return !o.item.channels?.length
      ? 'Todos los canales'
      : o.item.channels
          .map(
            (id: string) =>
              this.policy?.channels.find((c) => c.id === id)?.name ?? id,
          )
          .join(', ');
  }
  productLabel(o: Offer) {
    if (o.type === 'combo')
      return o.item.groups.map((g: any) => g.name).join(' + ');
    const s = o.item.selector;
    const names = [
      ...(s.products ?? []).map(
        (id: string) =>
          this.products.find((p) => p.uuid === id)?.nombre ??
          'Producto no disponible',
      ),
      ...(s.categories ?? []).map(
        (id: string) =>
          this.categories.find((c: any) => c.uuid === id)?.nombre ??
          'Categoría',
      ),
    ];
    return names.length
      ? names[0] + (names.length > 1 ? ' +' + (names.length - 1) : '')
      : 'Catálogo completo';
  }
  actions(o: Offer): WxMenuOpcion[] {
    return [
      {
        valor: 'edit',
        etiqueta: 'Editar oferta',
        icono: 'ph ph-pencil-simple',
      },
      {
        valor: 'toggle',
        etiqueta: o.item.active ? 'Pausar oferta' : 'Activar oferta',
        icono: o.item.active ? 'ph ph-pause' : 'ph ph-play',
      },
      { valor: 'delete', etiqueta: 'Eliminar oferta', icono: 'ph ph-trash' },
    ];
  }
  async reload() {
    this.loading = true;
    await this.service.load();
    const d = this.service.data();
    if (d && !this.service.error()) {
      this.policy = structuredClone(d.policy);
      this.settings = structuredClone(d.policy);
      this.products = d.catalog.products.filter(
        (p: any) => p.sellable && p.active,
      );
      const previous = this.selected?.id;
      this.select(
        this.offers.find((o) => o.id === previous) ?? this.offers[0] ?? null,
      );
    } else this.message = this.service.error();
    this.loading = false;
  }
  select(o: Offer | null) {
    this.selected = o;
    this.makePreview(o);
  }
  eligible(s: Selector) {
    return this.products.filter(
      (p) =>
        (!s.products?.length && !s.categories?.length) ||
        s.products?.includes(p.uuid) ||
        s.categories?.includes(p.category_uuid),
    );
  }
  previewProductOptions(l: PartidaComercial): WxOpcion[] {
    const o = this.draft ?? this.selected;
    const group =
      l.combo && o?.type === 'combo'
        ? o.item.groups.find((g: any) => g.id === l.combo!.group)
        : null;
    return (group ? this.eligible(group.selector) : this.products).map((p) => ({
      valor: p.uuid,
      etiqueta: p.nombre,
      nota: this.money(p.price),
    }));
  }
  makePreview(o: Offer | null) {
    this.previewLines = [];
    this.previewResult = null;
    this.previewError = '';
    if (!o || !this.policy) return;
    this.previewAudience = o.item.audience ?? '';
    this.previewChannel =
      this.policy.channels.find(
        (c) =>
          c.active &&
          (!o.item.channels?.length || o.item.channels.includes(c.id)),
      )?.id ?? 'LOCAL';
    this.previewDate = o.item.starts || o.item.ends || this.today();
    if (o.item.weekdays?.length) {
      const d = new Date(this.previewDate + 'T12:00:00');
      for (let n = 0; n < 7 && !o.item.weekdays.includes(d.getDay()); n++)
        d.setDate(d.getDate() + 1);
      this.previewDate = d.toLocaleDateString('sv-SE');
    }
    this.previewTime = o.item.windows?.[0]?.from ?? '09:00';
    const add = (s: Selector, quantity: number, group?: string) => {
      const p = this.eligible(s)[0];
      if (!p) return;
      const variant = s.variants?.[0];
      this.previewLines.push({
        key: this.id(),
        product: p.uuid,
        quantity: String(quantity),
        variant,
        extras: variant
          ? this.amount(
              this.variants(p.uuid).find((v: any) => v.uuid === variant)
                ?.price_delta ?? 0,
            )
          : '0.00',
        combo: group ? { id: o.id, instance: 'preview', group } : undefined,
      });
    };
    if (o.type === 'combo')
      for (const g of o.item.groups) add(g.selector, g.quantity, g.id);
    else {
      add(o.item.selector, o.item.kind === 'BUY_PAY' ? o.item.buy : o.item.kind === 'VOLUME' ? o.item.minimumQty : 1);
      if (o.item.kind === 'ADDON') add(o.item.trigger, o.item.triggerQty);
    }
    this.preview();
  }
  previewAdd() {
    if (this.products.length)
      this.previewLines.push({
        key: this.id(),
        product: this.products[0].uuid,
        quantity: '1',
        extras: '0.00',
      });
    this.preview();
  }
  preview() {
    try {
      if (!this.policy || !this.previewLines.length) {
        this.previewResult = null;
        return;
      }
      const p = structuredClone(this.policy),
        o = this.draft ?? this.selected;
      if (!this.previewIncludeOthers) {
        p.promotions = [];
        p.combos = [];
      }
      if (o) {
        const item = { ...structuredClone(o.item), active: true };
        if (o.type === 'combo')
          p.combos = [...p.combos.filter((x) => x.id !== o.id), item];
        else
          p.promotions = [...p.promotions.filter((x) => x.id !== o.id), item];
      }
      this.previewResult = cotizar(
        p,
        this.products.map((pr) => ({
          id: pr.uuid,
          price: pr.price,
          category: pr.category_uuid,
        })),
        this.previewLines,
        {
          channel: this.previewChannel,
          date: this.previewDate,
          time: this.previewTime,
          weekday: new Date(this.previewDate + 'T12:00:00Z').getUTCDay(),
          audiences: this.previewAudience ? [this.previewAudience] : [],
        },
      );
      this.previewError = '';
    } catch (e) {
      this.previewResult = null;
      this.previewError = (e as Error).message;
    }
  }
  productsName(id: string) {
    return (
      this.products.find((p) => p.uuid === id)?.nombre ??
      'Producto no disponible'
    );
  }
  previewUnit(l: PartidaComercial) {
    const line = this.previewResult?.lines.find((x) => x.source === l.key);
    return line ? Number(line.basePrice) + Number(line.extras) : 0;
  }
  previewLineAmount(l: PartidaComercial) {
    const lines =
      this.previewResult?.lines.filter((x) => x.source === l.key) ?? [];
    return lines.reduce(
      (sum, x) =>
        sum + (Number(x.basePrice) + Number(x.extras)) * Number(x.quantity),
      0,
    );
  }
  create(requested: 'promotion' | 'combo' | 'volume') {
    const type = requested === 'volume' ? 'promotion' : requested;
    const id = this.id();
    this.newDraft = true;
    this.draft = {
      id,
      type,
      item:
        type === 'combo'
          ? {
              id,
              name: 'Nuevo combo',
              active: false,
              price: '0.00',
              weekdays:[],windows:[],
              groups: [
                {
                  id: this.id(),
                  name: 'Elige un producto',
                  quantity: 1,
                  selector: { products: [] },
                },
              ],
            }
          : {
              id,
              name: requested === 'volume' ? 'Nuevo mayoreo' : 'Nueva promoción',
              active: false,
              priority: 10,
              kind: requested === 'volume' ? 'VOLUME' : 'PRICE',
              minimumQty: requested === 'volume' ? 6 : undefined,
              mixProducts: true,
              selector: { products: [] },
              value: '0.00',
              channels: ['LOCAL'],
              weekdays: [],
              windows: [],
            },
    };
    this.showEditor();
  }
  edit(o: Offer) {
    this.newDraft = false;
    this.draft = structuredClone(o);
    this.showEditor();
  }
  showEditor() {
    this.step = 0;
    this.editorError = '';
    setTimeout(() => this.editor?.nativeElement.showModal());
    this.makePreview(this.draft);
  }
  closeEditor() {
    if (this.busy) return;
    this.editor?.nativeElement.close();
    this.draft = null;
    this.makePreview(this.selected);
  }
  editorClosed() {
    this.draft = null;
    this.makePreview(this.selected);
  }
  cancelDialog(event: Event) {
    if (this.busy) event.preventDefault();
  }
  changeKind(r: any) {
    if (r.kind === 'VOLUME') { r.minimumQty ??= 6; r.mixProducts ??= true; delete r.maxApplications; }
    if (r.kind === 'BUY_PAY') {
      r.buy = 2;
      r.pay = 1;
    }
    if (r.kind === 'ADDON') {
      r.trigger ??= { products: [] };
      r.triggerQty ??= 2;
    }
    if (r.kind !== 'BUY_PAY') r.value ??= '0.00';
    this.makePreview(this.draft);
  }
  day(r: any, d: number) {
    const s = new Set<number>(r.weekdays ?? []);
    s.has(d) ? s.delete(d) : s.add(d);
    r.weekdays = [...s];
    this.makePreview(this.draft);
  }
  addWindow(r: any) {
    (r.windows ??= []).push({ from: '07:30', to: '10:00' });
    this.preview();
  }
  addGroup(r: any) {
    r.groups.push({
      id: this.id(),
      name: 'Elige un producto',
      quantity: 1,
      selector: { products: [] },
    });
  }
  validate(p: PoliticaComercial) {
    validarPolitica(p);
  }
  async publish(next: PoliticaComercial) {
    if (this.busy) return false;
    this.busy = true;
    try {
      this.validate(next);
      const r = await (window as any).electronAPI.commercialSave({
        version: this.policy!.version,
        policy: next,
      });
      if (!r.success) throw Error(r.error);
      this.policy = r.data;
      this.settings = structuredClone(r.data);
      await this.service.load();
      this.message =
        'Cambios guardados. Las cuentas se verifican antes de cobrar.';
      return true;
    } catch (e) {
      this.message = (e as Error).message;
      this.editorError = this.message;
      return false;
    } finally {
      this.busy = false;
    }
  }
  async saveDraft() {
    if (!this.draft || !this.policy) return;
    const d = this.draft,
      next = structuredClone(this.policy),
      list: any[] = d.type === 'combo' ? next.combos : next.promotions;
    const i = list.findIndex((x) => x.id === d.id);
    if (i < 0) list.push(d.item);
    else list[i] = d.item;
    if (await this.publish(next)) {
      this.selected = this.offers.find((o) => o.id === d.id) ?? null;
      this.closeEditor();
    }
  }
  async action(action: string, o: Offer) {
    if (this.busy) return;
    if (action === 'edit') {
      this.edit(o);
      return;
    }
    if (action === 'delete') {
      this.editorError = '';
      this.pendingDelete = o;
      this.removeDialog?.nativeElement.showModal();
      return;
    }
    const next = structuredClone(this.policy!),
      list = o.type === 'combo' ? next.combos : next.promotions;
    list.find((x) => x.id === o.id)!.active = !o.item.active;
    if (await this.publish(next))
      this.select(this.offers.find((x) => x.id === o.id) ?? null);
  }
  async deleteConfirmed() {
    if (!this.pendingDelete) return;
    const o = this.pendingDelete,
      next = structuredClone(this.policy!);
    if (o.type === 'combo')
      next.combos = next.combos.filter((x) => x.id !== o.id);
    else next.promotions = next.promotions.filter((x) => x.id !== o.id);
    if (await this.publish(next)) {
      this.removeDialog?.nativeElement.close();
      this.pendingDelete = null;
      this.select(this.offers[0] ?? null);
    }
  }
  addChannel() {
    this.settings!.channels.push({
      id: this.id(),
      name: 'Nuevo canal',
      active: true,
      inheritBase: false,
    });
  }
  addPrice() {
    if (this.products.length)
      this.settings!.prices.push({
        channel: 'LOCAL',
        product: this.products[0].uuid,
        price: this.amount(this.products[0].price),
      });
  }
  async saveSettings() {
    if (this.settings && (await this.publish(structuredClone(this.settings))))
      this.select(
        this.offers.find((o) => o.id === this.selected?.id) ??
          this.offers[0] ??
          null,
      );
  }
}
