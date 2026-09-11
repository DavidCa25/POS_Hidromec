import { ChangeDetectorRef, Component, OnInit } from '@angular/core';
import { NgIf, NgFor, NgClass } from '@angular/common';
import Swal from 'sweetalert2';
import { LicenseService } from '../../services/license.service';

interface Punto {
  clave: string;
  estado: 'ok' | 'falta' | 'desconocido';
  titulo: string;
  detalle: string;
  elevacion: boolean;
}

interface Diagnostico {
  esServidor: boolean;
  listo: boolean;
  puntos: Punto[];
  requiereElevacion: boolean;
  faltaContrasena: boolean;
  accion: 'no-es-servidor' | 'necesita-multicaja' | 'preparar' | 'falta-contrasena' | 'listo';
  servidor: string;
  usuario: string;
  baseDatos: string;
  puerto: number;
  equipo: string;
  ips: { interfaz: string; ip: string }[];
  rotadaEn: string | null;
  puedeGuardarContrasena: boolean;
}

/**
 * Preparar esta máquina para que otras cajas se conecten.
 *
 * POR QUÉ EXISTE ESTA PANTALLA
 * ----------------------------
 * El asistente de instalación ya deja todo listo cuando alguien instala de
 * cero y elige "Servidor Principal". Pero el camino normal de un cliente no es
 * ese: prueba 30 días, o empieza con MonoCaja, y compra MultiCaja después. En
 * ese caso el asistente no vuelve a correr, nadie crea la cuenta de red y —si
 * SQL ya estaba instalado— tampoco se configuran el puerto, el firewall ni el
 * SQL Browser. Hasta ahora la única salida era reinstalar o abrir SSMS.
 */
@Component({
  selector: 'app-red-multicaja-panel',
  standalone: true,
  imports: [NgIf, NgFor, NgClass],
  templateUrl: './red-multicaja.component.html',
  styleUrls: ['./red-multicaja.component.css'],
})
export class RedMulticajaPanel implements OnInit {
  diag: Diagnostico | null = null;
  cargando = false;
  trabajando = false;
  error: string | null = null;

  /** La contraseña visible AHORA. Nunca se guarda en el componente entre visitas. */
  contrasena: string | null = null;
  contrasenaGuardada = false;
  copiado = false;

  constructor(public license: LicenseService, private cd: ChangeDetectorRef) {}

  private get api() { return (window as any).electronAPI; }

  async ngOnInit() { await this.revisar(); }

  async revisar() {
    this.cargando = true;
    this.error = null;
    try {
      if (typeof this.api?.networkDiagnose !== 'function') {
        throw new Error('Esta versión no incluye la preparación de red.');
      }
      const rs = await this.api.networkDiagnose(this.license.permiteMulticaja ? 'multi' : 'mono');
      if (!rs?.success) throw new Error(rs?.error || 'No se pudo revisar la red.');
      this.diag = rs.data;
    } catch (e: any) {
      this.error = e?.message || 'No se pudo revisar la red.';
    } finally {
      this.cargando = false;
      // Las promesas del preload nacen fuera de la zona de Angular: sin esto
      // la pantalla se queda con lo que tenía aunque los datos ya estén.
      this.cd.detectChanges();
    }
  }

  get puntosFalta(): Punto[] { return (this.diag?.puntos ?? []).filter(p => p.estado === 'falta'); }
  get puntosOk(): Punto[] { return (this.diag?.puntos ?? []).filter(p => p.estado === 'ok'); }
  get puntosDudosos(): Punto[] { return (this.diag?.puntos ?? []).filter(p => p.estado === 'desconocido'); }

  iconoDe(p: Punto): string {
    if (p.estado === 'ok') return 'ph-check-circle';
    if (p.estado === 'falta') return 'ph-x-circle';
    return 'ph-question';
  }

  /** Preparar por primera vez, o volver a pasar: hace lo mismo, es idempotente. */
  async preparar() {
    const conf = await Swal.fire({
      icon: 'question',
      title: 'Preparar esta máquina como servidor',
      html:
        'Windows va a pedirte permiso de administrador. Wybix configurará el puerto, el firewall ' +
        'y la cuenta con la que se conectan las demás cajas.<br><br>' +
        '<b>Si hay que cambiar la configuración de SQL Server, el servicio se reiniciará</b>, así que ' +
        'hazlo en un momento en el que nadie esté cobrando.',
      showCancelButton: true,
      confirmButtonText: 'Preparar',
      cancelButtonText: 'Ahora no',
    });
    if (!conf.isConfirmed) return;
    await this.ejecutar(false);
  }

