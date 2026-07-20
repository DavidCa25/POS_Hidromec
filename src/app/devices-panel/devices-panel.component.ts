import { Component, OnInit } from '@angular/core';
import { CommonModule, NgIf, NgFor } from '@angular/common';
import { FormsModule } from '@angular/forms';
import Swal from 'sweetalert2';
import { ConfigDrawerService } from '../config-drawer.service';

type SerialPortItem = { path: string; manufacturer?: string; vendorId?: string; productId?: string; };
type ScanConx = 'teclado' | 'usb' | 'bluetooth';
type DrawerConx = 'impresora' | 'usb' | 'bluetooth';

@Component({
  selector: 'app-devices-panel',
  standalone: true,
  imports: [CommonModule, FormsModule, NgIf, NgFor],
  templateUrl: './devices-panel.component.html',
  styleUrls: ['../panel-controls.css']
})
export class DevicesPanelComponent implements OnInit {
  serialPorts: SerialPortItem[] = [];

  // Scanner
  scannerConx: ScanConx = 'teclado';
  scannerPath = '';
  scannerBaudRate = 9600;

  // Cajon
  drawerEnabled = false;
  drawerConx: DrawerConx = 'impresora';
  drawerPath = '';
  drawerBaudRate = 9600;
  drawerPulseMs = 120;
  drawerPin = 0;
  drawerOpenOnPayment = false;

  // Impresora configurada (solo lectura aqui; se elige en "Impresora de tickets")
  ticketPrinterName = '';

  loadingDevices = false;
  busyTestDrawer = false;

  opcionesBaudrate = [9600, 115200];
  opcionesPin = [0, 1];

  // Menus de los div-selects (sin <select>)
  menu = '';
  toggle(m: string) { this.menu = this.menu === m ? '' : m; }

  constructor(private drawer: ConfigDrawerService) {}
  async ngOnInit() { await this.loadAll(); }

  get scanConxLabel() {
    return this.scannerConx === 'teclado' ? 'Automatico (USB / teclado)'
      : this.scannerConx === 'usb' ? 'Puerto serial (COM)' : 'Bluetooth';
  }
  get drawerConxLabel() {
    return this.drawerConx === 'impresora' ? 'Conectado a la impresora'
      : this.drawerConx === 'usb' ? 'Cable / Serial (COM)' : 'Bluetooth';
  }
  get impresoraLabel() {
    return this.ticketPrinterName || '(sin impresora configurada)';
  }
  get nombrePuertoCajon() {
    if (!this.drawerPath) return '— Selecciona el puerto —';
    const p = this.serialPorts.find(x => x.path === this.drawerPath);
    return p ? this.portLabel(p) : this.drawerPath;
  }
  get nombrePuertoScanner() {
    if (!this.scannerPath) return '— Selecciona el puerto —';
    const p = this.serialPorts.find(x => x.path === this.scannerPath);
    return p ? this.portLabel(p) : this.scannerPath;
  }
  // ¿Se puede probar el cajon en el modo actual?
  get puedeProbar() {
    if (this.drawerConx === 'impresora') return !!this.ticketPrinterName;
    if (this.drawerConx === 'usb') return !!this.drawerPath;
    return false;
  }

  setScanConx(v: ScanConx) {
    if (v === 'bluetooth') { this.avisoProximamente('bluetooth'); this.menu = ''; return; }
    this.scannerConx = v; this.menu = '';
  }
  setDrawerConx(v: DrawerConx) {
    if (v === 'bluetooth') { this.avisoProximamente('bluetooth'); this.menu = ''; return; }
    this.drawerConx = v; this.menu = '';
  }
  setScanPort(p: string) { this.scannerPath = p; this.menu = ''; }
  setDrawerPort(p: string) { this.drawerPath = p; this.menu = ''; }
  setDrawerBaud(v: number) { this.drawerBaudRate = v; this.menu = ''; }
  setPin(v: number) { this.drawerPin = v; this.menu = ''; }

  private avisoProximamente(_v: string) {
    Swal.fire({ icon: 'info', title: 'Bluetooth: proximamente', text: 'Por ahora conecta el dispositivo por cable (USB) o a la impresora. El soporte Bluetooth llegara en una actualizacion.' });
  }

