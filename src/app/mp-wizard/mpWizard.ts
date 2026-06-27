import { Component, EventEmitter, Output, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { NgIf, NgFor } from '@angular/common';
import Swal from 'sweetalert2';

interface MpTerminal {
  id: string;
  operating_mode?: string;
  pos_id?: number | string;
  store_id?: string;
}

@Component({
  selector: 'app-mp-wizard',
  standalone: true,
  imports: [FormsModule, NgIf, NgFor],
  templateUrl: './mpWizard.html',
  styleUrls: ['./mpWizard.css']
})
export class MpWizard implements OnInit {
  // El padre decide qué hacer al cerrar/terminar
  @Output() close = new EventEmitter<void>();
  @Output() done = new EventEmitter<void>();

  // Pasos: 1 Token, 2 Sucursal, 3 Caja, 4 Asociar, 5 PDV, 6 Listo
  step = 1;
  busy = false;

  // Paso 1 - Token
  accessToken = '';
  hasToken = false;
  userId = '';
  nickname = '';

  // Paso 2 - Sucursal
  storeId = '';
  storeName = 'Sucursal Principal';
  storeExternalId = 'SUC001';
  street = '';
  streetNumber = '';
  city = '';
  state = '';
  latitude: number | null = null;
  longitude: number | null = null;
  reference = 'Punto de venta';

  // Paso 3 - Caja
  posId = '';
  posName = 'Caja 1';
  posExternalId = 'SUC001POS001';

  // Paso 4/5 - Terminal
  terminals: MpTerminal[] = [];
  selectedTerminalId = '';
  loadingTerminals = false;

  // Paso 6 - Modo prueba
  testMode = true;

  private get api() {
    return (window as any).electronAPI;
  }

  async ngOnInit() {
    // Reanuda el asistente si ya hay configuración guardada
    try {
      const rs = await this.api?.mpGetConfig?.();
      const d = rs?.data;
      if (d) {
        this.hasToken = !!d.hasToken;
        this.userId = d.userId || '';
        this.storeId = d.storeId || '';
        this.posId = d.posId || '';
        this.selectedTerminalId = d.terminalId || '';
        this.testMode = d.testMode !== false;
      }
    } catch { /* noop */ }
  }

  // ============ Navegación ============
  goTo(step: number) {
    if (step >= 1 && step <= 6) this.step = step;
  }

  next() {
    if (this.step < 6) this.step++;
  }

  prev() {
    if (this.step > 1) this.step--;
  }

  cerrar() {
    this.close.emit();
  }

  // ============ Paso 1: validar token ============
  async validarToken() {
    if (!this.api?.mpValidateToken || !this.api?.mpSetConfig) {
      await Swal.fire({ icon: 'error', title: 'No disponible', text: 'Falta la integración de Mercado Pago en la app.' });
      return;
    }

    const token = (this.accessToken || '').trim();
    if (!token && !this.hasToken) {
      await Swal.fire({ icon: 'warning', title: 'Falta el token', text: 'Pega tu Access Token de Mercado Pago.' });
      return;
    }

    this.busy = true;
    try {
      if (token) await this.api.mpSetConfig({ accessToken: token });

      const rs = await this.api.mpValidateToken();
      if (!rs?.success) {
        await Swal.fire({ icon: 'error', title: 'Token no válido', text: rs?.error || 'Revisa que sea el Access Token de tu aplicación Point.' });
        return;
      }

      this.hasToken = true;
      this.userId = rs.userId || '';
      this.nickname = rs.nickname || '';
      this.accessToken = '';

      await Swal.fire({ icon: 'success', title: 'Token verificado', text: this.nickname ? `Cuenta: ${this.nickname}` : 'Conexión correcta.', timer: 1200, showConfirmButton: false });
      this.step = 2;
    } catch (e: any) {
      await Swal.fire({ icon: 'error', title: 'Error', text: e?.message || 'No se pudo validar el token.' });
    } finally {
      this.busy = false;
    }
  }

  // ============ Paso 2: crear sucursal ============
  async crearSucursal() {
    if (!this.street.trim() || !this.city.trim() || !this.state.trim() || this.latitude == null || this.longitude == null) {
      await Swal.fire({ icon: 'warning', title: 'Faltan datos', text: 'Calle, ciudad, estado y coordenadas son obligatorios.' });
      return;
    }

    this.busy = true;
    try {
      const rs = await this.api.mpCreateStore({
        name: this.storeName,
        externalId: this.storeExternalId,
        streetName: this.street,
        streetNumber: this.streetNumber,
        cityName: this.city,
        stateName: this.state,
        latitude: this.latitude,
        longitude: this.longitude,
        reference: this.reference
      });

      if (!rs?.success) {
        await Swal.fire({ icon: 'error', title: 'No se pudo crear la sucursal', text: rs?.error || 'Revisa los datos.' });
        return;
      }

      this.storeId = rs.storeId;
      await Swal.fire({ icon: 'success', title: 'Sucursal creada', timer: 1100, showConfirmButton: false });
      this.step = 3;
    } catch (e: any) {
      await Swal.fire({ icon: 'error', title: 'Error', text: e?.message || 'No se pudo crear la sucursal.' });
    } finally {
      this.busy = false;
    }
  }

  usarSucursalExistente() {
    if (this.storeId) this.step = 3;
  }

  // ============ Paso 3: crear caja ============
  async crearCaja() {
    this.busy = true;
    try {
      const rs = await this.api.mpCreatePos({
        name: this.posName,
        externalId: this.posExternalId
      });

      if (!rs?.success) {
        await Swal.fire({ icon: 'error', title: 'No se pudo crear la caja', text: rs?.error || 'Revisa los datos.' });
        return;
      }

      this.posId = rs.posId;
      await Swal.fire({ icon: 'success', title: 'Caja creada', timer: 1100, showConfirmButton: false });
      this.step = 4;
    } catch (e: any) {
      await Swal.fire({ icon: 'error', title: 'Error', text: e?.message || 'No se pudo crear la caja.' });
    } finally {
      this.busy = false;
    }
  }

  usarCajaExistente() {
    if (this.posId) this.step = 4;
  }

  // ============ Paso 4: buscar terminal asociada ============
  async buscarTerminales() {
    this.loadingTerminals = true;
    try {
      const rs = await this.api.mpListTerminals();
      if (!rs?.success) {
        await Swal.fire({ icon: 'error', title: 'No se pudieron buscar', text: rs?.error || 'Revisa la conexión.' });
        return;
      }

      this.terminals = rs.data ?? [];
      if (!this.terminals.length) {
        await Swal.fire({
          icon: 'info',
          title: 'Aún no aparece la terminal',
          text: 'Asegúrate de haber escaneado el QR desde la app de Mercado Pago y vuelve a buscar.'
        });
        return;
      }

      // Si solo hay una, la preselecciona
      if (this.terminals.length === 1) {
        this.selectedTerminalId = this.terminals[0].id;
      }
    } catch (e: any) {
      await Swal.fire({ icon: 'error', title: 'Error', text: e?.message || 'No se pudo buscar la terminal.' });
    } finally {
      this.loadingTerminals = false;
    }
  }

  seleccionarTerminal(id: string) {
    this.selectedTerminalId = id;
  }

  get selectedTerminal(): MpTerminal | null {
    return this.terminals.find(t => t.id === this.selectedTerminalId) || null;
  }

  continuarAPdv() {
    if (!this.selectedTerminalId) {
      Swal.fire({ icon: 'warning', title: 'Elige una terminal', text: 'Selecciona la terminal que vas a usar.' });
      return;
    }
    this.step = 5;
  }

  // ============ Paso 5: activar PDV ============
  async activarPdv() {
    if (!this.selectedTerminalId) return;

    this.busy = true;
    try {
      const rs = await this.api.mpSetPdv(this.selectedTerminalId);
      if (!rs?.success) {
        await Swal.fire({
          icon: 'error',
          title: 'No se pudo activar PDV',
          text: (rs?.error || 'Error al activar el modo PDV.') + ' Recuerda que solo las Point Smart (PAX A910 / Newland N950) lo soportan.'
        });
        return;
      }

      await Swal.fire({
        icon: 'success',
        title: 'Modo PDV activado',
        html: 'Reinicia la terminal para que el cambio tome efecto.',
        confirmButtonText: 'Entendido'
      });
      this.step = 6;
    } catch (e: any) {
      await Swal.fire({ icon: 'error', title: 'Error', text: e?.message || 'No se pudo activar PDV.' });
    } finally {
      this.busy = false;
    }
  }

  // ============ Paso 6: terminar ============
  async finalizar() {
    this.busy = true;
    try {
      await this.api.mpSetConfig({ testMode: this.testMode });
      await Swal.fire({
        icon: 'success',
        title: '¡Terminal lista!',
        text: this.testMode
          ? 'Quedó en modo prueba: las ventas con terminal se aprueban solas para que valides el flujo.'
          : 'Quedó en modo producción: lista para cobros reales con tarjeta.',
        confirmButtonText: 'Listo'
      });
      this.done.emit();
    } catch (e: any) {
      await Swal.fire({ icon: 'error', title: 'Error', text: e?.message || 'No se pudo guardar.' });
    } finally {
      this.busy = false;
    }
  }
}