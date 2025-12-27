import { Component, OnInit } from '@angular/core';
import { Router, RouterOutlet } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { NgIf, NgFor } from '@angular/common';
import Swal from 'sweetalert2';

type SerialPortItem = {
  path: string;
  manufacturer?: string;
  serialNumber?: string;
  vendorId?: string;
  productId?: string;
};

type PrinterItem = {
  name: string;
  displayName?: string;
  isDefault?: boolean;
  description?: string;
};

@Component({
  selector: 'app-configuration',
  templateUrl: './configurationApp.html',
  styleUrls: ['./configurationApp.css'],
  standalone: true,
  imports: [RouterOutlet, FormsModule, NgIf, NgFor]
})
export class ConfigurationApp implements OnInit {
  serialPorts: SerialPortItem[] = [];
  printers: PrinterItem[] = [];

  scannerEnabled = false;
  scannerPath = '';
  scannerBaudRate = 9600;

  ticketPrinterName = '';

  loadingDevices = false;

  constructor(private router: Router) {}

  async ngOnInit() {
    await this.loadAll();
  }

  async loadAll() {
    this.loadingDevices = true;
    try {
      const cfgRs = await (window as any).electronAPI.getDeviceConfig();
      const cfg = cfgRs?.data;

      this.scannerEnabled = !!cfg?.scanner?.enabled;
      this.scannerPath = cfg?.scanner?.path || '';
      this.scannerBaudRate = Number(cfg?.scanner?.baudRate || 9600);

      this.ticketPrinterName = cfg?.printer?.ticketPrinterName || '';

      await this.refreshDevices();
    } catch (e:any) {
      console.error(e);
      Swal.fire({ icon: 'error', title: 'Error', text: 'No se pudo cargar la configuración.' });
    } finally {
      this.loadingDevices = false;
    }
  }

  async refreshDevices() {
    const portsRs = await (window as any).electronAPI.listSerialPorts();
    this.serialPorts = Array.isArray(portsRs?.data) ? portsRs.data : [];

    const printersRs = await (window as any).electronAPI.listPrinters();
    this.printers = Array.isArray(printersRs?.data) ? printersRs.data : [];
  }

  portLabel(p: SerialPortItem) {
    const extra = [p.manufacturer, p.vendorId && p.productId ? `${p.vendorId}:${p.productId}` : '']
      .filter(Boolean).join(' • ');
    return extra ? `${p.path} — ${extra}` : p.path;
  }

  async save() {
    try {
      const payload = {
        scanner: {
          enabled: this.scannerEnabled,
          path: this.scannerPath,
          baudRate: this.scannerBaudRate
        },
        printer: {
          ticketPrinterName: this.ticketPrinterName
        }
      };

      const rs = await (window as any).electronAPI.setDeviceConfig(payload);

      if (rs?.success) {
        Swal.fire({ icon: 'success', title: 'Listo', text: 'Configuración guardada.' });
      } else {
        Swal.fire({ icon: 'error', title: 'Error', text: rs?.error || 'No se pudo guardar.' });
      }
    } catch (e:any) {
      console.error(e);
      Swal.fire({ icon: 'error', title: 'Error', text: 'Ocurrió un error al guardar.' });
    }
  }
}
