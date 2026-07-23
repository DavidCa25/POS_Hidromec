import { Component, OnInit, OnDestroy, HostListener, Type } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Subscription } from 'rxjs';
import { CONFIG_SECTIONS, ConfigSection, ConfigTile } from './config-tiles';
import { ConfigDrawerService } from '../config-drawer.service';
import { LicenseService } from '../../services/license.service';

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

    // Tiles que solo aplican con licencia MULTICAJA.
    private readonly tilesMulticaja = new Set<string>(['cajas']);

    constructor(private drawer: ConfigDrawerService, private license: LicenseService) {}

    get activeComponent(): Type<unknown> | null {
        return this.activeTile?.component ?? null;
    }

    async ngOnInit() {
        this.sub = this.drawer.close$.subscribe(() => this.cerrar());
        await this.license.cargarEstado();
        this.aplicarPlan();
        await this.cargarEstados();
    }

    // Si NO es multicaja, oculta los mosaicos de multicaja (y secciones vacías).
    private aplicarPlan() {
        if (this.license.permiteMulticaja) { this.sections = CONFIG_SECTIONS; return; }
        this.sections = CONFIG_SECTIONS
            .map(sec => ({ ...sec, tiles: sec.tiles.filter(t => !this.tilesMulticaja.has(t.id)) }))
            .filter(sec => sec.tiles.length > 0);
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