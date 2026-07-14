import { Component, EventEmitter, Output, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import Swal from 'sweetalert2';
import { LicenseService } from '../../services/license.service';
import { ImportadorProductos } from '../importador-productos/importador-productos.component';
import { CATALOGOS_GIRO, GiroCatalogo } from './catalogos-giro';

@Component({
  selector: 'app-setup-inicial',
  standalone: true,
  imports: [CommonModule, FormsModule, ImportadorProductos],
  templateUrl: './setup-inicial.component.html',
  styleUrls: ['./setup-inicial.component.css']
})
export class SetupInicial implements OnInit {
  @Output() completado = new EventEmitter<void>();

  // 1 = licencia, 2 = negocio, 3 = administrador
  paso = 2;
  procesando = false;

  // Paso 1: licencia
  clave = '';
  aliasCaja = '';

  // Paso 2: negocio
  businessName = '';
  address = '';
  phone = '';
  rfc = '';

  // Paso 3: administrador
  usuario = '';
  password = '';
  passwordConfirm = '';
  verPassword = false;

  // ---------- Paso 4: datos iniciales (onboarding) ----------
  obVista: 'pregunta' | 'importar' | 'giro' = 'pregunta';
  giros: GiroCatalogo[] = CATALOGOS_GIRO;
  giroCargando: string | null = null;

  constructor(private license: LicenseService) {}

  private get api() { return (window as any).electronAPI; }

  async ngOnInit() {
    // Si ya hay licencia activa, salta al paso 2
    const ok = await this.license.iniciar();
    if (ok) this.paso = 2;
  }

  get planTexto(): string {
    return this.license.esMulticaja ? 'MultiCaja' : 'MonoCaja';
  }

  // Formatea la clave mientras escribe
  onClaveInput(v: string) {
    const limpio = v.toUpperCase().replace(/[^A-Z0-9]/g, '');
    const partes: string[] = [];
    if (limpio.length > 0) partes.push(limpio.slice(0, 4));
    if (limpio.length > 4) partes.push(limpio.slice(4, 6));
    if (limpio.length > 6) partes.push(limpio.slice(6, 10));
    if (limpio.length > 10) partes.push(limpio.slice(10, 14));
    this.clave = partes.join('-');
  }

  // ---------- Paso 2 ----------
  siguienteNegocio() {
    if (!this.businessName.trim()) {
      Swal.fire({ icon: 'warning', title: 'Falta el nombre', text: 'Escribe el nombre de tu negocio.' });
      return;
    }
    this.paso = 3;
  }

  // ---------- Paso 3 ----------
  get passwordValida(): boolean {
    return this.password.length >= 6;
  }
  get passwordsCoinciden(): boolean {
    return this.password.length > 0 && this.password === this.passwordConfirm;
  }

  async finalizar() {
    if (this.usuario.trim().length < 3) {
      await Swal.fire({ icon: 'warning', title: 'Usuario invalido', text: 'Debe tener al menos 3 caracteres.' });
      return;
    }
    if (!this.passwordValida) {
      await Swal.fire({ icon: 'warning', title: 'Contrasena corta', text: 'Debe tener al menos 6 caracteres.' });
      return;
    }
    if (!this.passwordsCoinciden) {
      await Swal.fire({ icon: 'warning', title: 'No coinciden', text: 'Las contrasenas no son iguales.' });
      return;
    }

    this.procesando = true;
    try {
      const res = await this.api?.setupInicial?.({
        usuario: this.usuario.trim(),
        password: this.password,
        business_name: this.businessName.trim(),
        address: this.address.trim() || null,
        phone: this.phone.trim() || null,
        rfc: this.rfc.trim().toUpperCase() || null
      });

      if (!res?.success) {
        await Swal.fire({ icon: 'error', title: 'No se pudo configurar', text: res?.error || 'Error al crear el usuario.' });
        return;
      }

      await Swal.fire({
        icon: 'success',
        title: 'Cuenta creada',
        html: `<b>${this.businessName}</b> esta configurado.`,
        timer: 1200,
        showConfirmButton: false
      });
      this.paso = 4;
    } catch (e: any) {
      await Swal.fire({ icon: 'error', title: 'Error', text: e?.message || 'Error inesperado.' });
    } finally {
      this.procesando = false;
    }
  }

  // ---------- Paso 4: onboarding ----------
  elegirImportar() { this.obVista = 'importar'; }
  elegirGiro() { this.obVista = 'giro'; }
  volverPregunta() { this.obVista = 'pregunta'; }

  async cargarGiro(g: GiroCatalogo) {
    const conf = await Swal.fire({
      icon: 'question',
      title: `Cargar catalogo de ${g.nombre}`,
      html: `Se agregaran <b>${g.productos.length}</b> productos base (sin precio). Podras editarlos despues.`,
      showCancelButton: true,
      confirmButtonText: 'Cargar',
      cancelButtonText: 'Cancelar'
    });
    if (!conf.isConfirmed) return;

    this.giroCargando = g.id;
    try {
      const rows = g.productos.map(pr => ({
        part_number: pr.part_number,
        name: pr.name,
        brand_name: pr.brand_name ?? null,
        category_name: pr.category_name,
        price: null, stock: null,
        bar_code: null, clave_prod_serv: null, clave_unidad: null,
        objeto_impuesto: null, tasa_iva: null
      }));
      const res = await this.api?.importProducts?.({ rows });
      if (!res?.success) throw new Error(res?.error || 'No se pudo cargar el catalogo.');
      const d = res.data || {};
      await Swal.fire({
        icon: 'success',
        title: 'Catalogo cargado',
        html: `Productos agregados: <b>${d.inserted ?? 0}</b><br>Categorias creadas: <b>${d.categories_created ?? 0}</b>`
      });
    } catch (e: any) {
      await Swal.fire({ icon: 'error', title: 'Error', text: e?.message || 'No se pudo cargar.' });
    } finally {
      this.giroCargando = null;
    }
  }

  terminar() {
    this.completado.emit();
  }
}