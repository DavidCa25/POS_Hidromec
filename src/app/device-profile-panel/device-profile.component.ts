import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import Swal from 'sweetalert2';
import { CapabilityService, DeviceProfile } from '../../core';

/**
 * Perfil de ESTE dispositivo: que experiencia abre esta maquina.
 *
 * Vive en device-config.json, no en SQL: dos cajas de la misma sucursal
 * pueden ser una Retail (teclado y scanner) y otra Touch (pantalla tactil)
 * sobre la misma base y el mismo inventario. Cambiarlo no reinstala nada.
 * La pantalla de cliente NO es un perfil: es una capacidad aparte.
 */
@Component({
  selector: 'app-device-profile-panel',
  standalone: true,
  imports: [CommonModule],
  styleUrls: ['../panel-controls.css'],
  template: `
  <div class="panel-content">
    <div class="section-title"><i class="ph ph-devices"></i> Experiencia de esta caja</div>
    <p class="hint" style="margin-bottom:1rem;">Qué pantalla abre "Hacer venta" en esta máquina. Todas las experiencias usan la misma base, el mismo inventario y la misma venta.</p>

    <div class="wx-choice-list" role="radiogroup" aria-label="Experiencia de esta caja">
      <label class="wx-choice" *ngFor="let p of perfiles" [class.is-on]="actual === p.valor">
        <input type="radio" name="deviceProfile" [value]="p.valor" [checked]="actual === p.valor" (change)="elegir(p.valor)" [disabled]="guardando">
        <span class="wx-choice__ic"><i class="ph ph-{{ p.icono }}"></i></span>
        <span class="wx-choice__txt">
          <b>{{ p.titulo }}</b>
          <small>{{ p.desc }}</small>
        </span>
      </label>
    </div>

    <div class="hint" style="margin-top:1rem;">El cambio aplica al instante para esta máquina. Las demás cajas no se ven afectadas.</div>
  </div>
  `
})
export class DeviceProfilePanelComponent implements OnInit {
  private readonly caps = inject(CapabilityService);

  actual: DeviceProfile = 'RETAIL_POS';
  guardando = false;

  readonly perfiles: { valor: DeviceProfile; titulo: string; desc: string; icono: string }[] = [
    { valor: 'RETAIL_POS', titulo: 'Punto de venta Retail', desc: 'Teclado, scanner y folio. La pantalla de venta de siempre.', icono: 'barcode' },
    { valor: 'TOUCH_POS', titulo: 'Punto de venta Touch', desc: 'Pantalla táctil: categorías, productos con imagen y modificadores. Ideal para mostrador de alimentos.', icono: 'hand-tap' },
    { valor: 'BACKOFFICE', titulo: 'Solo administración', desc: 'Esta máquina no vende: inventario, compras, reportes y configuración.', icono: 'desktop' },
  ];

  async ngOnInit() {
    await this.caps.load(true);
    this.actual = this.caps.deviceProfile();
  }

  async elegir(p: DeviceProfile) {
    if (p === this.actual) return;
    this.guardando = true;
    try {
      await this.caps.setDeviceProfile(p);
      this.actual = p;
      const t = this.perfiles.find(x => x.valor === p)?.titulo ?? p;
      await Swal.fire({ icon: 'success', title: `Esta caja ahora es: ${t}`, timer: 1300, showConfirmButton: false });
    } catch (e: any) {
      await Swal.fire({ icon: 'error', title: 'No se pudo guardar', text: e?.message || 'Error.' });
    } finally {
      this.guardando = false;
    }
  }
}
