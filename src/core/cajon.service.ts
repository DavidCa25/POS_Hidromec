import { Injectable, inject } from '@angular/core';
import Swal from 'sweetalert2';
import { ElectronBridge } from './electron-bridge.service';
import { SupervisorAuthService } from '../services/supervisor.service';
import { PAQUETES } from '../services/auth.service';

/**
 * ABRIR EL CAJON SIN UNA VENTA DETRAS.
 *
 * Vivia en su propia pantalla ("Abrir cajon"), que se retiro: abrir el cajon
 * es un atajo de la caja (F1 en Retail, un boton en Touch), no un destino del
 * menu. Lo que NO se retiro es el candado: abrir sin venta es el gesto clasico
 * del "robo hormiga", asi que lo autoriza otra persona con permiso de
 * supervision y queda registrado como DRAWER_NO_SALE, igual que antes.
 *
 * Antes, la F1 de Retail llamaba al cajon directo: sin autorizacion ni
 * registro, y si el canal la negaba (un Operador), no decia nada. Ahora las
 * dos cajas pasan por aqui.
 */
@Injectable({ providedIn: 'root' })
export class CajonService {
  private readonly bridge = inject(ElectronBridge);
  private readonly supervisor = inject(SupervisorAuthService);
  private abriendo = false;

  async abrirSinVenta(): Promise<boolean> {
    if (this.abriendo) return false;
    const api = this.bridge.api;
    if (!api?.openCashDrawer) {
      await Swal.fire({ icon: 'info', title: 'No disponible', text: 'La apertura del cajón no está disponible en este entorno.' });
      return false;
    }
    this.abriendo = true;
    try {
      const ok = await this.supervisor.autorizarYregistrar(
        'Abrir el cajón sin una venta detrás tiene que autorizarlo otra persona.',
        'DRAWER_NO_SALE', 'open-cash-drawer', PAQUETES.VENTAS_SUPERVISAR,
        { detail: 'Apertura manual del cajón' });
      if (!ok) return false;

      const resp = await api.openCashDrawer({ reason: 'manual' });
      if (resp?.success === false) {
        await Swal.fire({ icon: 'error', title: 'No se abrió el cajón', text: resp?.error || 'Revisa la configuración del cajón.' });
        return false;
      }
      await Swal.fire({ icon: 'success', title: 'Cajón abierto', timer: 1200, showConfirmButton: false });
      return true;
    } catch (e: any) {
      await Swal.fire({ icon: 'error', title: 'No se abrió el cajón', text: e?.message || 'Revisa la configuración del cajón.' });
      return false;
    } finally {
      this.abriendo = false;
    }
  }
}
