import { Component, OnInit } from '@angular/core';
import { NgIf } from '@angular/common';
import * as QRCode from 'qrcode';
import Swal from 'sweetalert2';

@Component({
  selector: 'app-descarga-app-panel',
  standalone: true,
  imports: [NgIf],
  templateUrl: './descarga-app.component.html',
  styleUrls: ['./descarga-app.component.css']
})
export class DescargaAppPanel implements OnInit {
  // URL de descarga del app del dueno. Cambiala por tu link de Play Store
  // o el link/APK que te da EAS (eas build -p android --profile preview).
  readonly url = 'https://play.google.com/store/apps/details?id=com.wybix.owner';
  qrDataUrl: string | null = null;
  loading = true;

  async ngOnInit() {
    try {
      this.qrDataUrl = await QRCode.toDataURL(this.url, {
        width: 320, margin: 2, color: { dark: '#0F2A3F', light: '#FFFFFF' }
      });
    } catch { /* noop */ }
    finally { this.loading = false; }
  }

  async copiar() {
    try {
      await navigator.clipboard.writeText(this.url);
      await Swal.fire({ icon: 'success', title: 'Enlace copiado', timer: 1200, showConfirmButton: false });
    } catch { /* noop */ }
  }
}
