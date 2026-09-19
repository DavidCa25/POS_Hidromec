import { ChangeDetectorRef, Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import Swal from 'sweetalert2';
import {
  CATEGORIAS, CapabilityService, Capabilities, GiroServiciosService, MODULOS,
  ModuleCategory, ModuleDefinition, PresetServicios,
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
  readonly giro = inject(GiroServiciosService);
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
    /* El giro se lee siempre, no solo cuando Servicios esta encendido: la
       tarjeta tiene que poder decir de que giro es en cuanto se pinta, y
       preguntarlo despues dejaria un parpadeo justo en la linea que se lee. */
    await this.giro.cargar(true);
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

    /* Servicios no se enciende a secas: se enciende COMO algo. Un taller y
       una barberia usan el mismo modulo y no se parecen al abrirlo, y
       preguntarlo despues -en una pantalla de ajustes que nadie visita- es
       como el modulo acaba usandose con la forma que no le toca.

       La eleccion enciende el modulo ella misma, en el mismo procedimiento y
       la misma transaccion, asi que aqui NO se llama ademas a setModulo:
       serian dos escrituras para una sola decision. */
    if (!activo && m.id === 'servicios') {
      const elegido = await this.preguntarGiro({ primeraVez: true });
      if (!elegido) return;
      this.cambiando.set(m.id);
      try {
        const r = await this.giro.elegir(elegido.id);
        if (!r.ok) throw new Error(r.error);
        await this.caps.load(true);
        await Swal.fire({
          icon: 'success',
          title: `Servicios activado como ${elegido.nombre.toLowerCase()}`,
          text: m.aparece ? `Ya aparece ${m.aparece}.` : undefined,
          timer: 2200,
          showConfirmButton: false,
        });
      } catch (e: any) {
        await Swal.fire({ icon: 'error', title: 'No se pudo activar', text: e?.message || 'Error.' });
      } finally {
        this.cambiando.set(null);
        this.cd.detectChanges();
      }
      return;
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

  /**
   * La pregunta. UNA lista, la del JSON compartido: la misma que ofrece el
   * gestor de demos y la misma que valida el proceso principal.
   *
   * No hay opcion por omision seleccionada. Un giro preseleccionado se acepta
   * sin leerlo -«siguiente, siguiente»- y el negocio acaba con la forma de
   * otro. Que haya que elegir es el punto.
   */
  private async preguntarGiro({ primeraVez }: { primeraVez: boolean })
      : Promise<PresetServicios | null> {
    const actual = this.giro.haElegido() ? this.giro.giro().id : '';
    const opciones = this.giro.catalogo.map(p => `
      <label class="giro-op${p.id === actual ? ' giro-op--actual' : ''}">
        <input type="radio" name="giro" value="${p.id}"${p.id === actual ? ' checked' : ''}>
        <span class="giro-op__ic"><i class="ph ${p.icono}"></i></span>
        <span class="giro-op__txt">
          <b>${p.nombre}</b>
          <small>${p.ejemplos}</small>
        </span>
      </label>`).join('');

    const r = await Swal.fire({
      title: primeraVez ? '¿Qué tipo de negocio tienes?' : 'Cambiar el giro',
      html: `<p class="giro-intro">${primeraVez
        ? 'Wybix deja Servicios listo para tu giro: qué pantalla abre, qué pestañas ' +
          'ofrece y cómo se llama aquí lo que entra a trabajarse.'
        : 'Cambia cómo se presenta el módulo. <b>No se borra nada</b>: las órdenes, ' +
          'los clientes y el historial se quedan exactamente donde están.'}</p>
        <div class="giro-lista">${opciones}</div>`,
      width: 560,
      showCancelButton: true,
      confirmButtonText: primeraVez ? 'Activar Servicios' : 'Guardar el giro',
      cancelButtonText: 'Cancelar',
      focusConfirm: false,
      preConfirm: () => {
        const sel = document.querySelector<HTMLInputElement>('input[name="giro"]:checked');
        if (!sel) { Swal.showValidationMessage('Elige un giro para continuar.'); return null; }
        return sel.value;
      },
    });
    if (!r.isConfirmed || !r.value) return null;
    return this.giro.catalogo.find(p => p.id === r.value) ?? null;
  }

  /**
   * Cambiar de giro con el modulo ya encendido.
   *
   * Es la misma pregunta y el mismo canal: cambiar de giro y elegirlo por
   * primera vez son la misma operacion, y tener dos caminos habria significado
   * que uno de los dos se quedara atras.
   */
  async cambiarGiro(): Promise<void> {
    if (!this.puedeAdministrar) return;
    const elegido = await this.preguntarGiro({ primeraVez: false });
    if (!elegido || elegido.id === this.giro.giro().id) return;

    this.cambiando.set('servicios');
    try {
      const r = await this.giro.elegir(elegido.id);
      if (!r.ok) throw new Error(r.error);
      await Swal.fire({
        icon: 'success',
        title: `Servicios ahora es ${elegido.nombre.toLowerCase()}`,
        timer: 1800,
        showConfirmButton: false,
      });
    } catch (e: any) {
      await Swal.fire({ icon: 'error', title: 'No se pudo cambiar el giro', text: e?.message || 'Error.' });
    } finally {
      this.cambiando.set(null);
      this.cd.detectChanges();
    }
  }

  abrir(m: ModuleDefinition): void {
    if (m.route && this.encendido(m)) this.router.navigateByUrl(m.route);
  }
}
