import { Component, Input, OnInit, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import Swal from 'sweetalert2';
import { CatalogosService, CatalogoItem } from '../../services/catalogos.service';

export interface ConceptoFactura {
  description: string;
  quantity: number;
  unitPrice: number;
  claveProdServ?: string | null;
  claveUnidad?: string | null;
  taxObject?: string | null;
  taxRate?: number | null;
}

interface Receptor {
  rfc: string;
  razonSocial: string;
  regimenFiscal: string;
  usoCfdi: string;
  zipCode: string;
  email: string;
}

@Component({
  selector: 'app-factura-nueva',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './factura-nueva.component.html',
  styleUrls: ['./factura-nueva.component.css']
})
export class FacturaNueva implements OnInit {
  @Input() saleId: number | null = null;
  @Input() conceptos: ConceptoFactura[] = [];
  @Output() cerrar = new EventEmitter<void>();
  @Output() timbrada = new EventEmitter<any>();

  // Cuando se abre sin venta, se puede capturar todo a mano o traer una venta
  get modoLibre(): boolean { return this.saleId == null; }

  folioVenta: number | null = null;
  cargandoVenta = false;

  receptor: Receptor = {
    rfc: '', razonSocial: '', regimenFiscal: '', usoCfdi: '', zipCode: '', email: ''
  };

  formaPago = '01';
  metodoPago = 'PUE';

  regimenes: CatalogoItem[] = [];
  usosCfdi: CatalogoItem[] = [];
  formasPago: CatalogoItem[] = [];
  metodosPago: CatalogoItem[] = [];

  regimenAbierto = false;
  usoAbierto = false;
  formaPagoAbierta = false;
  metodoPagoAbierto = false;

  timbrando = false;

  private issuerId: string | null = null;
  private issuerRfc = '';
  private issuerLegalName = '';
  private issuerRegimen = '';
  private expeditionZipCode = '';
  private serie: string | null = null;

  constructor(private catalogos: CatalogosService) {}

  private get api() { return (window as any).electronAPI; }

  async ngOnInit() {
    await this.cargarConfigEmisor();
    await this.cargarCatalogos();
  }

  private async cargarConfigEmisor() {
    try {
      const res = await this.api?.getFiscalConfig?.();
      if (res?.success && res.data) {
        this.issuerId = res.data.fiscalapi_issuer_id;
        this.issuerRfc = res.data.rfc;
        this.issuerLegalName = res.data.razon_social;
        this.issuerRegimen = res.data.regimen_fiscal;
        this.expeditionZipCode = res.data.codigo_postal;
        this.serie = res.data.serie;
      }
    } catch { /* sin config */ }
  }

  private async cargarCatalogos() {
    try {
      const [reg, uso, fp, mp] = await Promise.all([
        this.catalogos.get('SatTaxRegimes'),
        this.catalogos.get('SatCfdiUses'),
        this.catalogos.get('SatPaymentForms'),
        this.catalogos.get('SatPaymentMethods')
      ]);
      this.regimenes = reg;
      this.usosCfdi = uso;
      this.formasPago = fp;
      this.metodosPago = mp;
    } catch { /* offline usa cache */ }
  }

  // ---------- Labels de dropdowns ----------
  get regimenLabel(): string {
    const r = this.regimenes.find(x => x.code === this.receptor.regimenFiscal);
    return r ? `${r.code} - ${r.description}` : 'Selecciona regimen';
  }
  get usoLabel(): string {
    const u = this.usosCfdi.find(x => x.code === this.receptor.usoCfdi);
    return u ? `${u.code} - ${u.description}` : 'Selecciona uso de CFDI';
  }
  get formaPagoLabel(): string {
    const f = this.formasPago.find(x => x.code === this.formaPago);
    return f ? `${f.code} - ${f.description}` : 'Selecciona forma de pago';
  }
  get metodoPagoLabel(): string {
    const m = this.metodosPago.find(x => x.code === this.metodoPago);
    return m ? `${m.code} - ${m.description}` : 'Selecciona metodo de pago';
  }

  // ---------- Conceptos ----------
  agregarConcepto() {
    this.conceptos = [...this.conceptos, {
      description: '', quantity: 1, unitPrice: 0,
      claveProdServ: null, claveUnidad: null, taxObject: '02', taxRate: 0.16
    }];
  }

  quitarConcepto(i: number) {
    this.conceptos = this.conceptos.filter((_, idx) => idx !== i);
  }

  // Trae los productos de una venta existente por folio
  async cargarVenta() {
    const folio = Number(this.folioVenta ?? 0);
    if (!Number.isFinite(folio) || folio <= 0) {
      await Swal.fire({ icon: 'warning', title: 'Folio invalido', text: 'Escribe un folio de venta valido.' });
      return;
    }
    if (!this.api?.getSaleByFolio) {
      await Swal.fire({ icon: 'error', title: 'No disponible', text: 'Falta getSaleByFolio.' });
      return;
    }

    this.cargandoVenta = true;
    try {
      const resp = await this.api.getSaleByFolio(folio);
      if (!resp?.success) throw new Error(resp?.error || 'No se encontro la venta.');

      const details: any[] = resp.data?.details ?? resp.data?.detail ?? resp.data?.rows ?? [];
      if (!details.length) throw new Error('La venta no tiene partidas.');

      this.conceptos = details.map((d: any) => ({
        description: String(d.product_name ?? d.productName ?? d.name ?? `Producto #${d.product_id}`),
        quantity: Number(d.quantity ?? 1),
        unitPrice: Number(d.unitary_price ?? 0),
        claveProdServ: d.clave_prod_serv ?? null,
        claveUnidad: d.clave_unidad ?? null,
        taxObject: d.objeto_impuesto ?? '02',
        taxRate: d.tasa_iva != null ? Number(d.tasa_iva) : 0.16
      }));

      this.saleId = folio;
      await Swal.fire({ icon: 'success', title: `Venta #${folio} cargada`, timer: 1100, showConfirmButton: false });
    } catch (e: any) {
      await Swal.fire({ icon: 'error', title: 'Error', text: e?.message || 'No se pudo cargar la venta.' });
    } finally {
      this.cargandoVenta = false;
    }
  }

  // ---------- Totales ----------
  get subtotal(): number {
    return this.conceptos.reduce((a, c) => a + Number(c.quantity || 0) * Number(c.unitPrice || 0), 0);
  }
  get ivaEstimado(): number {
    return this.conceptos.reduce((a, c) => {
      const base = Number(c.quantity || 0) * Number(c.unitPrice || 0);
      const tasa = c.taxRate != null ? Number(c.taxRate) : 0.16;
      return a + base * tasa;
    }, 0);
  }
  get total(): number { return this.subtotal + this.ivaEstimado; }

  money(n: number): string {
    return '$' + Number(n || 0).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  private rfcValido(rfc: string): boolean {
    return /^[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}$/.test((rfc || '').trim().toUpperCase());
  }

  // Atajo: llenar receptor como publico en general
  usarPublicoGeneral() {
    this.receptor.rfc = 'XAXX010101000';
    this.receptor.razonSocial = 'PUBLICO EN GENERAL';
    this.receptor.regimenFiscal = '616';
    this.receptor.usoCfdi = 'S01';
    this.receptor.zipCode = this.expeditionZipCode;
  }

  async emitir() {
    if (!this.issuerId) {
      await Swal.fire({ icon: 'warning', title: 'Emisor no configurado', text: 'Registra tus certificados en Configuracion antes de facturar.' });
      return;
    }
    const rfc = this.receptor.rfc.trim().toUpperCase();
    if (!this.rfcValido(rfc)) {
      await Swal.fire({ icon: 'warning', title: 'RFC invalido', text: 'Revisa el RFC del receptor.' });
      return;
    }
    if (!this.receptor.razonSocial.trim() || !this.receptor.regimenFiscal || !this.receptor.usoCfdi || this.receptor.zipCode.length !== 5) {
      await Swal.fire({ icon: 'warning', title: 'Faltan datos', text: 'Completa razon social, regimen, uso de CFDI y CP (5 digitos).' });
      return;
    }
    if (this.conceptos.length === 0) {
      await Swal.fire({ icon: 'warning', title: 'Sin conceptos', text: 'Agrega al menos un concepto.' });
      return;
    }
    const invalido = this.conceptos.find(c => !c.description?.trim() || Number(c.quantity) <= 0 || Number(c.unitPrice) < 0);
    if (invalido) {
      await Swal.fire({ icon: 'warning', title: 'Concepto incompleto', text: 'Revisa descripcion, cantidad y precio de los conceptos.' });
      return;
    }

    this.timbrando = true;
    try {
      const endpoint = `${this.catalogos.supabaseUrl}/functions/v1/fiscal-stamp-invoice`;
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.catalogos.anonKey}`,
          'apikey': this.catalogos.anonKey
        },
        body: JSON.stringify({
          issuerId: this.issuerId,
          issuerRfc: this.issuerRfc,
          issuerLegalName: this.issuerLegalName,
          issuerRegimen: this.issuerRegimen,
          expeditionZipCode: this.expeditionZipCode,
          series: this.serie,
          receptor: {
            rfc,
            razonSocial: this.receptor.razonSocial.trim(),
            regimenFiscal: this.receptor.regimenFiscal,
            usoCfdi: this.receptor.usoCfdi,
            zipCode: this.receptor.zipCode.trim(),
            email: this.receptor.email.trim() || null
          },
          formaPago: this.formaPago,
          metodoPago: this.metodoPago,
          items: this.conceptos.map(c => ({
            description: c.description,
            quantity: Number(c.quantity),
            unitPrice: Number(c.unitPrice),
            claveProdServ: c.claveProdServ || null,
            claveUnidad: c.claveUnidad || null,
            taxObject: c.taxObject || '02',
            taxRate: c.taxRate != null ? c.taxRate : 0.16,
            discount: 0
          }))
        })
      });
      const out = await res.json();
      if (!out?.success) throw new Error(out?.error || 'No se pudo timbrar la factura.');

      await this.api?.saveInvoice?.({
        sale_id: this.saleId,
        serie: out.serie,
        folio: out.folio,
        uuid: out.uuid,
        receptor_rfc: rfc,
        receptor_razon_social: this.receptor.razonSocial.trim(),
        receptor_regimen: this.receptor.regimenFiscal,
        receptor_uso_cfdi: this.receptor.usoCfdi,
        receptor_codigo_postal: this.receptor.zipCode.trim(),
        receptor_email: this.receptor.email.trim() || null,
        metodo_pago: this.metodoPago,
        forma_pago: this.formaPago,
        subtotal: this.subtotal,
        descuento: 0,
        iva: this.ivaEstimado,
        total: out.total != null ? out.total : this.total,
        estado: 'timbrada',
        fiscalapi_invoice_id: out.invoiceId,
        xml_content: out.xml
      });

      await Swal.fire({ icon: 'success', title: 'Factura timbrada', html: `Folio fiscal:<br><b>${out.uuid || 'N/D'}</b>`, confirmButtonText: 'Listo' });
      this.timbrada.emit(out);
      this.cerrar.emit();
    } catch (e: any) {
      await Swal.fire({ icon: 'error', title: 'Error al timbrar', text: e?.message || 'No se pudo timbrar la factura.' });
    } finally {
      this.timbrando = false;
    }
  }

  cerrarModal() { this.cerrar.emit(); }
}