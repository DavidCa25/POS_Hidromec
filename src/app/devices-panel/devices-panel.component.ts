import { Component, OnInit } from '@angular/core';
import { CommonModule, NgIf, NgFor } from '@angular/common';
import { FormsModule } from '@angular/forms';
import Swal from 'sweetalert2';
import { ConfigDrawerService } from '../config-drawer.service';

type SerialPortItem = { path: string; manufacturer?: string; vendorId?: string; productId?: string; };

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
    scannerEnabled = false;
    scannerPath = '';
    scannerBaudRate = 9600;

    // Cajón
    drawerEnabled = false;
    drawerPath = '';
    drawerBaudRate = 9600;
    drawerPulseMs = 120;
    drawerPin = 0;
    drawerOpenOnPayment = false;

    loadingDevices = false;
    busyTestDrawer = false;

    // --- Variables para los Custom Selects ---
    opcionesPin = [0, 1];
    opcionesBaudrate = [9600, 115200];

    pinOpen = false;
    drawerPortOpen = false;
    drawerBaudOpen = false;
    scannerEnabledOpen = false;
    scannerPortOpen = false;

    constructor(private drawer: ConfigDrawerService) {}

    async ngOnInit() {
        await this.loadAll();
    }

    // --- Lógica de los Custom Selects ---

    toggleMenu(menu: string) {
        if (!this.drawerEnabled && menu.startsWith('drawer')) return;
        if (!this.drawerEnabled && menu === 'pin') return;
        if (!this.scannerEnabled && menu === 'scannerPort') return;

        this.pinOpen = menu === 'pin' ? !this.pinOpen : false;
        this.drawerPortOpen = menu === 'drawerPort' ? !this.drawerPortOpen : false;
        this.drawerBaudOpen = menu === 'drawerBaud' ? !this.drawerBaudOpen : false;
        this.scannerEnabledOpen = menu === 'scannerEnabled' ? !this.scannerEnabledOpen : false;
        this.scannerPortOpen = menu === 'scannerPort' ? !this.scannerPortOpen : false;
    }

    seleccionarPin(val: number) {
        this.drawerPin = val;
        this.pinOpen = false;
    }

    seleccionarPuertoCajon(path: string) {
        this.drawerPath = path;
        this.drawerPortOpen = false;
    }

    seleccionarBaudrateCajon(val: number) {
        this.drawerBaudRate = val;
        this.drawerBaudOpen = false;
    }

    seleccionarScannerHabilitado(val: boolean) {
        this.scannerEnabled = val;
        this.scannerEnabledOpen = false;
    }

    seleccionarPuertoScanner(path: string) {
        this.scannerPath = path;
        this.scannerPortOpen = false;
    }

    get nombrePuertoCajon() {
        if (!this.drawerPath) return 'Auto (pendiente)';
        const p = this.serialPorts.find(x => x.path === this.drawerPath);
        return p ? this.portLabel(p) : this.drawerPath;
    }

    get nombrePuertoScanner() {
        if (!this.scannerPath) return '— Selecciona —';
        const p = this.serialPorts.find(x => x.path === this.scannerPath);
        return p ? this.portLabel(p) : this.scannerPath;
    }

    // --- Lógica de la Base de Datos ---

    async loadAll() {
        this.loadingDevices = true;
        try {
            const cfgRs = await (window as any).electronAPI.getDeviceConfig();
            const cfg = cfgRs?.data;

            this.scannerEnabled = !!cfg?.scanner?.enabled;
            this.scannerPath = cfg?.scanner?.path || '';
            this.scannerBaudRate = Number(cfg?.scanner?.baudRate || 9600);

            this.drawerEnabled = !!cfg?.drawer?.enabled;
            this.drawerPath = cfg?.drawer?.path || '';
            this.drawerBaudRate = Number(cfg?.drawer?.baudRate || 9600);
            this.drawerPulseMs = Number(cfg?.drawer?.pulseMs || 120);
            this.drawerPin = Number(cfg?.drawer?.pin ?? 0);
            this.drawerOpenOnPayment = !!cfg?.drawer?.openOnPayment;

            await this.refreshDevices();
        } catch (e: any) {
            console.error(e);
            Swal.fire({ icon: 'error', title: 'Error', text: 'No se pudo cargar la configuración.' });
        } finally {
            this.loadingDevices = false;
        }
    }

    async refreshDevices() {
        const api = (window as any).electronAPI;
        if (!api?.listSerialPorts) return;
        
        const portsRs = await api.listSerialPorts();
        this.serialPorts = Array.isArray(portsRs?.data) ? portsRs.data : [];
    }

    portLabel(p: SerialPortItem) {
        const extra = [p.manufacturer, p.vendorId && p.productId ? `${p.vendorId}:${p.productId}` : ''].filter(Boolean).join(' • ');
        return extra ? `${p.path} — ${extra}` : p.path;
    }

    async testDrawer() {
        const api = (window as any).electronAPI;
        if (!api || !api.openCashDrawer) return;

        try {
            this.busyTestDrawer = true;
            const res = await api.openCashDrawer({
                portPath: this.drawerPath,
                baudRate: this.drawerBaudRate,
                pulseMs: this.drawerPulseMs,
                pin: this.drawerPin
            });

            if (res?.success) {
                await Swal.fire({ icon: 'success', title: 'Cajón abierto', timer: 1200, showConfirmButton: false });
            } else {
                await Swal.fire({ icon: 'error', title: 'No se pudo abrir', text: res?.error || 'Revisa el puerto.' });
            }
        } finally {
            this.busyTestDrawer = false;
        }
    }

    async save() {
        try {
            const api = (window as any).electronAPI;
            const currentCfg = (await api.getDeviceConfig())?.data || {};

            const payload = {
                ...currentCfg,
                scanner: {
                    enabled: this.scannerEnabled,
                    path: this.scannerPath,
                    baudRate: this.scannerBaudRate
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

            const rs = await api.setDeviceConfig(payload);
            if (rs?.success) {
                await Swal.fire({ icon: 'success', title: 'Listo', text: 'Dispositivos guardados.' });
                this.drawer.requestClose();
            } else {
                Swal.fire({ icon: 'error', title: 'Error', text: rs?.error || 'No se pudo guardar.' });
            }
        } catch (e: any) {
            console.error(e);
            Swal.fire({ icon: 'error', title: 'Error', text: 'Ocurrió un error al guardar.' });
        }
    }
}