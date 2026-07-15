import { Component, OnInit } from '@angular/core';
import { NgIf } from '@angular/common';
import * as QRCode from 'qrcode';
import Swal from 'sweetalert2';

@Component({
  selector: 'app-pairing-qr',
  standalone: true,
  imports: [NgIf],
  templateUrl: './pairing-qr.component.html',
  styleUrls: ['./pairing-qr.component.css']
})
export class PairingQr implements OnInit {
  qrDataUrl: string | null = null;
  nombre = '';
  loading = true;
  error = '';

  private get api() {
    return (window as any).electronAPI;
  }

  async ngOnInit() {
    await this.generar();
  }

  async generar() {
    this.loading = true;
    this.error = '';
    try {
      const prov = await this.api?.cloudEnsureProvisioned?.();
      if (!prov?.success) {
        this.error = prov?.error || 'No se pudo preparar el negocio en la nube.';
        this.loading = false;
        return;
      }

      const pair = await this.api?.cloudGetPairing?.();
      if (!pair?.success) {
        this.error = pair?.error || 'No se pudo generar el codigo.';
        this.loading = false;
        return;
      }

      this.nombre = pair.payload?.nombre || '';

      // 3) Renderizar el QR a imagen
      this.qrDataUrl = await QRCode.toDataURL(pair.qrText, {
        width: 320,
        margin: 2,
        color: { dark: '#0F2A3F', light: '#FFFFFF' }
      });
    } catch (e: any) {
      this.error = e?.message || 'Error inesperado.';
    } finally {
      this.loading = false;
    }
  }

  async copiarDatos() {
    try {
      const pair = await this.api?.cloudGetPairing?.();
      if (pair?.success) {
        await navigator.clipboard.writeText(pair.qrText);
        await Swal.fire({ icon: 'success', title: 'Datos copiados', timer: 1200, showConfirmButton: false });
      }
    } catch { /* noop */ }
  }
}