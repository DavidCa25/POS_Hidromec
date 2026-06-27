import { Component } from '@angular/core';
import { CommonModule, NgIf, NgFor } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ConfigDrawerService } from '../config-drawer.service';
import Swal from 'sweetalert2';

@Component({
    selector: 'app-negocio-panel',
    standalone: true,
    imports: [CommonModule, FormsModule, NgIf, NgFor],
    templateUrl: './negocio-panel.component.html',
    styleUrls: ['../panel-controls.css']
})
export class NegocioPanelComponent {
    
    // Variables de formulario
    nombreComercio = '';
    iva = 16;
    whatsappHabilitado = true;
    facturacionHabilitada = false;

    monedas = ['MXN - Peso Mexicano', 'USD - Dólar Estadounidense'];
    monedaSeleccionada = 'MXN - Peso Mexicano';
    monedaOpen = false;
    
    constructor(private drawer: ConfigDrawerService) {}

    seleccionarMoneda(val: string) {
        this.monedaSeleccionada = val;
        this.monedaOpen = false;
    }

    save() {
        Swal.fire({
            icon: 'success',
            title: 'Preferencias guardadas',
            timer: 1200,
            showConfirmButton: false
        });
        this.drawer.requestClose();
    }
}