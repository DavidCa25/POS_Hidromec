import { Component, EventEmitter, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import Swal from 'sweetalert2';
import { LicenseService } from '../../services/license.service';

@Component({
  selector: 'app-activar-licencia',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './activar-licencia.component.html',
  styleUrls: ['./activar-licencia.component.css']
})
export class ActivarLicencia {
  @Output() activada = new EventEmitter<void>();

  clave = '';
  alias = '';
  activando = false;

  constructor(private license: LicenseService) {}

  onClaveInput(v: string) {
    const limpio = v.toUpperCase().replace(/[^A-Z0-9]/g, '');
    const partes: string[] = [];
    if (limpio.length > 0) partes.push(limpio.slice(0, 4));
    if (limpio.length > 4) partes.push(limpio.slice(4, 6));
    if (limpio.length > 6) partes.push(limpio.slice(6, 10));
    if (limpio.length > 10) partes.push(limpio.slice(10, 14));
    this.clave = partes.join('-');
  }

  async activar() {
    const clave = this.clave.trim().toUpperCase();
    if (clave.length < 14) {
      await Swal.fire({ icon: 'warning', title: 'Clave incompleta', text: 'Revisa la clave de licencia.' });
      return;
    }

    this.activando = true;
    try {
      const res = await this.license.activar(clave, this.alias.trim() || undefined);

      if (!res.ok) {
        await Swal.fire({
          icon: res.code === 'LIMIT_REACHED' ? 'warning' : 'error',
          title: res.code === 'LIMIT_REACHED' ? 'Licencia en uso' : 'No se pudo activar',
          text: res.error || 'Revisa la clave e intenta de nuevo.'
        });
        return;
      }

      const plan = this.license.esMulticaja ? 'MultiCaja' : 'MonoCaja';
      await Swal.fire({
        icon: 'success',
        title: 'Licencia activada',
        html: `Wybix <b>${plan}</b><br><small>${this.license.nombreCliente}</small>`,
        confirmButtonText: 'Empezar'
      });
      this.activada.emit();
    } finally {
      this.activando = false;
    }
  }
}