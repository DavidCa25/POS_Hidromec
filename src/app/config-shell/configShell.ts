import { Component, OnInit, OnDestroy, HostListener, Type } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Subscription } from 'rxjs';
import { CONFIG_SECTIONS, ConfigSection, ConfigTile } from './config-tiles';
import { ConfigDrawerService } from '../config-drawer.service';

type Status = 'ok' | 'pending' | 'off' | 'none';

@Component({
    selector: 'app-config-shell',
    standalone: true,
    imports: [CommonModule],
    templateUrl: './configShell.html',
    styleUrls: ['./configShell.css']
})
export class ConfigShell implements OnInit, OnDestroy {
    sections: ConfigSection[] = CONFIG_SECTIONS;
    activeTile: ConfigTile | null = null;

    private statuses: Record<string, Status> = {};
    private sub?: Subscription;

    constructor(private drawer: ConfigDrawerService) {}

    get activeComponent(): Type<unknown> | null {
        return this.activeTile?.component ?? null;
    }

    async ngOnInit() {
        this.sub = this.drawer.close$.subscribe(() => this.cerrar());
        await this.cargarEstados();
    }

    ngOnDestroy() {
        this.sub?.unsubscribe();
    }

    @HostListener('document:keydown.escape')
    onEsc() {
        if (this.activeTile) this.cerrar();
    }

    abrir(tile: ConfigTile) {
        this.activeTile = tile;
    }

    cerrar() {
        this.activeTile = null;
        this.cargarEstados();
    }

    statusOf(tile: ConfigTile): Status {
        if (!tile.statusKey) return 'none';
        return this.statuses[tile.statusKey] || 'none';
    }

    statusLabel(tile: ConfigTile): string {
        switch (this.statusOf(tile)) {
            case 'ok': return 'Configurado';
            case 'pending': return 'Pendiente';
            case 'off': return 'Desactivado';
            default: return '';
        }
    }

    private async cargarEstados() {
        const api = (window as any).electronAPI;

        try {
            const mp = await api?.mpGetConfig?.();
            const d = mp?.data;
            const bk = await api?.backupGetConfig?.();
            this.statuses['mp'] = (d?.hasToken && d?.terminalId) ? 'ok' : 'pending';
            this.statuses['backup'] = bk?.data?.enabled ? 'ok' : 'off';
        } catch { /* noop */ }

        try {
            const dev = await api?.getDeviceConfig?.();
            const c = dev?.data;
            this.statuses['printer'] = c?.printer?.ticketPrinterName ? 'ok' : 'off';
            this.statuses['scanner'] = c?.scanner?.enabled ? 'ok' : 'off';
            this.statuses['drawer'] = c?.drawer?.enabled ? 'ok' : 'off';
        } catch { /* noop */ }
    }
}