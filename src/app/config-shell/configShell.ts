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

    /** Componente del mosaico abierto, ya cargado. */
    activeComponent: Type<unknown> | null = null;
    /** Mientras se descarga el chunk del panel. */
    cargandoPanel = false;

    private statuses: Record<string, Status> = {};
    private sub?: Subscription;

    // Tiles que solo aplican con licencia MULTICAJA. Con las dos dentro, la
    // seccion "MultiCaja" se queda vacia y `aplicarPlan` la elimina entera:
    // una instalacion de una sola caja no ve ni el grupo.
    private readonly tilesMulticaja = new Set<string>(['cajas', 'red-multicaja']);

    constructor(private drawer: ConfigDrawerService, private license: LicenseService) {}

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

    /**
     * Abre el cajon y carga el panel bajo demanda. Si el usuario cambia de
     * mosaico antes de que termine la descarga, el resultado tardio se
     * descarta: solo se muestra el componente del mosaico activo.
     */
    async abrir(tile: ConfigTile) {
        this.activeTile = tile;
        this.activeComponent = null;
        if (!tile.load) return;

        this.cargandoPanel = true;
        try {
            const comp = await tile.load();
            if (this.activeTile === tile) this.activeComponent = comp;
        } catch (e) {
            console.error('No se pudo cargar el panel', tile.id, e);
        } finally {
            if (this.activeTile === tile) this.cargandoPanel = false;
        }
    }

    cerrar() {
        this.activeTile = null;
        this.activeComponent = null;
        this.cargandoPanel = false;
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