import { Component, OnInit } from '@angular/core';
import { CommonModule, NgIf } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ConfigDrawerService } from '../config-drawer.service';
import Swal from 'sweetalert2';

@Component({
    selector: 'app-negocio-panel',
    standalone: true,
    imports: [CommonModule, FormsModule, NgIf],
    templateUrl: './negocio-panel.component.html',
    styleUrls: ['../panel-controls.css']
})
export class NegocioPanelComponent implements OnInit {
    private get api() { return (window as any).electronAPI; }

    form = { business_name: '', rfc: '', address: '', phone: '', ticket_footer: '' };
    cargando = false;
    guardando = false;

    constructor(private drawer: ConfigDrawerService) {}

    async ngOnInit() {
        this.cargando = true;
        try {
            const cfg = await this.api?.getConfig?.();
            const c = cfg?.data ?? cfg ?? {};
            this.form = {
                business_name: c.business_name ?? c.nombre ?? '',
                rfc: c.rfc ?? '',
                address: c.address ?? '',
                phone: c.phone ?? '',
                ticket_footer: c.ticket_footer ?? ''
            };
        } catch {
            /* sin datos: formulario vacío */
        } finally {
            this.cargando = false;
        }
    }

    async save() {
        if (!this.form.business_name.trim()) {
            await Swal.fire({ icon: 'warning', title: 'Falta el nombre del negocio' });
            return;
        }
        this.guardando = true;
        try {
            const res = await this.api?.updateBusinessConfig?.({
                business_name: this.form.business_name.trim(),
                rfc: this.form.rfc.trim().toUpperCase() || null,
                address: this.form.address.trim() || null,
                phone: this.form.phone.trim() || null,
                ticket_footer: this.form.ticket_footer.trim() || null
            });
            if (!res?.success) throw new Error(res?.error || 'No se pudo guardar.');
            await Swal.fire({ icon: 'success', title: 'Datos guardados', timer: 1200, showConfirmButton: false });
            this.drawer.requestClose();
        } catch (e: any) {
            await Swal.fire({ icon: 'error', title: 'Error', text: e?.message || 'No se pudo guardar.' });
        } finally {
            this.guardando = false;
        }
    }
}
