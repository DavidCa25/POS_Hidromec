import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import Swal from 'sweetalert2';
import { CatalogoItem, CatalogosService } from '../../services/catalogos.service';

interface FiscalConfig {
  id: number | null;
  rfc: string;
  razon_social: string;
  regimen_fiscal: string;
  codigo_postal: string;
  serie: string | null;
  fiscalapi_issuer_id: string | null;
  csd_registrado: boolean;
}

@Component({
  selector: 'app-facturacion-config',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './facturacion-config.component.html',
  styleUrls: ['./facturacion-config.component.css']
})
export class FacturacionConfig implements OnInit {
  config: FiscalConfig = {
    id: null, rfc: '', razon_social: '', regimen_fiscal: '',
    codigo_postal: '', serie: '', fiscalapi_issuer_id: null, csd_registrado: false
  };

  // Certificados capturados en memoria (no se persisten localmente)
  cerBase64: string | null = null;
  keyBase64: string | null = null;
  csdPassword = '';
  cerNombre = '';
  keyNombre = '';

  guardando = false;
  registrandoCsd = false;

  // Catalogo de regimenes (desde Fiscalapi via backend, cacheado)
  regimenes: CatalogoItem[] = [];
  cargandoRegimenes = true;
  regimenAbierto = false;

  constructor(private catalogos: CatalogosService) {}

  private get api() {
    return (window as any).electronAPI;
  }

  get regimenLabel(): string {
    const r = this.regimenes.find(x => x.code === this.config.regimen_fiscal);
    return r ? `${r.code} - ${r.description}` : 'Selecciona tu regimen';
  }

  async ngOnInit() {
    await this.cargar();
    await this.cargarRegimenes();
  }

  async cargarRegimenes() {
    this.cargandoRegimenes = true;
    try {
      this.regimenes = await this.catalogos.get('SatTaxRegimes');
    } catch {
      this.regimenes = [];
    } finally {
      this.cargandoRegimenes = false;
    }
  }

  seleccionarRegimen(item: CatalogoItem) {
    this.config.regimen_fiscal = item.code;
    this.regimenAbierto = false;
  }

  async cargar() {
    try {
      const res = await this.api?.getFiscalConfig?.();
      if (res?.success && res.data) {
        this.config = { ...this.config, ...res.data };
      }
    } catch {
      // sin config aun
    }
  }

  private rfcValido(rfc: string): boolean {
    const r = (rfc || '').trim().toUpperCase();
    // Persona fisica (13) o moral (12)
    return /^[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}$/.test(r);
  }

  async guardar() {
    const rfc = this.config.rfc.trim().toUpperCase();
    if (!this.rfcValido(rfc)) {
      await Swal.fire({ icon: 'warning', title: 'RFC invalido', text: 'Revisa el RFC del emisor.' });
      return;
    }
    if (!this.config.razon_social.trim() || !this.config.regimen_fiscal || this.config.codigo_postal.length !== 5) {
      await Swal.fire({ icon: 'warning', title: 'Faltan datos', text: 'Completa razon social, regimen y codigo postal (5 digitos).' });
      return;
    }

    this.guardando = true;
    try {
      const res = await this.api?.saveFiscalConfig?.({
        rfc,
        razon_social: this.config.razon_social.trim(),
        regimen_fiscal: this.config.regimen_fiscal,
        codigo_postal: this.config.codigo_postal.trim(),
        serie: this.config.serie?.trim() || null
      });
      if (res?.success) {
        this.config = { ...this.config, ...res.data };
        await Swal.fire({ icon: 'success', title: 'Datos guardados', timer: 1400, showConfirmButton: false });
      } else {
        throw new Error(res?.error || 'No se pudo guardar.');
      }
    } catch (e: any) {
      await Swal.fire({ icon: 'error', title: 'Error', text: e?.message || 'No se pudo guardar.' });
    } finally {
      this.guardando = false;
    }
  }

  onCerSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    this.cerNombre = file.name;
    this.leerBase64(file).then(b64 => { this.cerBase64 = b64; });
  }

  onKeySelected(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    this.keyNombre = file.name;
    this.leerBase64(file).then(b64 => { this.keyBase64 = b64; });
  }

  private leerBase64(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result as string;
        resolve(result.split(',')[1]); // quita el prefijo data:...;base64,
      };
      reader.onerror = () => reject(new Error('No se pudo leer el archivo.'));
      reader.readAsDataURL(file);
    });
  }

  async registrarCertificados() {
    if (!this.config.id) {
      await Swal.fire({ icon: 'warning', title: 'Primero guarda tus datos', text: 'Guarda los datos fiscales antes de subir los certificados.' });
      return;
    }
    if (!this.cerBase64 || !this.keyBase64 || !this.csdPassword) {
      await Swal.fire({ icon: 'warning', title: 'Faltan certificados', text: 'Sube el .cer, el .key y escribe la contrasena del CSD.' });
      return;
    }

    this.registrandoCsd = true;
    try {
      // Llama a la Edge Function (backend con la credencial del PAC).
      // Envia datos del emisor + certificados; recibe el issuerId.
      const endpoint = `${this.catalogos.supabaseUrl}/functions/v1/fiscal-register-issuer`;
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.catalogos.anonKey}`,
          'apikey': this.catalogos.anonKey
        },
        body: JSON.stringify({
          rfc: this.config.rfc,
          razonSocial: this.config.razon_social,
          regimenFiscal: this.config.regimen_fiscal,
          zipCode: this.config.codigo_postal,
          cerBase64: this.cerBase64,
          keyBase64: this.keyBase64,
          password: this.csdPassword,
          existingPersonId: this.config.fiscalapi_issuer_id || undefined
        })
      });
      const out = await res.json();
      if (!out?.success) {
        throw new Error(out?.error || 'No se pudieron registrar los certificados.');
      }

      // Guarda la referencia del emisor en el SQL local (activa "listo para facturar")
      await this.api?.setFiscalIssuerRef?.(out.issuerId);
      this.config.fiscalapi_issuer_id = out.issuerId;
      this.config.csd_registrado = true;

      // Limpia los certificados de memoria una vez registrados
      this.cerBase64 = null; this.keyBase64 = null; this.csdPassword = '';
      this.cerNombre = ''; this.keyNombre = '';

      await Swal.fire({ icon: 'success', title: 'Certificados registrados', text: 'Ya puedes emitir facturas.', timer: 1800, showConfirmButton: false });
    } catch (e: any) {
      await Swal.fire({ icon: 'error', title: 'Error', text: e?.message || 'No se pudieron registrar los certificados.' });
    } finally {
      this.registrandoCsd = false;
    }
  }
}