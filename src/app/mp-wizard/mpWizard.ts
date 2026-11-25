import { Component, EventEmitter, Output, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { NgIf, NgFor, NgTemplateOutlet } from '@angular/common';
import Swal from 'sweetalert2';

/* Lo que devuelve `mp-discover`: lo que ya existe en la cuenta de MP. */
interface MpTerminal { id: string; operatingMode: string; storeId: string; posId: string; storeName: string; posName: string; }
interface MpStore { id: string; name: string; }
interface MpPos { id: string; name: string; storeId: string; }

const NUEVA = '__nueva__';
/** «Tus integraciones»: donde están la aplicación y sus credenciales. */
const PANEL_MP = 'https://www.mercadopago.com.mx/developers/panel/app';

/**
 * Vincular la terminal Point en cuatro pasos:
 *  1 Conectar  — el Access Token; con él se lee TODO lo que ya hay en la cuenta.
 *  2 Sucursal y caja — elegir las que existen o crear lo que falte.
 *  3 Terminal  — vincularla con el celular (si aún no) y dejarla en modo PDV.
 *  4 Listo     — resumen. El modo prueba sale de la cuenta, no se elige.
 *
 * Una cuenta que ya cobraba con su Point salta directo del 1 al 3 (o al 4):
 * no se vuelve a crear sucursal ni caja.
 */
@Component({
  selector: 'app-mp-wizard',
  standalone: true,
  imports: [FormsModule, NgIf, NgFor, NgTemplateOutlet],
  templateUrl: './mpWizard.html',
  styleUrls: ['./mpWizard.css']
})
export class MpWizard implements OnInit {
  @Output() close = new EventEmitter<void>();
  @Output() done = new EventEmitter<void>();

  readonly NUEVA = NUEVA;
  step = 1;
  busy = false;
  /** Al abrir con un token ya guardado se revisa la cuenta antes de mostrar nada. */
  revisando = false;

  // 1 · Conectar
  accessToken = '';
  hasToken = false;
  nickname = '';
  testMode = false;

  // Lo que hay en la cuenta
  terminals: MpTerminal[] = [];
  stores: MpStore[] = [];
  pos: MpPos[] = [];

  // 2 · Sucursal y caja
  storeSel = '';
  posSel = '';
  storeName = 'Sucursal Principal';
  street = '';
  streetNumber = '';
  city = '';
  state = '';
  coordenadas = '';
  posName = 'Caja 1';

  // 3 · Terminal
  terminalSel = '';
  buscando = false;

  // Lo que quedó guardado
  storeId = '';
  posId = '';
  terminalId = '';

  private get api() {
    return (window as any).electronAPI;
  }

  async ngOnInit() {
    try {
      const d = (await this.api?.mpGetConfig?.())?.data;
      if (!d?.hasToken) return;
      this.hasToken = true;
      this.storeId = d.storeId || '';
      this.posId = d.posId || '';
      this.terminalId = d.terminalId || '';
      this.testMode = !!d.testMode;
      // Ya hay token: se revisa la cuenta y se abre donde se quedó.
      this.revisando = true;
      await this.conectar(true);
    } catch { /* noop */ } finally {
      this.revisando = false;
    }
  }

  cerrar() { this.close.emit(); }
  prev() { if (this.step > 1) this.step--; }

  // ============ 1 · Conectar ============
  async abrirPanel() {
    let rs: any = null;
    try { rs = await this.api?.openExternal?.(PANEL_MP); } catch { /* se muestra la dirección */ }
    if (!rs?.ok) await Swal.fire({ icon: 'info', title: 'Ábrelo en tu navegador', text: PANEL_MP });
  }

  async conectar(silencioso = false) {
    const api = this.api;
    if (!api?.mpValidateToken || !api?.mpDiscover) {
      await Swal.fire({ icon: 'error', title: 'No disponible', text: 'Falta la integración de Mercado Pago en la app.' });
      return;
    }
    const token = (this.accessToken || '').trim();
    if (!token && !this.hasToken) {
      await Swal.fire({ icon: 'warning', title: 'Falta el Access Token', text: 'Pégalo para continuar.' });
      return;
    }

    this.busy = true;
    try {
      if (token) await api.mpSetConfig({ accessToken: token });
      const rs = await api.mpValidateToken();
      if (!rs?.success) {
        if (!silencioso) await Swal.fire({ icon: 'error', title: 'Mercado Pago no aceptó el token', text: `${rs?.error || ''} Revisa que sea el Access Token (empieza con APP_USR-) y no la Public Key.`.trim() });
        this.step = 1;
        return;
      }
      this.hasToken = true;
      this.accessToken = '';
      this.nickname = rs.nickname || '';
      this.testMode = !!rs.testUser;
      await this.descubrir();
      this.irAlSiguientePendiente();
    } catch (e: any) {
      if (!silencioso) await Swal.fire({ icon: 'error', title: 'Error', text: e?.message || 'No se pudo conectar con Mercado Pago.' });
    } finally {
      this.busy = false;
    }
  }

  private async descubrir() {
    const rs = await this.api.mpDiscover();
    if (!rs?.success) throw new Error(rs?.error || 'No se pudo leer la cuenta de Mercado Pago.');
    this.terminals = rs.terminals ?? [];
    this.stores = rs.stores ?? [];
    this.pos = rs.pos ?? [];
    this.storeId = rs.actual?.storeId || this.storeId;
    this.posId = rs.actual?.posId || this.posId;
    this.terminalId = rs.actual?.terminalId || this.terminalId;
  }

  /** Salta lo que ya está hecho en la cuenta. */
  private irAlSiguientePendiente() {
    const guardada = this.terminals.find(t => t.id === this.terminalId);
    if (guardada && guardada.operatingMode === 'PDV') { this.step = 4; return; }
    if (this.terminals.length) {
      this.terminalSel = guardada?.id || (this.terminals.length === 1 ? this.terminals[0].id : '');
      this.step = 3;
      return;
    }
    // Sin terminales: preparar sucursal y caja (elige lo que exista).
    this.storeSel = this.stores.some(s => s.id === this.storeId) ? this.storeId : (this.stores[0]?.id || NUEVA);
    this.elegirSucursal(this.storeSel);
    this.step = 2;
  }

  // ============ 2 · Sucursal y caja ============
  get cajasDeSucursal(): MpPos[] {
    return this.storeSel === NUEVA ? [] : this.pos.filter(p => p.storeId === this.storeSel);
  }

  elegirSucursal(id: string) {
    this.storeSel = id;
    const cajas = this.cajasDeSucursal;
    this.posSel = cajas.some(p => p.id === this.posId) ? this.posId : (cajas[0]?.id || NUEVA);
  }

  /** Acepta lo que copia Google Maps: «21.1219, -101.6833». */
  private leerCoordenadas(): { lat: number; lng: number } | null {
    const m = (this.coordenadas || '').match(/(-?\d+(?:\.\d+)?)\s*[,\s]\s*(-?\d+(?:\.\d+)?)/);
    if (!m) return null;
    const lat = Number(m[1]), lng = Number(m[2]);
    if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
    return { lat, lng };
  }

  get nombreSucursalSel(): string {
    return this.storeSel === NUEVA ? this.storeName : (this.stores.find(s => s.id === this.storeSel)?.name || '');
  }
  get nombreCajaSel(): string {
    return this.posSel === NUEVA ? this.posName : (this.pos.find(p => p.id === this.posSel)?.name || '');
  }

  async guardarSucursalYCaja() {
    const api = this.api;
    let coords: { lat: number; lng: number } | null = null;
    if (this.storeSel === NUEVA) {
      coords = this.leerCoordenadas();
      if (!this.street.trim() || !this.city.trim() || !this.state.trim() || !coords) {
        await Swal.fire({ icon: 'warning', title: 'Faltan datos de la sucursal', text: 'Calle, ciudad, estado y coordenadas son obligatorios. Las coordenadas se copian de Google Maps.' });
        return;
      }
    }
    if (this.posSel === NUEVA && !this.posName.trim()) {
      await Swal.fire({ icon: 'warning', title: 'Falta el nombre de la caja' });
      return;
    }

    this.busy = true;
    try {
      let storeId = this.storeSel;
      if (storeId === NUEVA) {
        const rs = await api.mpCreateStore({
          name: this.storeName, streetName: this.street, streetNumber: this.streetNumber,
          cityName: this.city, stateName: this.state, latitude: coords!.lat, longitude: coords!.lng, reference: 'Punto de venta'
        });
        if (!rs?.success) throw new Error(`No se pudo crear la sucursal: ${rs?.error || 'revisa los datos.'}`);
        storeId = rs.storeId;
        this.stores = [...this.stores, { id: storeId, name: this.storeName }];
        this.storeSel = storeId;
      } else {
        const rs = await api.mpSelect({ storeId });
        if (!rs?.success) throw new Error(rs?.error || 'No se pudo guardar la sucursal.');
      }
      this.storeId = storeId;

      let posId = this.posSel;
      if (posId === NUEVA) {
        const rs = await api.mpCreatePos({ name: this.posName });
        if (!rs?.success) throw new Error(`No se pudo crear la caja: ${rs?.error || 'revisa los datos.'}`);
        posId = rs.posId;
        this.pos = [...this.pos, { id: posId, name: this.posName, storeId }];
        this.posSel = posId;
      } else {
        const rs = await api.mpSelect({ posId });
        if (!rs?.success) throw new Error(rs?.error || 'No se pudo guardar la caja.');
      }
      this.posId = posId;
      this.step = 3;
    } catch (e: any) {
      await Swal.fire({ icon: 'error', title: 'No se pudo guardar', text: e?.message || 'Error inesperado.' });
    } finally {
      this.busy = false;
    }
  }

  // ============ 3 · Terminal ============
  async buscarTerminales() {
    this.buscando = true;
    try {
      await this.descubrir();
      if (!this.terminals.length) {
        await Swal.fire({ icon: 'info', title: 'Aún no aparece', text: 'Termina de escanear el QR de la terminal con la app de Mercado Pago (pasos de arriba) y vuelve a buscar.' });
        return;
      }
      if (!this.terminalSel && this.terminals.length === 1) this.terminalSel = this.terminals[0].id;
    } catch (e: any) {
      await Swal.fire({ icon: 'error', title: 'No se pudo buscar', text: e?.message || 'Revisa la conexión.' });
    } finally {
      this.buscando = false;
    }
  }

  get terminalElegida(): MpTerminal | null {
    return this.terminals.find(t => t.id === this.terminalSel) || null;
  }

  /** Modelo legible a partir del id («NEWLAND_N950__N950NCB…»). */
  modelo(t: MpTerminal): string {
    const m = t.id.split('__')[0] || '';
    if (/N950/i.test(m)) return 'Point Smart (N950)';
    if (/A910/i.test(m)) return 'Point Smart (A910)';
    return m.replace(/_/g, ' ');
  }
  serie(t: MpTerminal): string {
    return t.id.split('__')[1] || t.id;
  }

  async usarTerminal() {
    const t = this.terminalElegida;
    if (!t) return;
    this.busy = true;
    try {
      const yaPdv = t.operatingMode === 'PDV';
      if (!yaPdv) {
        const rs = await this.api.mpSetPdv(t.id);
        if (!rs?.success) {
          await Swal.fire({
            icon: 'error', title: 'No se pudo activar el modo PDV',
            text: `${rs?.error || ''} Solo las Point Smart (Newland N950 o PAX A910) reciben cobros desde una caja.`.trim()
          });
          return;
        }
      }
      // La sucursal y caja son las de la terminal, aunque se haya vinculado a otras.
      const rs = await this.api.mpSelect({ terminalId: t.id, storeId: t.storeId || this.storeId, posId: t.posId || this.posId });
      if (!rs?.success) throw new Error(rs?.error || 'No se pudo guardar la terminal.');
      this.terminalId = t.id;
      if (t.storeId) this.storeId = t.storeId;
      if (t.posId) this.posId = t.posId;
      t.operatingMode = 'PDV';
      if (!yaPdv) {
        await Swal.fire({ icon: 'success', title: 'Modo PDV activado', text: 'Apaga y vuelve a encender la terminal para que tome el cambio.', confirmButtonText: 'Ya la reinicié' });
      }
      this.step = 4;
    } catch (e: any) {
      await Swal.fire({ icon: 'error', title: 'Error', text: e?.message || 'No se pudo usar la terminal.' });
    } finally {
      this.busy = false;
    }
  }

  // ============ 4 · Listo ============
  get terminalGuardada(): MpTerminal | null {
    return this.terminals.find(t => t.id === this.terminalId) || null;
  }
  get nombreSucursal(): string {
    return this.terminalGuardada?.storeName || this.stores.find(s => s.id === this.storeId)?.name || (this.storeId ? `#${this.storeId}` : '—');
  }
  get nombreCaja(): string {
    return this.terminalGuardada?.posName || this.pos.find(p => p.id === this.posId)?.name || (this.posId ? `#${this.posId}` : '—');
  }

  irASucursal() {
    this.elegirSucursal(this.stores.some(s => s.id === this.storeId) ? this.storeId : (this.stores[0]?.id || NUEVA));
    this.step = 2;
  }

  cambiarTerminal() {
    this.terminalSel = this.terminalId;
    this.step = 3;
  }

  finalizar() {
    this.done.emit();
  }
}
