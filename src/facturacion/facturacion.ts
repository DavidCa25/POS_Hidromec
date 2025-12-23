import { Component, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { CommonModule } from '@angular/common';

type BusinessConfig = {
  id?: number;
  business_name: string;
  address?: string | null;
  phone?: string | null;
  rfc?: string | null;

  fiscal_name?: string | null;
  fiscal_zip?: string | null;
  fiscal_regime?: string | null;

  invoicing_enabled?: boolean;
  invoicing_provider?: string | null;

  updated_at?: string | null;
};

@Component({
  selector: 'app-facturacion',
  standalone: true,
  templateUrl: './facturacion.html',
  imports: [FormsModule, CommonModule],
  styleUrls: ['./facturacion.css']
})
export class Facturacion implements OnInit {
  constructor(private router: Router) {}

  cargando = true;
  guardando = false;
  errorMsg: string | null = null;
  okMsg: string | null = null;

  config: BusinessConfig = {
    business_name: '',
    address: null,
    phone: null,
    rfc: null,
    fiscal_name: null,
    fiscal_zip: null,
    fiscal_regime: null,
    invoicing_enabled: false,
    invoicing_provider: null
  };

  async ngOnInit() {
    await this.cargarConfig();
  }

  private normalizeRow(row: any): BusinessConfig {
    const x = row ?? {};
    return {
      id: x.id,
      business_name: String(x.business_name ?? x.businessName ?? '').trim(),
      address: x.address ?? null,
      phone: x.phone ?? null,
      rfc: x.rfc ?? null,

      fiscal_name: x.fiscal_name ?? x.fiscalName ?? null,
      fiscal_zip: x.fiscal_zip ?? x.fiscalZip ?? null,
      fiscal_regime: x.fiscal_regime ?? x.fiscalRegime ?? null,

      invoicing_enabled: Boolean(x.invoicing_enabled ?? x.invoicingEnabled ?? false),
      invoicing_provider: x.invoicing_provider ?? x.invoicingProvider ?? null,

      updated_at: x.updated_at ?? null
    };
  }

  async cargarConfig() {
    this.cargando = true;
    this.errorMsg = null;
    this.okMsg = null;

    const api = (window as any).electronAPI;
    if (!api?.getBusinessConfig) {
      this.errorMsg = 'No disponible: electronAPI.getBusinessConfig no existe.';
      this.cargando = false;
      return;
    }

    try {
      const res = await api.getBusinessConfig();
      if (!res?.success) throw new Error(res?.error || 'No se pudo cargar la configuración.');

      const row = Array.isArray(res.data) ? res.data[0] : (res.data?.[0] ?? res.data);
      this.config = this.normalizeRow(row);

      if (!this.config.business_name) this.config.business_name = '';
    } catch (err: any) {
      this.errorMsg = err?.message || String(err);
    } finally {
      this.cargando = false;
    }
  }

  limpiarMensajes() {
    this.errorMsg = null;
    this.okMsg = null;
  }

  get puedeGuardar(): boolean {
    return !this.guardando && String(this.config.business_name ?? '').trim().length > 0;
  }

  async guardar() {
    this.limpiarMensajes();

    const businessName = String(this.config.business_name ?? '').trim();
    if (!businessName) {
      this.errorMsg = 'El nombre del negocio es obligatorio.';
      return;
    }

    const api = (window as any).electronAPI;
    if (!api?.updateBusinessConfig) {
      this.errorMsg = 'No disponible: electronAPI.updateBusinessConfig no existe.';
      return;
    }

    this.guardando = true;

    try {
      const payload = {
        business_name: businessName,
        address: this.config.address ? String(this.config.address).trim() : null,
        phone: this.config.phone ? String(this.config.phone).trim() : null,
        rfc: this.config.rfc ? String(this.config.rfc).trim().toUpperCase() : null,

        fiscal_name: this.config.fiscal_name ? String(this.config.fiscal_name).trim() : null,
        fiscal_zip: this.config.fiscal_zip ? String(this.config.fiscal_zip).trim() : null,
        fiscal_regime: this.config.fiscal_regime ? String(this.config.fiscal_regime).trim() : null,

        invoicing_enabled: this.config.invoicing_enabled ? 1 : 0,
        invoicing_provider: this.config.invoicing_provider ? String(this.config.invoicing_provider).trim() : null
      };

      const res = await api.updateBusinessConfig(payload);
      if (!res?.success) throw new Error(res?.error || 'No se pudo guardar la configuración.');

      await this.cargarConfig();
      this.okMsg = 'Configuración guardada.';
    } catch (err: any) {
      this.errorMsg = err?.message || String(err);
    } finally {
      this.guardando = false;
    }
  }
}
