import { ChangeDetectorRef, Component, OnDestroy, OnInit } from '@angular/core';
import { NgIf, NgFor } from '@angular/common';
import { FormsModule } from '@angular/forms';
import Swal from 'sweetalert2';
import { RegisterService } from '../../services/register.service';
import { LicenseService } from '../../services/license.service';

/**
 * Una caja, con quien la tiene.
 *
 * `estado` lo resuelve SQL, no esta pantalla: el arriendo se mide con el reloj
 * del SERVIDOR. Si lo calculara el navegador, una caja se veria libre u
 * ocupada segun lo adelantado que fuera el reloj de cada equipo.
 */
interface Register {
  id: number;
  code: string;
  name: string;
  is_active: boolean;
  created_at?: string;
  estado?: 'LIBRE' | 'MIA' | 'OCUPADA';
  holder_machine_name?: string | null;
  segundos_restantes?: number | null;
  ultimo_equipo?: string | null;
}

@Component({
  selector: 'app-registers-panel',
  standalone: true,
  imports: [NgIf, NgFor, FormsModule],
  templateUrl: './register-panel.component.html',
  styleUrls: ['./register-panel.component.css']
})
export class RegistersPanel implements OnInit, OnDestroy {
  registers: Register[] = [];
  currentId: number | null = null;

  nuevoNombre = '';
  loading = false;
  busyAdd = false;
  busyId: number | null = null;
  /**
   * Por que no se pudo leer el catalogo, si es que no se pudo.
   *
   * Antes, `listRs?.data ?? []` convertia un error del canal en una lista
   * vacia: la pantalla decia "No hay cajas" tanto cuando de verdad no habia
   * como cuando la consulta habia fallado. Son dos situaciones distintas y el
   * usuario tiene que poder distinguirlas.
   */
  errorCarga: string | null = null;

  /**
   * Se refresca sola mientras la pantalla esta abierta.
   *
   * Es la pantalla donde alguien mira para saber si la otra caja ya soltó la
   * suya. Obligarle a pulsar "recargar" para ver un arriendo que caduca solo
   * seria pedirle que adivine cuando mirar.
   */
  private refresco: any = null;

  constructor(
    private registerSvc: RegisterService,
    public license: LicenseService,
    private cd: ChangeDetectorRef,
  ) {}

  private get api() {
    return (window as any).electronAPI;
  }

  async ngOnInit() {
    await this.cargar();
    this.refresco = setInterval(() => { this.cargar(true); }, 20000);
  }

  ngOnDestroy() {
    if (this.refresco) { clearInterval(this.refresco); this.refresco = null; }
  }

  async cargar(silencioso = false) {
    if (!silencioso) this.loading = true;
    this.errorCarga = null;
    try {
      // `registersAssignments` trae lo mismo que `registersList` MAS el estado
      // del arriendo. `registersList` sigue existiendo para el resto de la app.
      const fn = this.api?.registersAssignments ?? this.api?.registersList;
      if (typeof fn !== 'function') {
        throw new Error('Esta version no expone el catalogo de cajas.');
      }
      // `false` = todas, activas e inactivas. El catalogo se ve completo; la
      // inactiva se marca, no se esconde: esconderla haria parecer que se
      // borro.
      const listRs = await fn(false);
      if (listRs && listRs.success === false) {
        throw new Error(listRs.error || 'No se pudo leer el catalogo de cajas.');
      }
      this.registers = Array.isArray(listRs?.data) ? listRs.data : [];

      const curRs = await this.api?.registerGetCurrent?.();
      this.currentId = curRs?.data?.registerId ?? null;
    } catch (e: any) {
      console.error('[REGISTERS] cargar:', e);
      if (!silencioso) this.registers = [];
      this.errorCarga = e?.message || 'No se pudo leer el catalogo de cajas.';
    } finally {
      this.loading = false;
      // Las promesas de `ipcRenderer.invoke` nacen en el preload, FUERA de la
      // zona de Angular: cuando esta funcion termina no hay ninguna deteccion
      // de cambios pendiente y la vista se queda como estaba. Por eso el panel
      // podia tener las cajas en memoria y pintar la lista vacia.
      this.cd.detectChanges();
    }
  }

  esActual(r: Register): boolean {
    return this.currentId === r.id;
  }

  /** La tiene OTRO equipo, ahora mismo. */
  ocupadaPorOtro(r: Register): boolean {
    return r.estado === 'OCUPADA';
  }

