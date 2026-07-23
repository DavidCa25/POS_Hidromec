import { Component, OnInit } from '@angular/core';
import { NgIf, NgFor } from '@angular/common';
import { FormsModule } from '@angular/forms';
import Swal from 'sweetalert2';
import { RegisterService } from '../../services/register.service';
import { LicenseService } from '../../services/license.service';

interface Register {
  id: number;
  code: string;
  name: string;
  is_active: boolean;
  created_at?: string;
}

@Component({
  selector: 'app-registers-panel',
  standalone: true,
  imports: [NgIf, NgFor, FormsModule],
  templateUrl: './register-panel.component.html',
  styleUrls: ['./register-panel.component.css']
})
export class RegistersPanel implements OnInit {
  registers: Register[] = [];
  currentId: number | null = null;

  nuevoNombre = '';
  loading = false;
  busyAdd = false;

  constructor(private registerSvc: RegisterService, public license: LicenseService) {}

  private get api() {
    return (window as any).electronAPI;
  }

  async ngOnInit() {
    await this.cargar();
  }

  async cargar() {
    this.loading = true;
    try {
      const listRs = await this.api?.registersList?.(false);
      this.registers = listRs?.data ?? [];

      const curRs = await this.api?.registerGetCurrent?.();
      this.currentId = curRs?.data?.registerId ?? null;
    } catch (e) {
      console.error('[REGISTERS] cargar:', e);
    } finally {
      this.loading = false;
    }
  }

  esActual(r: Register): boolean {
    return this.currentId === r.id;
  }

  nombreDe(id: number | null): string {
    const r = this.registers.find(x => x.id === id);
    return r ? r.name : 'Caja asignada';
  }

  async elegirCaja(r: Register) {
    if (!r.is_active) {
      await Swal.fire({ icon: 'warning', title: 'Caja inactiva', text: 'Activa la caja antes de asignarla a esta máquina.' });
      return;
    }

    try {
      await this.registerSvc.setCurrent(r.id, r.name);
      this.currentId = r.id;
      await Swal.fire({ icon: 'success', title: `Esta máquina es ${r.name}`, timer: 1200, showConfirmButton: false });
    } catch (e: any) {
      await Swal.fire({ icon: 'error', title: 'Error', text: e?.message || 'No se pudo asignar la caja.' });
    }
  }

  async crearCaja() {
    const name = this.nuevoNombre.trim();
    if (!name) {
      await Swal.fire({ icon: 'warning', title: 'Falta el nombre', text: 'Escribe el nombre de la caja (ej. Caja 2).' });
      return;
    }

    this.busyAdd = true;
    try {
      const rs = await this.api?.registersAdd?.({ name });
      if (!rs?.success) {
        await Swal.fire({ icon: 'error', title: 'No se pudo crear', text: rs?.error || 'Error al crear la caja.' });
        return;
      }
      this.nuevoNombre = '';
      await this.cargar();
      await Swal.fire({ icon: 'success', title: 'Caja creada', timer: 1100, showConfirmButton: false });
    } catch (e: any) {
      await Swal.fire({ icon: 'error', title: 'Error', text: e?.message || 'Error inesperado.' });
    } finally {
      this.busyAdd = false;
    }
  }

  async toggleActiva(r: Register) {
    try {
      const rs = await this.api?.registersSetActive?.({ id: r.id, is_active: !r.is_active });
      if (!rs?.success) {
        await Swal.fire({ icon: 'error', title: 'No se pudo cambiar', text: rs?.error || 'Error.' });
        return;
      }
      await this.cargar();
    } catch (e: any) {
      await Swal.fire({ icon: 'error', title: 'Error', text: e?.message || 'Error inesperado.' });
    }
  }
}