  async loadAll() {
    this.loadingDevices = true;
    try {
      const cfgRs = await (window as any).electronAPI.getDeviceConfig();
      const cfg = cfgRs?.data || {};

      this.scannerConx = (cfg.scanner?.conexion as ScanConx) ?? (cfg.scanner?.enabled ? 'usb' : 'teclado');
      this.scannerPath = cfg.scanner?.path || '';
      this.scannerBaudRate = Number(cfg.scanner?.baudRate || 9600);

      this.drawerEnabled = !!cfg.drawer?.enabled;
      this.drawerConx = (cfg.drawer?.conexion as DrawerConx) ?? 'impresora';
      this.drawerPath = cfg.drawer?.path || '';
      this.drawerBaudRate = Number(cfg.drawer?.baudRate || 9600);
      this.drawerPulseMs = Number(cfg.drawer?.pulseMs || 120);
      this.drawerPin = Number(cfg.drawer?.pin ?? 0);
      this.drawerOpenOnPayment = !!cfg.drawer?.openOnPayment;

      this.ticketPrinterName = cfg.printer?.ticketPrinterName || cfg.printer?.name || '';

      await this.refreshDevices();
    } catch {
      Swal.fire({ icon: 'error', title: 'Error', text: 'No se pudo cargar la configuracion.' });
    } finally { this.loadingDevices = false; }
  }

  async refreshDevices() {
    const api = (window as any).electronAPI;
    if (!api?.listSerialPorts) return;
    const rs = await api.listSerialPorts();
    this.serialPorts = Array.isArray(rs?.data) ? rs.data : [];
  }

  portLabel(p: SerialPortItem) {
    const extra = [p.manufacturer, p.vendorId && p.productId ? `${p.vendorId}:${p.productId}` : ''].filter(Boolean).join(' - ');
    return extra ? `${p.path} (${extra})` : p.path;
  }

  async testDrawer() {
    const api = (window as any).electronAPI;
    if (!api?.openCashDrawer) return;
    if (this.drawerConx === 'impresora' && !this.ticketPrinterName) {
      await Swal.fire({ icon: 'warning', title: 'Falta la impresora', text: 'Configura primero la impresora en "Impresora de tickets".' });
      return;
    }
    if (this.drawerConx === 'usb' && !this.drawerPath) {
      await Swal.fire({ icon: 'warning', title: 'Falta el puerto', text: 'Elige el puerto del cajon primero.' });
      return;
    }
    try {
      this.busyTestDrawer = true;
      const res = await api.openCashDrawer({
        conexion: this.drawerConx,
        printerName: this.ticketPrinterName,
        portPath: this.drawerPath,
        baudRate: this.drawerBaudRate,
        pulseMs: this.drawerPulseMs,
        pin: this.drawerPin
      });
      if (res?.success) await Swal.fire({ icon: 'success', title: 'Cajon abierto', timer: 1200, showConfirmButton: false });
      else await Swal.fire({ icon: 'error', title: 'No se pudo abrir', text: res?.error || 'Revisa la conexion.' });
    } finally { this.busyTestDrawer = false; }
  }

  async save() {
    try {
      const api = (window as any).electronAPI;
      const payload = {
        scanner: { conexion: this.scannerConx, enabled: this.scannerConx === 'usb', path: this.scannerPath, baudRate: this.scannerBaudRate },
        drawer: { conexion: this.drawerConx, enabled: this.drawerEnabled, path: this.drawerPath, baudRate: this.drawerBaudRate, pulseMs: this.drawerPulseMs, pin: this.drawerPin, openOnPayment: this.drawerOpenOnPayment }
      };
      const rs = await api.setDeviceConfig(payload);
      if (rs?.success) { await Swal.fire({ icon: 'success', title: 'Listo', text: 'Dispositivos guardados.' }); this.drawer.requestClose(); }
      else Swal.fire({ icon: 'error', title: 'Error', text: rs?.error || 'No se pudo guardar.' });
    } catch { Swal.fire({ icon: 'error', title: 'Error', text: 'Ocurrio un error al guardar.' }); }
  }
}
