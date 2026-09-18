import { Component } from '@angular/core';
import { Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { CommonModule } from '@angular/common';
import { AuthService, PAQUETES, RolUsuario } from '../services/auth.service';
import { CapabilityService } from '../core';
import Swal from 'sweetalert2';

@Component({
  selector: 'app-login',
  standalone: true,
  templateUrl: './login.html',
  imports: [FormsModule, CommonModule],
  styleUrls: ['./login.css']
})
export class Login {
  usuario = '';
  contrasena = '';
  mensaje = '';
  advertencia = '';
  mostrarContrasena = false;

  constructor(
    private router: Router,
    private authService: AuthService,
    private caps: CapabilityService,
  ) {}

  async onLogin(event: Event) {
    event.preventDefault();

    if (!this.usuario.trim() || !this.contrasena.trim()) {
      this.advertencia = '⚠️ Ambos campos son obligatorios.';
      return;
    }

    this.advertencia = '';
    this.mensaje = '';

    try {
      const resultado = await (window as any).electronAPI.iniciarSesion(
        this.usuario,
        this.contrasena
      );

      if (resultado && resultado.success && resultado.data) {
        const data = resultado.data as {
          id: number;
          usuario: string;
          rol: RolUsuario | string;
        };

        /* El retrato lo arma el proceso principal al abrir la sesión: trae los
           paquetes ya calculados con el catálogo que después autoriza. Si por
           lo que sea no viniera, se pregunta; lo que NO se hace es deducir los
           permisos aquí a partir del rol. */
        const acceso = (resultado.data as any).acceso ?? await this.authService.reconciliar();
        if (acceso) this.authService.entrar(acceso);

        /* Un rol que este binario no conoce: entra, se identifica, y hasta ahí.
           Decirlo es mejor que dejarle una pantalla donde nada funciona. */
        if (this.authService.sinRol()) {
          await Swal.fire({
            icon: 'info',
            title: 'Sin rol asignado',
            text: 'Tu usuario no tiene un rol que esta versión reconozca. '
                + 'Pide a un administrador que te lo asigne desde Configuración › Usuarios.',
          });
        }

        const api = (window as any).electronAPI;

        console.log('AutoUpdater bridge:', {
          isPackaged: api?.isPackaged ?? '(no expuesto)',
          hasOnUpdateStatus: typeof api?.onUpdateStatus === 'function',
          hasCheckForUpdates: typeof api?.checkForUpdates === 'function',
          hasDownloadUpdate: typeof api?.downloadUpdate === 'function',
          hasInstallUpdate: typeof api?.installUpdate === 'function',
        });

        if (typeof api?.checkForUpdates === 'function') {
          api.checkForUpdates()
            .then((r: any) => console.log('checkForUpdates() ->', r))
            .catch((err: any) => console.log('checkForUpdates() error ->', err));
        }
        // A donde entra depende del perfil de ESTE dispositivo, no solo del
        // rol: una caja configurada como Touch abre Touch aunque entre un
        // administrador. Si no hay perfil (instalaciones existentes) es
        // RETAIL_POS y el comportamiento es el de siempre.
        await this.caps.load(true);

        /* Y del paquete, no del nombre del rol. Antes decía `rol == 'cajero'`,
           que dejaba al Encargado en el panel de estadísticas aunque su trabajo
           empiece en la caja igual que el del Operador. Lo que decide es si
           esta persona puede ver los números del negocio: si no puede, la
           pantalla de estadísticas sería una pantalla de errores. */
        const verNumeros = this.authService.puede(PAQUETES.REPORTES_VER);
        if (this.caps.deviceProfile() === 'TOUCH_POS' || !verNumeros) {
          // Una sola definicion de donde vende esta caja, la misma que usa el
          // guard de las rutas de venta. Antes esta era la UNICA linea que
          // miraba el perfil, y por eso cambiarlo exigia volver a entrar.
          this.router.navigate([this.caps.rutaDeVenta]);
        } else {
          this.router.navigate(['/dashboard/estadisticas']);
        }
      } else {
        this.mensaje = resultado?.message || 'Usuario o contraseña inválidos';
      }
    } catch (e: any) {
      console.error('❌ Error en login:', e);
      this.mensaje = e?.message || 'Ocurrió un error al iniciar sesión';
    }
  }

  onInputChange() {
    this.mensaje = '';
    this.advertencia = '';
  }
}