  quienLaTiene(r: Register): string {
    return r.holder_machine_name || 'otro equipo';
  }

  nombreDe(id: number | null): string {
    const r = this.registers.find(x => x.id === id);
    return r ? r.name : 'Caja asignada';
  }

  async elegirCaja(r: Register) {
    if (!r.is_active) {
      await Swal.fire({ icon: 'warning', title: 'Caja inactiva', text: 'Activa la caja antes de asignarla a esta máquina.' });
      return;
    }
    if (this.esActual(r)) return;

    this.busyId = r.id;
    try {
      // El backend RECLAMA antes de guardar. Si otra máquina la tiene, aquí no
      // cambia nada y el mensaje dice cuál es esa máquina.
      await this.registerSvc.setCurrent(r.id, r.name);
      this.currentId = r.id;
      await this.cargar(true);
      await Swal.fire({ icon: 'success', title: `Esta máquina es ${r.name}`, timer: 1200, showConfirmButton: false });
    } catch (e: any) {
      await this.cargar(true);
      await Swal.fire({
        icon: 'warning',
        title: 'Esa caja está ocupada',
        text: e?.message || 'No se pudo asignar la caja.',
      });
    } finally {
      this.busyId = null;
      this.cd.detectChanges();
    }
  }

  /**
   * Liberar la caja de un equipo que ya no existe.
   *
   * El arriendo caduca solo en unos minutos, asi que esto NO es lo que evita
   * que una caja quede bloqueada para siempre. Es el atajo para cuando la
   * maquina que la tenia fue robada, reinstalada o sustituida y nadie quiere
   * esperar. Por eso pregunta: usarlo con la otra caja encendida le quitaria
   * su identidad en mitad de un turno.
   */
  async liberar(r: Register) {
    const conf = await Swal.fire({
      icon: 'warning',
      title: `¿Liberar ${r.name}?`,
      html: `Ahora mismo la tiene <b>${this.quienLaTiene(r)}</b>.<br><br>` +
            'Hazlo solo si ese equipo ya no existe o está apagado de forma definitiva. ' +
            'Si sigue encendido y vendiendo, perderá su caja.',
      showCancelButton: true,
      confirmButtonText: 'Liberar',
      cancelButtonText: 'Cancelar',
      confirmButtonColor: '#dc2626',
    });
    if (!conf.isConfirmed) return;

    this.busyId = r.id;
    try {
      const rs = await this.api?.registerReleaseAdmin?.({ id: r.id });
      if (!rs?.success) {
        await Swal.fire({ icon: 'error', title: 'No se pudo liberar', text: rs?.error || 'Error.' });
        return;
      }
      await this.cargar(true);
      await Swal.fire({ icon: 'success', title: 'Caja liberada', timer: 1100, showConfirmButton: false });
    } catch (e: any) {
      await Swal.fire({ icon: 'error', title: 'Error', text: e?.message || 'Error inesperado.' });
    } finally {
      this.busyId = null;
      this.cd.detectChanges();
    }
  }

  async crearCaja() {
    const name = this.nuevoNombre.trim();
    if (!name) {
      await Swal.fire({ icon: 'warning', title: 'Falta el nombre', text: 'Escribe el nombre de la caja (ej. Caja 2).' });
      return;
    }

    this.busyAdd = true;
    try {
      const rs = await this.api?.registersAdd?.({ name });
      if (!rs?.success) {
        await Swal.fire({ icon: 'error', title: 'No se pudo crear', text: rs?.error || 'Error al crear la caja.' });
        return;
      }
      this.nuevoNombre = '';
      await this.cargar();
      await Swal.fire({ icon: 'success', title: 'Caja creada', timer: 1100, showConfirmButton: false });
    } catch (e: any) {
      await Swal.fire({ icon: 'error', title: 'Error', text: e?.message || 'Error inesperado.' });
    } finally {
      this.busyAdd = false;
      this.cd.detectChanges();
    }
  }

  async toggleActiva(r: Register) {
    try {
      const rs = await this.api?.registersSetActive?.({ id: r.id, is_active: !r.is_active });
      if (!rs?.success) {
        await Swal.fire({ icon: 'error', title: 'No se pudo cambiar', text: rs?.error || 'Error.' });
        return;
      }
      await this.cargar();
    } catch (e: any) {
      await Swal.fire({ icon: 'error', title: 'Error', text: e?.message || 'Error inesperado.' });
    }
  }
}
