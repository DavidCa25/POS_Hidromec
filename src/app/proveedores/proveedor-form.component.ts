import { Component, EventEmitter, Input, OnInit, Output } from '@angular/core';
import { NgIf } from '@angular/common';
import { FormsModule } from '@angular/forms';
import Swal from 'sweetalert2';

export interface ProveedorDatos {
  id?: number | null;
  nombre?: string | null;
  telefono?: string | null;
  correo?: string | null;
  rfc?: string | null;
}

/**
 * Alta y edicion de un proveedor, en un solo sitio.
 *
 * Vivia pegado dentro de la pantalla Proveedores, y por eso Registrar compra
 * decia «No hay proveedores registrados» sin poder hacer nada: para dar de
 * alta uno habia que salir de la compra a medias.
 */
@Component({
  selector: 'app-proveedor-form',
  standalone: true,
  imports: [NgIf, FormsModule],
  template: `
    <div class="cierre-modal" style="position:fixed; inset:0; display:flex; align-items:center; justify-content:center; z-index:1100;"
         (keydown.escape)="cerrar()">
      <form class="cierre-dialog modal-content" style="padding:1.2rem 1.4rem 1.4rem; width:96%; max-width:520px;"
            (ngSubmit)="guardar()" autocomplete="off">
        <h3 style="margin:0 0 .9rem; font-size:1.4rem; font-weight:800;">{{ form.id ? 'Editar proveedor' : 'Nuevo proveedor' }}</h3>
        <div class="filter-row" style="grid-template-columns:1fr 1fr;">
          <div class="filter-group"><label for="prov-nombre">Nombre</label><input id="prov-nombre" name="nombre" class="form-control" [(ngModel)]="form.nombre"></div>
          <div class="filter-group"><label for="prov-telefono">Telefono</label><input id="prov-telefono" name="telefono" class="form-control" [(ngModel)]="form.telefono"></div>
          <div class="filter-group"><label for="prov-correo">Correo</label><input id="prov-correo" name="correo" class="form-control" [(ngModel)]="form.correo"></div>
          <div class="filter-group"><label for="prov-rfc">RFC</label><input id="prov-rfc" name="rfc" class="form-control" [(ngModel)]="form.rfc" style="text-transform:uppercase;"></div>
        </div>
        <div style="display:flex; gap:.6rem; justify-content:flex-end; margin-top:1rem;">
          <button type="button" class="btn btn-ghost" (click)="cerrar()" [disabled]="guardando">Cancelar</button>
          <button type="submit" class="btn btn-primary" [disabled]="guardando">{{ guardando ? 'Guardando...' : 'Guardar' }}</button>
        </div>
      </form>
    </div>
  `,
  /* Los mismos que tenia el formulario dentro de Proveedores, para que se vea
     igual en las dos pantallas que lo usan. */
  styles: [`
    .filter-row { display: grid; gap: 14px; align-items: end; }
    .filter-group label {
      display: block; font-size: .88rem; font-weight: 600;
      color: var(--wx-text-muted); margin-bottom: .4rem;
    }
    .form-control { height: 42px; border-radius: 12px; }
    @media (max-width: 640px) { .filter-row { grid-template-columns: 1fr !important; } }
  `],
})
export class ProveedorFormComponent implements OnInit {
  /** Sin datos es un alta. */
  @Input() proveedor: ProveedorDatos | null = null;
  /** Emite el id y el nombre con que quedo guardado. */
  @Output() guardado = new EventEmitter<{ id: number | null; nombre: string }>();
  @Output() cerrado = new EventEmitter<void>();

  form = { id: 0, nombre: '', telefono: '', correo: '', rfc: '' };
  guardando = false;

  ngOnInit() {
    const p = this.proveedor;
    this.form = {
      id: Number(p?.id) || 0,
      nombre: p?.nombre || '',
      telefono: p?.telefono || '',
      correo: p?.correo || '',
      rfc: p?.rfc || '',
    };
  }

  cerrar() {
    if (!this.guardando) this.cerrado.emit();
  }

  async guardar() {
    if (!this.form.nombre.trim()) { await Swal.fire({ icon: 'warning', title: 'Falta el nombre' }); return; }
    this.guardando = true;
    try {
      const res = await (window as any).electronAPI?.supplierSave?.({
        id: this.form.id || null,
        nombre: this.form.nombre.trim(),
        telefono: this.form.telefono.trim() || null,
        correo: this.form.correo.trim() || null,
        rfc: this.form.rfc.trim().toUpperCase() || null,
      });
      if (!res?.success) throw new Error(res?.error || 'No se pudo guardar.');
      const id = Number(res?.data?.id) || this.form.id || null;
      const titulo = this.form.id ? 'Proveedor actualizado' : 'Proveedor agregado';
      this.guardado.emit({ id, nombre: this.form.nombre.trim() });
      await Swal.fire({ icon: 'success', title: titulo, timer: 1100, showConfirmButton: false });
    } catch (e: any) {
      await Swal.fire({ icon: 'error', title: 'Error', text: e?.message || 'Fallo al guardar.' });
    } finally {
      this.guardando = false;
    }
  }
}
