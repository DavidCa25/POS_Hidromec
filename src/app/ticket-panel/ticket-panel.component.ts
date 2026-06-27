import { Component, OnInit } from '@angular/core';
import { CommonModule, NgIf, NgFor } from '@angular/common';
import { FormsModule } from '@angular/forms'; 
import Swal from 'sweetalert2';
import { ConfigDrawerService } from '../config-drawer.service';

type PrinterItem = { name: string; displayName?: string; isDefault?: boolean; };

@Component({
    selector: 'app-ticket-panel',
    standalone: true,
    imports: [CommonModule, FormsModule, NgIf, NgFor],
    templateUrl: './ticket-panel.component.html',
    styleUrls: ['../panel-controls.css'] 
})
export class TicketPanelComponent implements OnInit {
    printers: PrinterItem[] = [];
    ticketPrinterName = '';
    
    // --- Variables para los Custom Selects ---
    printerOpen = false;
    
    paperSizes = ['80mm (Recomendado)', '58mm'];
    ticketPaperSize = '80mm (Recomendado)';
    paperSizeOpen = false;
    
    constructor(private drawer: ConfigDrawerService) {}

    async ngOnInit() {
        try {
            const api = (window as any).electronAPI;
            if (api?.listPrinters) {
                const printersRs = await api.listPrinters();
                this.printers = Array.isArray(printersRs?.data) ? printersRs.data : [];
            }
            const cfgRs = await api?.getDeviceConfig?.();
            this.ticketPrinterName = cfgRs?.data?.printer?.ticketPrinterName || '';
        } catch (e) {
            console.error(e);
        }
    }

    // --- Métodos de selección ---
    seleccionarImpresora(nombre: string) {
        this.ticketPrinterName = nombre;
        this.printerOpen = false;
    }

    seleccionarTamano(tamano: string) {
        this.ticketPaperSize = tamano;
        this.paperSizeOpen = false;
    }

    // Retorna el nombre visible de la impresora para la caja principal
    get nombreImpresoraSeleccionada() {
        if (!this.ticketPrinterName) return '(Predeterminada del sistema)';
        const pr = this.printers.find(p => p.name === this.ticketPrinterName);
        return pr ? (pr.displayName || pr.name) : this.ticketPrinterName;
    }

    async save() {
        try {
            const api = (window as any).electronAPI;
            const currentCfg = (await api.getDeviceConfig())?.data || {};

            const payload = {
                ...currentCfg,
                printer: { 
                    ticketPrinterName: this.ticketPrinterName 
                }
            };

            const rs = await api.setDeviceConfig(payload);
            if (rs?.success) {
                await Swal.fire({ icon: 'success', title: 'Listo', text: 'Impresora guardada.', timer: 1200 });
                this.drawer.requestClose();
            } else {
                Swal.fire({ icon: 'error', title: 'Error', text: rs?.error || 'No se pudo guardar.' });
            }
        } catch (e: any) {
            Swal.fire({ icon: 'error', title: 'Error', text: 'Ocurrió un error al guardar.' });
        }
    }
}