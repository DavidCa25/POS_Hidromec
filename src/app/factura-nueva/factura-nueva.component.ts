import { Component, Input, OnInit, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import Swal from 'sweetalert2';
import { CatalogosService, CatalogoItem } from '../../services/catalogos.service';

// Concepto a facturar (viene de una venta o capturado a mano)
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
  // Venta origen (opcional) y conceptos a facturar
  @Input() saleId: number | null = null;
  @Input() conceptos: ConceptoFactura[] = [];

  @Input() receptorRfc?: string | null;
  @Input() receptorNombre?: string | null;
  @Input() receptorRegimen?: string | null;
  @Input() receptorUsoCfdi?: string | null;

  @Output() cerrar = new EventEmitter<void>();
  @Output() timbrada = new EventEmitter<any>();

  receptor: Receptor = {
    rfc: '', razonSocial: '', regimenFiscal: '', usoCfdi: '', zipCode: '', email: ''
  };

  formaPago = '01';   // 01 efectivo
  metodoPago = 'PUE'; // pago en una exhibicion

  regimenes: CatalogoItem[] = [];
  usosCfdi: CatalogoItem[] = [];
  formasPago: CatalogoItem[] = [];
  metodosPago: CatalogoItem[] = [];

  regimenAbierto = false;
  usoAbierto = false;

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
    this.asignarDatosReceptor();
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

  private asignarDatosReceptor() {
    if (this.receptorRfc) {
      this.receptor.rfc = this.receptorRfc;
      this.receptor.razonSocial = this.receptorNombre || '';
      this.receptor.regimenFiscal = this.receptorRegimen || '';
      this.receptor.usoCfdi = this.receptorUsoCfdi || '';
    }
  }

  get regimenLabel(): string {
    const r = this.regimenes.find(x => x.code === this.receptor.regimenFiscal);
    return r ? `${r.code} - ${r.description}` : 'Selecciona regimen';
  }
  get usoLabel(): string {
    const u = this.usosCfdi.find(x => x.code === this.receptor.usoCfdi);
    return u ? `${u.code} - ${u.description}` : 'Selecciona uso de CFDI';
  }

  get subtotal(): number {
    return this.conceptos.reduce((a, c) => a + Number(c.quantity) * Number(c.unitPrice), 0);
  }
  get ivaEstimado(): number {
    return this.conceptos.reduce((a, c) => {
      const base = Number(c.quantity) * Number(c.unitPrice);
      const tasa = c.taxRate != null ? Number(c.taxRate) : 0.16;
      return a + base * tasa;
    }, 0);
  }
  get total(): number {
    return this.subtotal + this.ivaEstimado;
  }

  money(n: number): string {
    return '$' + Number(n || 0).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  private rfcValido(rfc: string): boolean {
    return /^[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}$/.test((rfc || '').trim().toUpperCase());
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
      await Swal.fire({ icon: 'warning', title: 'Sin conceptos', text: 'La factura no tiene productos.' });
      return;
    }

    this.timbrando = true;
    try {
      // 1) Timbra en la Edge Function
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
            quantity: c.quantity,
            unitPrice: c.unitPrice,
            claveProdServ: c.claveProdServ || null,
            claveUnidad: c.claveUnidad || null,
            taxObject: c.taxObject || '02',
            taxRate: c.taxRate != null ? c.taxRate : 0.16,
            discount: 0
          }))
        })
      });
      const out = await res.json();
      if (!out?.success) {
        throw new Error(out?.error || 'No se pudo timbrar la factura.');
      }

      // 2) Guarda la factura en el SQL local
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