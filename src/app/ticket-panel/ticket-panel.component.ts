import { Component, OnInit, OnDestroy, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { WxSelectComponent, WxOpcion } from '../wx-select/wx-select.component';
type Profile = {
  format: string;
  width: number;
  height: number;
  margin: number;
  fields: string[];
};
const labels: Record<string, string> = {
  logo: 'Logo del negocio',
  business: 'Datos del negocio',
  meta: 'Cliente, cajero y canal',
  items: 'Productos y cantidades',
  discount: 'Descuentos',
  tax: 'Impuestos incluidos',
  payments: 'Formas de pago',
  footer: 'Mensaje final',
  identity: 'Negocio, caja y turno',
  sales: 'Total vendido y número de ventas',
  cash: 'Fondo, entradas y salidas',
  refunds: 'Devoluciones',
  declaration: 'Arqueo y diferencia',
  signature: 'Firma del cajero',
};
@Component({
  selector: 'app-ticket-panel',
  standalone: true,
  imports: [CommonModule, FormsModule, WxSelectComponent],
  templateUrl: './ticket-panel.component.html',
  styleUrls: ['../panel-controls.css', './ticket-panel.component.css'],
})
export class TicketPanelComponent implements OnInit, OnDestroy {
  private sanitizer = inject(DomSanitizer);
  private revision = 0;
  private timer?: ReturnType<typeof setTimeout>;
  private get api() {
    return (window as any).electronAPI;
  }
  doc = 'sale';
  documents: Record<string, Profile> = {
    sale: {
      format: 'roll',
      width: 80,
      height: 0,
      margin: 3,
      fields: [
        'logo',
        'business',
        'meta',
        'items',
        'discount',
        'tax',
        'payments',
        'footer',
      ],
    },
    closure: {
      format: 'roll',
      width: 80,
      height: 0,
      margin: 3,
      fields: ['identity', 'sales'],
    },
  };
  ticketPrinterName = '';
  connection = 'system';
  printers: WxOpcion[] = [];
  html: SafeHtml = '';
  busy = false;
  error = '';
  saved = false;
  readonly documentOptions = [
    { valor: 'sale', etiqueta: 'Ticket de venta' },
    { valor: 'closure', etiqueta: 'Corte de caja' },
  ];
  readonly formats = [
    { valor: 'roll', etiqueta: 'Rollo térmico · alto automático' },
    { valor: 'sheet', etiqueta: 'Hoja · alto fijo' },
    { valor: 'label', etiqueta: 'Etiqueta · alto fijo' },
  ];
  readonly sizes = [
    { valor: 58, etiqueta: '58 mm' },
    { valor: 70, etiqueta: '70 mm' },
    { valor: 76, etiqueta: '76 mm' },
    { valor: 80, etiqueta: '80 mm' },
    { valor: 112, etiqueta: '112 mm' },
    { valor: 210, etiqueta: 'A4 · 210 × 297 mm' },
    { valor: 0, etiqueta: 'Personalizado' },
  ];
  readonly connections = [
    { valor: 'system', etiqueta: 'Impresora del sistema' },
    { valor: 'usb', etiqueta: 'USB' },
    { valor: 'network', etiqueta: 'Wi-Fi / Ethernet' },
    { valor: 'bluetooth', etiqueta: 'Bluetooth · controlador de Windows' },
  ];
  preset = 80;
  get profile() {
    return this.documents[this.doc];
  }
  get available() {
    return (
      this.doc === 'sale'
        ? [
            'logo',
            'business',
            'meta',
            'items',
            'discount',
            'tax',
            'payments',
            'footer',
          ]
        : [
            'identity',
            'sales',
            'payments',
            'cash',
            'refunds',
            'discount',
            'tax',
            'declaration',
            'signature',
          ]
    ).map((key) => ({ key, label: labels[key] }));
  }
  trackField(_i: number, f: { key: string }) {
    return f.key;
  }
  async ngOnInit() {
    try {
      const [pr, cfg] = await Promise.all([
        this.api.listPrinters(),
        this.api.getDeviceConfig(),
      ]);
      this.printers = [
        { valor: '', etiqueta: 'Predeterminada del sistema' },
        ...(pr?.data ?? []).map((p: any) => ({
          valor: p.name,
          etiqueta: p.displayName || p.name,
        })),
      ];
      const printer = cfg?.data?.printer ?? {};
      this.ticketPrinterName = printer.ticketPrinterName || '';
      this.connection = printer.connection || 'system';
      for (const d of ['sale', 'closure'])
        if (printer.documents?.[d])
          this.documents[d] = structuredClone(printer.documents[d]);
      this.selectDocument();
    } catch (e: any) {
      this.error = e.message || 'No se pudo leer la configuración.';
    }
  }
  ngOnDestroy() {
    clearTimeout(this.timer);
    this.revision++;
  }
  selectDocument() {
    this.preset = this.sizes.some((s) => s.valor === this.profile.width)
      ? this.profile.width
      : 0;
    this.changed();
  }
  selectSize() {
    if (this.preset) {
      this.profile.width = this.preset;
      if (this.preset === 210) {
        this.profile.format = 'sheet';
        this.profile.height = 297;
      }
    }
    this.changed();
  }
  selectFormat() {
    this.profile.height =
      this.profile.format === 'roll' ? 0 : this.profile.height || 100;
    this.changed();
  }
  toggle(key: string, on: boolean) {
    this.profile.fields = on
      ? [...this.profile.fields, key]
      : this.profile.fields.filter((k) => k !== key);
    this.changed();
  }
  move(key: string, delta: number) {
    const f = this.profile.fields,
      i = f.indexOf(key),
      j = i + delta;
    if (i < 0 || j < 0 || j >= f.length) return;
    [f[i], f[j]] = [f[j], f[i]];
    this.changed();
  }
  label(key: string) {
    return labels[key];
  }
  changed() {
    this.saved = false;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.preview(), 180);
  }
  async preview() {
    const rev = ++this.revision;
    try {
      const r = await this.api.ticketPreview({
        document: this.doc,
        sample: true,
        profile: structuredClone(this.profile),
      });
      if (rev !== this.revision) return;
      if (!r.success) throw Error(r.error);
      this.html = this.sanitizer.bypassSecurityTrustHtml(r.data.html);
      this.error = '';
    } catch (e: any) {
      if (rev === this.revision) this.error = e.message;
    }
  }
  async save() {
    this.busy = true;
    this.error = '';
    try {
      for (const document of ['sale', 'closure']) {
        const v = await this.api.ticketPreview({
          document,
          sample: true,
          profile: this.documents[document],
        });
        if (!v?.success) throw Error(v?.error || 'Formato inválido.');
      }
      const cfg = (await this.api.getDeviceConfig())?.data ?? {};
      const r = await this.api.setDeviceConfig({
        ...cfg,
        printer: {
          ...cfg.printer,
          ticketPrinterName: this.ticketPrinterName,
          connection: this.connection,
          documents: structuredClone(this.documents),
        },
      });
      if (!r?.success) throw Error(r?.error || 'No se pudo guardar.');
      this.saved = true;
      await this.preview();
    } catch (e: any) {
      this.error = e.message;
    } finally {
      this.busy = false;
    }
  }
  async test() {
    this.busy = true;
    try {
      const r = await this.api.ticketPrintDocument({
        document: this.doc,
        sample: true,
        profile: structuredClone(this.profile),
        printerName: this.ticketPrinterName,
      });
      if (!r?.success) throw Error(r?.error || 'No se pudo imprimir.');
    } catch (e: any) {
      this.error = e.message;
    } finally {
      this.busy = false;
    }
  }
}
