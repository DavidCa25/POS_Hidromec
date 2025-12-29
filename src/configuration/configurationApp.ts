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

  // ====== SCANNER (ya lo tienes) ======
  scannerEnabled = false;
  scannerPath = '';
  scannerBaudRate = 9600;

  // ====== CAJÓN (NUEVO) ======
  drawerEnabled = false;
  drawerPath = '';          // 'COM3', 'COM5', etc. vacío = Auto
  drawerBaudRate = 9600;
  drawerPulseMs = 120;      // “duración” que mandamos como parámetro
  drawerPin = 0;            // 0/1 (según el cajón/controlador)
  drawerOpenOnPayment = false;

  // ====== IMPRESORA TICKET (ya lo tienes) ======
  ticketPrinterName = '';

  loadingDevices = false;

  busyExport = false;
  busyImport = false;
  busyTestDrawer = false;

  constructor(private router: Router) {}

  async ngOnInit() {
    await this.loadAll();
  }

  async loadAll() {
    this.loadingDevices = true;
    try {
      const cfgRs = await (window as any).electronAPI.getDeviceConfig();
      const cfg = cfgRs?.data;

      // scanner
      this.scannerEnabled = !!cfg?.scanner?.enabled;
      this.scannerPath = cfg?.scanner?.path || '';
      this.scannerBaudRate = Number(cfg?.scanner?.baudRate || 9600);

      // printer
      this.ticketPrinterName = cfg?.printer?.ticketPrinterName || '';

      // drawer
      this.drawerEnabled = !!cfg?.drawer?.enabled;
      this.drawerPath = cfg?.drawer?.path || '';
      this.drawerBaudRate = Number(cfg?.drawer?.baudRate || 9600);
      this.drawerPulseMs = Number(cfg?.drawer?.pulseMs || 120);
      this.drawerPin = Number(cfg?.drawer?.pin ?? 0);
      this.drawerOpenOnPayment = !!cfg?.drawer?.openOnPayment;

      await this.refreshDevices();
    } catch (e:any) {
      console.error(e);
      Swal.fire({ icon: 'error', title: 'Error', text: 'No se pudo cargar la configuración.' });
    } finally {
      this.loadingDevices = false;
    }
  }

  async refreshDevices() {
    const api = (window as any).electronAPI;
    if (!api?.listSerialPorts || !api?.listPrinters) {
      console.warn('Sin Electron API (ng serve).');
      this.serialPorts = [];
      this.printers = [];
      return;
    }

    const portsRs = await api.listSerialPorts();
    this.serialPorts = Array.isArray(portsRs?.data) ? portsRs.data : [];

    const printersRs = await api.listPrinters();
    this.printers = Array.isArray(printersRs?.data) ? printersRs.data : [];

    // Si ya había un path guardado pero ya no existe, lo dejamos pero avisamos
    if (this.drawerPath && !this.serialPorts.some(p => p.path === this.drawerPath)) {
      console.warn('Drawer path guardado no está en la lista actual:', this.drawerPath);
    }
    if (this.scannerPath && !this.serialPorts.some(p => p.path === this.scannerPath)) {
      console.warn('Scanner path guardado no está en la lista actual:', this.scannerPath);
    }
  }

  portLabel(p: SerialPortItem) {
    const extra = [p.manufacturer, p.vendorId && p.productId ? `${p.vendorId}:${p.productId}` : '']
      .filter(Boolean).join(' • ');
    return extra ? `${p.path} — ${extra}` : p.path;
  }

  async testDrawer() {
    const api = (window as any).electronAPI;

    if (!api || !api.openCashDrawer) {
      console.warn('openCashDrawer no disponible (¿ng serve?)');
      await Swal.fire({
        icon: 'info',
        title: 'Modo demo',
        text: 'No hay conexión con Electron. Solo es simulación visual.',
      });
      return;
    }

    if (!this.drawerEnabled) {
      await Swal.fire({ icon: 'warning', title: 'Cajón desactivado', text: 'Activa el cajón para probarlo.' });
      return;
    }

    if (!this.drawerPath) {
      await Swal.fire({
        icon: 'warning',
        title: 'Selecciona un puerto',
        text: 'Elige un COM específico para poder probarlo.',
      });
      return;
    }

    try {
      this.busyTestDrawer = true;

      const res = await api.openCashDrawer({
        portPath: this.drawerPath,
        baudRate: this.drawerBaudRate,
        pulseMs: this.drawerPulseMs,
        pin: this.drawerPin
      });

      if (res?.success) {
        await Swal.fire({
          icon: 'success',
          title: 'Cajón abierto',
          text: `Comando enviado a ${this.drawerPath}`,
          timer: 1200,
          showConfirmButton: false
        });
      } else {
        await Swal.fire({
          icon: 'error',
          title: 'No se pudo abrir',
          text: res?.error || 'Revisa el puerto/driver del cajón.'
        });
      }
    } catch (e:any) {
      console.error(e);
      await Swal.fire({ icon: 'error', title: 'Error', text: e?.message || 'Ocurrió un error.' });
    } finally {
      this.busyTestDrawer = false;
    }
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
        },
        drawer: {
          enabled: this.drawerEnabled,
          path: this.drawerPath,
          baudRate: this.drawerBaudRate,
          pulseMs: this.drawerPulseMs,
          pin: this.drawerPin,
          openOnPayment: this.drawerOpenOnPayment
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

  async exportDb() {
    try {
      this.busyExport = true;
      const res = await (window as any).electronAPI.exportDatabase();
      if (res?.success) {
        Swal.fire({ icon: 'success', title: 'Exportación lista', text: `Archivo: ${res.path}` });
      } else if (!res?.canceled) {
        Swal.fire({ icon: 'error', title: 'No se pudo exportar', text: res?.error || 'Error' });
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
          text: res?.requiresRestart ? 'Reinicia la app para recargar conexiones.' : 'Listo.'
        });
      } else if (!res?.canceled) {
        Swal.fire({ icon: 'error', title: 'No se pudo importar', text: res?.error || 'Error' });
      }
    } finally {
      this.busyImport = false;
    }
  }
}
