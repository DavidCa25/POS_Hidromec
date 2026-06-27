import { Component, OnInit } from '@angular/core';
import { NgIf, NgFor, DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import Swal from 'sweetalert2';
import { ConfigDrawerService } from '../config-drawer.service';

interface BackupFile {
    name: string;
    path: string;
    sizeMB: number;
    modified: string;
}

@Component({
    selector: 'app-backups-panel',
    standalone: true,
    imports: [NgIf, NgFor, FormsModule, DatePipe],
    templateUrl: './backups-panel.component.html',
    styleUrls: ['./backups-panel.component.css']
})
export class BackupsPanelComponent implements OnInit {
    // Export / Import manual
    busyExport = false;
    busyImport = false;

    // Respaldo automatico
    enabled = false;
    time = '23:00';
    retentionDays = 14;
    folder = 'C:\\POS_Backups';
    copyToFolder = '';

    lastBackupAt: string | null = null;
    lastStatus: string | null = null;
    lastError: string | null = null;

    backups: BackupFile[] = [];

    busySave = false;
    busyRun = false;
    loading = false;

    constructor(private drawer: ConfigDrawerService) {}

    private get api() {
        return (window as any).electronAPI;
    }

    async ngOnInit() {
        await this.cargarBackupConfig();
    }

    // ===== Export / Import manual =====
    async exportDb() {
        try {
            this.busyExport = true;
            const res = await this.api.exportDatabase();
            if (res?.success) {
                Swal.fire({ icon: 'success', title: 'Exportación lista', text: `Archivo: ${res.path}` });
            } else if (!res?.canceled) {
                Swal.fire({ icon: 'error', title: 'Error', text: res?.error || 'No se pudo exportar' });
            }
        } finally {
            this.busyExport = false;
        }
    }

    async importDb() {
        try {
            this.busyImport = true;
            const res = await this.api.importDatabase();
            if (res?.success) {
                Swal.fire({
                    icon: 'success',
                    title: 'Importación completada',
                    text: res?.requiresRestart ? 'Reinicia la app para aplicar cambios.' : 'Listo.'
                });
                this.drawer.requestClose();
            } else if (!res?.canceled) {
                Swal.fire({ icon: 'error', title: 'Error', text: res?.error || 'No se pudo importar' });
            }
        } finally {
            this.busyImport = false;
        }
    }

    // ===== Respaldo automatico =====
    async cargarBackupConfig() {
        this.loading = true;
        try {
            const cfgRs = await this.api?.backupGetConfig?.();
            const c = cfgRs?.data;
            if (c) {
                this.enabled = !!c.enabled;
                this.time = c.time || '23:00';
                this.retentionDays = Number(c.retentionDays ?? 14);
                this.copyToFolder = c.copyToFolder || '';
                this.lastBackupAt = c.lastBackupAt || null;
                this.lastStatus = c.lastStatus || null;
                this.lastError = c.lastError || null;
            }
            await this.cargarLista();
        } catch (e) {
            console.error('[BACKUP] cargar config:', e);
        } finally {
            this.loading = false;
        }
    }

    async cargarLista() {
        try {
            const rs = await this.api?.backupList?.();
            this.backups = rs?.data ?? [];
        } catch {
            this.backups = [];
        }
    }

    async guardarBackup() {
        if (!this.api?.backupSetConfig) {
            await Swal.fire({ icon: 'error', title: 'No disponible', text: 'Falta backupSetConfig en la app.' });
            return;
        }

        if (!Number.isFinite(this.retentionDays) || this.retentionDays < 1) {
            await Swal.fire({ icon: 'warning', title: 'Retención inválida', text: 'Indica cuántos días conservar (mínimo 1).' });
            return;
        }

        this.busySave = true;
        try {
            const rs = await this.api.backupSetConfig({
                enabled: this.enabled,
                time: this.time,
                retentionDays: this.retentionDays,
                folder: 'C:\\POS_Backups',
                copyToFolder: (this.copyToFolder || '').trim()
            });

            if (!rs?.success) {
                await Swal.fire({ icon: 'error', title: 'No se pudo guardar', text: rs?.error || 'Error al guardar.' });
                return;
            }

            await Swal.fire({ icon: 'success', title: 'Guardado', timer: 1100, showConfirmButton: false });
        } catch (e: any) {
            await Swal.fire({ icon: 'error', title: 'Error', text: e?.message || 'Error inesperado.' });
        } finally {
            this.busySave = false;
        }
    }

    async respaldarAhora() {
        if (!this.api?.backupRunNow) {
            await Swal.fire({ icon: 'error', title: 'No disponible', text: 'Falta backupRunNow en la app.' });
            return;
        }

        this.busyRun = true;
        try {
            const rs = await this.api.backupRunNow();
            if (!rs?.success) {
                await Swal.fire({ icon: 'error', title: 'No se pudo respaldar', text: rs?.error || 'Error al generar el respaldo.' });
                return;
            }

            this.lastBackupAt = rs.at || new Date().toISOString();
            this.lastStatus = 'ok';
            this.lastError = null;
            await this.cargarLista();
            await Swal.fire({ icon: 'success', title: 'Respaldo creado', timer: 1200, showConfirmButton: false });
        } catch (e: any) {
            await Swal.fire({ icon: 'error', title: 'Error', text: e?.message || 'Error inesperado.' });
        } finally {
            this.busyRun = false;
        }
    }

    async abrirCarpeta() {
        try {
            await this.api?.backupOpenFolder?.();
        } catch { /* noop */ }
    }
}