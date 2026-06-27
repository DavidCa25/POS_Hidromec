import { Component, OnInit } from '@angular/core';
import { NgIf } from '@angular/common';
import Swal from 'sweetalert2';

@Component({
  selector: 'app-diagnostico-panel',
  standalone: true,
  imports: [NgIf],
  templateUrl: './diagnostico-panel.component.html',
  styleUrls: ['./diagnostico-panel.component.css']
})
export class DiagnosticoPanel implements OnInit {
  logPath = '';
  logSizeMB = 0;

  private get api() {
    return (window as any).electronAPI;
  }

  async ngOnInit() {
    try {
      const rs = await this.api?.logsInfo?.();
      if (rs?.data) {
        this.logPath = rs.data.path || '';
        this.logSizeMB = rs.data.sizeMB || 0;
      }
    } catch { /* noop */ }
  }

  async abrirLogs() {
    try {
      await this.api?.openLogsFolder?.();
    } catch {
      await Swal.fire({ icon: 'error', title: 'No disponible', text: 'No se pudo abrir la carpeta de logs.' });
    }
  }

  async probarLog() {
    try {
      this.api?.logToFile?.('info', 'Prueba de log desde diagnóstico', { ts: new Date().toISOString() });
      await Swal.fire({ icon: 'success', title: 'Registro enviado', text: 'Se escribió una línea de prueba en el log de hoy.', timer: 1300, showConfirmButton: false });
    } catch {
      await Swal.fire({ icon: 'error', title: 'Error', text: 'No se pudo escribir el log de prueba.' });
    }
  }
}