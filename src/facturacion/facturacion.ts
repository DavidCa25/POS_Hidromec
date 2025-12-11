import { Component } from '@angular/core';
import { Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { CommonModule } from '@angular/common';

@Component({
    selector: 'app-facturacion',
    standalone: true,
    templateUrl: './facturacion.html',
    imports: [FormsModule, CommonModule],
    styleUrls: ['./facturacion.css']
})
export class Facturacion {
    constructor(private router: Router) { }
    cargando: boolean = true;

    onIframeLoad() {
        this.cargando = false;
    }

}