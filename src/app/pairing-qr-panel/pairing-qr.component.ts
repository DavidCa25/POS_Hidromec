import { ChangeDetectorRef, Component, OnInit, inject } from '@angular/core';
import { NgIf } from '@angular/common';
import { FormsModule } from '@angular/forms';
import * as QRCode from 'qrcode';
import Swal from 'sweetalert2';

/**
 * NUBE Y APP DEL DUEÑO (Fase 1: empresa -> sucursal -> equipo).
 *
 *   sin registrar   «Negocio nuevo» (la base se da de alta como empresa +
 *                   sucursal) o «Sucursal de un negocio que ya usa Wybix»
 *                   (código de 12 caracteres: entra a la MISMA empresa).
 *                   Nada se da de alta solo al abrir: así una sucursal nueva
 *                   no crea una empresa suelta antes de capturar su código.
 *   principal       QR para la app del dueño (lleva una invitación de un solo
 *                   uso) y «Agregar otra sucursal» (código para su POS).
 *   secundaria      la sucursal la registra la caja principal.
 */
@Component({
  selector: 'app-pairing-qr',
  standalone: true,
  imports: [NgIf, FormsModule],
  templateUrl: './pairing-qr.component.html',
  styleUrls: ['./pairing-qr.component.css']
})
export class PairingQr implements OnInit {
  private readonly cdr = inject(ChangeDetectorRef);
  qrDataUrl: string | null = null;
  private qrText = '';
  nombre = '';
  aviso = '';
  loading = true;
  error = '';

  registrado = false;
  esPrincipal = true;
  codigoUnion = '';
  uniendo = false;

  nombreSucursal = '';
  creandoSucursal = false;
  codigoSucursal: { codigo: string; expira: string; nombre: string } | null = null;

  private get api() {
    return (window as any).electronAPI;
  }

  async ngOnInit() {
    await this.cargarEstado();
  }

  private async cargarEstado() {
    this.loading = true;
    this.error = '';
    try {
      const response = await this.api?.cloudGetConfig?.();
      if (!response?.success) throw new Error(response?.error || 'No se pudo consultar la conexión del negocio.');
      const cfg = response.data;
      this.registrado = !!cfg?.equipo?.registrado;
      this.esPrincipal = cfg?.esPrincipal !== false;
      if (this.registrado && this.esPrincipal) await this.generar();
    } catch (e: any) {
      this.error = e?.message || 'No se pudo consultar la conexión del negocio.';
    } finally {
      this.loading = false;
      this.cdr.markForCheck();
    }
  }

  reintentar() { return this.cargarEstado(); }

  /** Negocio nuevo: esta base se registra como empresa + sucursal. */
  async registrarNegocio() {
    this.loading = true;
    this.error = '';
    try {
      const prov = await this.api?.cloudEnsureProvisioned?.();
      if (!prov?.success) {
        this.error = prov?.error || 'No se pudo preparar el negocio en la nube.';
        return;
      }
      this.registrado = true;
      await this.generar();
    } catch (e: any) {
      this.error = e?.message || 'No se pudo preparar el negocio en la nube.';
    } finally {
      this.loading = false;
      this.cdr.markForCheck();
    }
  }

  /** Sucursal nueva de un negocio existente: entra con el código. */
  async unirConCodigo() {
    const limpio = this.codigoUnion.toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (limpio.length !== 12) {
      this.error = 'El código tiene 12 letras y números (XXXX-XXXX-XXXX).';
      return;
    }
    this.uniendo = true;
    this.error = '';
    try {
      const r = await this.api?.cloudUnirseCodigo?.(limpio);
      if (!r?.success) { this.error = r?.error || 'No se pudo unir la sucursal.'; return; }
      this.registrado = true;
      this.codigoUnion = '';
      await Swal.fire({ icon: 'success', title: 'Sucursal unida', text: 'Esta sucursal ya es parte del negocio.', timer: 1800, showConfirmButton: false });
      await this.generar();
    } catch (e: any) {
      this.error = e?.message || 'No se pudo unir la sucursal.';
    } finally {
      this.uniendo = false;
      this.cdr.markForCheck();
    }
  }

  async generar() {
    this.loading = true;
    this.error = '';
    this.aviso = '';
    this.qrDataUrl = null;
    this.qrText = '';
    try {
      const pair = await this.api?.cloudGetPairing?.();
      if (!pair?.success) {
        this.error = pair?.error || 'No se pudo generar el código.';
        return;
      }
      this.nombre = pair.payload?.nombre || '';
      this.aviso = pair.aviso || '';
      // Sin invitación (ya hay dueño) no hay QR que enseñar.
      if (!pair.payload?.codigo) return;
      this.qrText = pair.qrText;
      this.qrDataUrl = await QRCode.toDataURL(pair.qrText, {
        width: 320,
        margin: 2,
        color: { dark: '#0F2A3F', light: '#FFFFFF' }
      });
    } catch (e: any) {
      this.error = e?.message || 'Error inesperado.';
    } finally {
      this.loading = false;
      // El panel Apps usa OnPush: las respuestas IPC no marcan su vista.
      this.cdr.markForCheck();
    }
  }

  /** Copia los MISMOS datos del QR (pedir otros generaría otra invitación). */
  async copiarDatos() {
    if (!this.qrText) return;
    try {
      await navigator.clipboard.writeText(this.qrText);
      await Swal.fire({ icon: 'success', title: 'Datos copiados', timer: 1200, showConfirmButton: false });
    } catch { /* noop */ }
  }

  /** Otra sucursal del MISMO negocio: código para el POS de esa sucursal. */
  async crearSucursal() {
    const nombre = this.nombreSucursal.trim();
    if (!nombre) { this.error = 'Escribe el nombre de la sucursal.'; return; }
    this.creandoSucursal = true;
    this.error = '';
    try {
      const r = await this.api?.cloudCrearSucursal?.({ nombre, tipo: 'BRANCH' });
      if (!r?.success) { this.error = r?.error || 'No se pudo crear la sucursal.'; return; }
      this.codigoSucursal = { codigo: r.codigo, expira: r.expira, nombre };
      this.nombreSucursal = '';
    } catch (e: any) {
      this.error = e?.message || 'No se pudo crear la sucursal.';
    } finally {
      this.creandoSucursal = false;
      this.cdr.markForCheck();
    }
  }
}
