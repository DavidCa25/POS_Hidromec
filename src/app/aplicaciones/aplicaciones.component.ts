import { ChangeDetectorRef, Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import Swal from 'sweetalert2';
import {
  CATEGORIAS, CapabilityService, Capabilities, MODULOS, ModuleCategory, ModuleDefinition,
} from '../../core';
import { AuthService, PAQUETES } from '../../services/auth.service';

/*
 * Aplicaciones de Wybix: que capacidades opcionales tiene encendidas el
 * negocio.
 *
 * POR QUE NO ESTA EN CONFIGURACION
 * --------------------------------
 * Configuracion es para CONFIGURAR lo que ya existe: la impresora, la red, el
 * ticket, la licencia. Encender Fidelizacion entera no es configurar nada: es
 * decidir que Wybix tenga una parte que antes no tenia. Estaba dentro de
 * "Datos del negocio", junto al RFC, que es donde nadie la buscaria.
 *
 * POR QUE SI ESTA EN EL MENU LATERAL
 * ----------------------------------
 * Vivio un tiempo en el menu de usuario, con el argumento de que se toca dos
 * veces al ano y no merecia sitio permanente. El argumento era malo: el menu
 * de usuario es para la SESION -cerrarla, cambiar de usuario- y un catalogo
 * de modulos del producto no es una preferencia de quien ha entrado. Quien
 * busca "que trae Wybix" mira el menu lateral, y ahi no lo encontraba.
 *
 * Es de primer nivel y siempre visible para un administrador. No depende de
 * ningun modulo: es desde donde se encienden, asi que esconderla dejaria sin
 * forma de activarlos.
 *
 * Lo comprueba scripts/pruebas/modulos-navegacion.mjs, porque esta entrada ya
 * se ha movido de sitio tres veces y cada vez parecia razonable.
 */
@Component({
  selector: 'app-aplicaciones',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './aplicaciones.component.html',
  styleUrls: ['./aplicaciones.component.css'],
})
export class Aplicaciones implements OnInit {
  readonly caps = inject(CapabilityService);
  private readonly router = inject(Router);
  private readonly auth = inject(AuthService);
  private readonly cd = inject(ChangeDetectorRef);

  /**
   * Activar un modulo cambia lo que puede hacer TODO el negocio, en todas las
   * cajas. No es una preferencia del equipo: es la clase de decision que ya
   * exige rol de administrador en el resto de Wybix, y aqui se reutiliza el
   * mismo criterio en vez de inventar otro.
   *
   * El enlace ya se oculta a quien no es administrador, pero esconder un
   * boton no es un permiso: quien llegue por la URL se encuentra la puerta
   * cerrada igual.
   */
  get puedeAdministrar(): boolean { return this.auth.puede(PAQUETES.CONFIGURACION_ADMINISTRAR); }

  /** Cual se esta cambiando ahora mismo, para bloquear solo ese. */
  cambiando = signal<string | null>(null);

  readonly categorias = Object.keys(CATEGORIAS) as ModuleCategory[];
  readonly etiqueta = CATEGORIAS;

  /** Los modulos agrupados, sin categorias vacias. */
  readonly grupos = computed(() =>
    this.categorias
      .map(c => ({ id: c, titulo: CATEGORIAS[c], modulos: MODULOS.filter(m => m.category === c) }))
      .filter(g => g.modulos.length > 0));

  readonly activos = computed(() =>
    MODULOS.filter(m => this.encendido(m)).length);

  async ngOnInit(): Promise<void> {
    if (!this.puedeAdministrar) {
      await Swal.fire({
        icon: 'info',
        title: 'Solo para administradores',
        text: 'Activar o desactivar aplicaciones cambia lo que puede hacer todo el negocio.',
      });
      this.router.navigateByUrl('/dashboard/venta');
      return;
    }
    await this.caps.load(true);
    this.cd.detectChanges();
  }

  encendido(m: ModuleDefinition): boolean {
    return !!this.caps.capabilities()[m.capability as keyof Capabilities];
  }

  /**
   * Apagar pregunta; encender no.
   *
   * Encender es reversible y no destruye nada. Apagar esconde pantallas que
   * pueden tener datos vivos detras -campanas, cupones repartidos-, y quien lo
   * pulsa merece saber que esos datos siguen ahi y no se han borrado.
   */
  async alternar(m: ModuleDefinition): Promise<void> {
    if (!this.puedeAdministrar) return;
    const activo = this.encendido(m);

    if (activo) {
      const conf = await Swal.fire({
        icon: 'warning',
        title: `¿Desactivar ${m.name}?`,
        html: `Desaparecerá del menú y dejará de funcionar en las cajas.<br><br>` +
              `<b>No se borra nada</b>: las campañas, los códigos repartidos y su historial ` +
              `siguen guardados, y vuelven tal cual si la reactivas.`,
        showCancelButton: true,
        confirmButtonText: 'Desactivar',
        cancelButtonText: 'Cancelar',
        confirmButtonColor: '#dc2626',
      });
      if (!conf.isConfirmed) return;
    }

    this.cambiando.set(m.id);
    try {
      await this.caps.setModulo(m.capability as keyof Capabilities, !activo);
      if (!activo) {
        await Swal.fire({
          icon: 'success',
          title: `${m.name} activado`,
          text: m.aparece ? `Ya aparece ${m.aparece}.` : undefined,
          timer: 1600,
          showConfirmButton: false,
        });
      }
    } catch (e: any) {
      await Swal.fire({ icon: 'error', title: 'No se pudo cambiar', text: e?.message || 'Error.' });
    } finally {
      this.cambiando.set(null);
      this.cd.detectChanges();
    }
  }

  abrir(m: ModuleDefinition): void {
    if (m.route && this.encendido(m)) this.router.navigateByUrl(m.route);
  }
}
