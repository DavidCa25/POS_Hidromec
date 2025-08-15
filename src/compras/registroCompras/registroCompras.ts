import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

@Component({
  selector: 'app-registro-compras',
  templateUrl: './registroCompras.html',
  styleUrls: ['./registroCompras.css'],
  imports: [
    CommonModule,
    FormsModule,   // <-- Esto es lo importante
  ]
})
export class registroCompras implements OnInit {
  compras: any[] = [];
  filtroTexto: string = '';

  comprasPorFecha: { 
    datee: string, 
    folios: { folioId: string, items: any[] }[] 
  }[] = [];

  comprasFiltradas: { 
    datee: string, 
    folios: { folioId: string, items: any[] }[] 
  }[] = [];


  async ngOnInit() {
    try {
      // 👇 Obtener lista de compras desde Electron
      this.compras = await window.electronAPI.getPurchases();

      console.log("📦 Datos crudos de getPurchase:", this.compras);

      // 👇 Agrupar por fecha (asumiendo que la compra tiene campo `fecha`)
      const agrupadas: { [key: string]: any[] } = {};
      this.compras.forEach(c => {
        const datee = new Date(c.datee).toLocaleDateString();
        if (!agrupadas[datee]) agrupadas[datee] = [];
        agrupadas[datee].push(c);
      });

      // Pasar a array para iterar en HTML
      this.comprasPorFecha = Object.entries(agrupadas).map(([datee, compras]) => {
        // Agrupar compras por purchase_id
        const comprasPorFolio: { [key: number]: any[] } = {};
        compras.forEach(c => {
          if (!comprasPorFolio[c.purchase_id]) comprasPorFolio[c.purchase_id] = [];
          comprasPorFolio[c.purchase_id].push(c);
        });

        // Convertir a array para Angular
        const folios = Object.entries(comprasPorFolio).map(([folioId, items]) => ({
          folioId,
          items
        }));

        return { datee, folios };
      });

      this.comprasFiltradas = this.comprasPorFecha;

      console.log("🗓️ Compras agrupadas por fecha:", this.comprasPorFecha);


    } catch (err) {
      console.error('❌ Error al cargar compras:', err);
    }
  }

  aplicarFiltro() {
    const texto = this.filtroTexto.toLowerCase();
    this.comprasFiltradas = this.comprasPorFecha.filter(grupo =>
      grupo.datee.toLowerCase().includes(texto)
    );
  }
}

// Declarar la API para TypeScript
declare global {
  interface Window {
    electronAPI: {
      getPurchases: () => Promise<any[]>;
    };
  }
}