  /**
   * Rotar la contraseña.
   *
   * Se advierte ANTES, no después: cambiarla deja fuera a las cajas que ya
   * estaban conectadas hasta que alguien vuelva a escribirla en cada una. Eso
   * no es un efecto colateral, es lo que se le pide a una rotación, pero quien
   * la pulsa tiene que saberlo mientras todavía puede echarse atrás.
   */
  async rotar() {
    const conf = await Swal.fire({
      icon: 'warning',
      title: '¿Generar una contraseña nueva?',
      html:
        'La contraseña actual dejará de funcionar.<br><br>' +
        '<b>Todas las cajas secundarias que ya estén conectadas tendrán que volver a introducir ' +
        'la nueva</b> para poder seguir vendiendo.',
      showCancelButton: true,
      confirmButtonText: 'Generar nueva',
      cancelButtonText: 'Cancelar',
      confirmButtonColor: '#dc2626',
    });
    if (!conf.isConfirmed) return;
    await this.ejecutar(true);
  }

  private async ejecutar(rotar: boolean) {
    this.trabajando = true;
    this.error = null;
    this.cd.detectChanges();
    try {
      const rs = await this.api.networkPrepare({ rotar });
      if (!rs?.success) {
        // El script escribe qué pasos llegó a completar antes de fallar: decir
        // "no se pudo" sin decir dónde dejaría a alguien sin nada que hacer.
        const pasos: any[] = rs?.data?.pasos ?? [];
        const hechos = pasos.filter(p => p.estado !== 'ya-estaba').map(p => `· ${p.paso}: ${p.detalle}`);
        this.error = rs?.error || 'No se pudo preparar la red.';
        await Swal.fire({
          icon: 'error',
          title: 'No se pudo terminar',
          html: `${this.error}` + (hechos.length ? `<br><br><small>${hechos.join('<br>')}</small>` : ''),
        });
        return;
      }
      this.contrasena = rs.data.contrasena;
      this.contrasenaGuardada = !!rs.data.guardada;
      await this.revisar();
      await Swal.fire({
        icon: 'success',
        title: rotar ? 'Contraseña nueva lista' : 'Esta máquina ya es el servidor',
        text: 'Abajo tienes los datos para configurar la otra caja.',
        timer: 1800,
        showConfirmButton: false,
      });
    } catch (e: any) {
      this.error = e?.message || 'Error inesperado.';
    } finally {
      this.trabajando = false;
      this.cd.detectChanges();
    }
  }

  /** Volver a ver la contraseña guardada, para dar de alta una tercera caja. */
  async verContrasena() {
    try {
      const rs = await this.api?.networkRevealPassword?.();
      if (!rs?.success) {
        await Swal.fire({ icon: 'info', title: 'No hay contraseña guardada', text: rs?.error || '' });
        return;
      }
      this.contrasena = rs.data.contrasena;
      this.contrasenaGuardada = true;
    } catch (e: any) {
      await Swal.fire({ icon: 'error', title: 'Error', text: e?.message || '' });
    } finally {
      this.cd.detectChanges();
    }
  }

  ocultarContrasena() { this.contrasena = null; this.copiado = false; }

  async copiar(texto: string) {
    try {
      await navigator.clipboard.writeText(texto);
      this.copiado = true;
      setTimeout(() => { this.copiado = false; this.cd.detectChanges(); }, 1600);
    } catch { /* sin portapapeles: el texto sigue visible para copiarlo a mano */ }
    this.cd.detectChanges();
  }

  /** El servidor tal y como hay que escribirlo en la otra caja. */
  get servidorParaSecundaria(): string {
    const ip = this.diag?.ips?.[0]?.ip;
    const inst = (this.diag?.servidor || '').split('\\')[1];
    if (!ip) return this.diag?.servidor || '';
    return inst ? `${ip}\\${inst}` : ip;
  }
}
