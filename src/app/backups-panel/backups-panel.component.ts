import { Component } from '@angular/core';
import { NgIf } from '@angular/common';
import Swal from 'sweetalert2';
import { ConfigDrawerService } from '../config-drawer.service';

@Component({
    selector: 'app-backups-panel',
    standalone: true,
    imports: [NgIf],
    templateUrl: './backups-panel.component.html'
})
export class BackupsPanelComponent {
    busyExport = false;
    busyImport = false;

    constructor(private drawer: ConfigDrawerService) {}

    async exportDb() {
        try {
            this.busyExport = true;
            const res = await (window as any).electronAPI.exportDatabase();
            if (res?.success) {
                Swal.fire({ icon: 'success', title: 'Exportación lista', text: `Archivo: ${res.path}` });
            } else if (!res?.canceled) {
                Swal.fire({ icon: 'error', title: 'Error', text: res?.error || 'No se pudo exportar' });
            }
        } finally {
            this.busyExport = false;
        }
    }

    async importDb() {
        try {
            this.busyImport = true;
            const res = await (window as any).electronAPI.importDatabase();
            if (res?.success) {
                Swal.fire({
                    icon: 'success',
                    title: 'Importación completada',
                    text: res?.requiresRestart ? 'Reinicia la app para aplicar cambios.' : 'Listo.'
                });
                this.drawer.requestClose();
            } else if (!res?.canceled) {
                Swal.fire({ icon: 'error', title: 'Error', text: res?.error || 'No se pudo importar' });
            }
        } finally {
            this.busyImport = false;
        }
    }
}