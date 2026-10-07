import { ChangeDetectorRef, Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import Swal from 'sweetalert2';
import { CapabilityService } from '../../core';
import { AuthService, PAQUETES } from '../../services/auth.service';
import { WxAvatarComponent } from '../wx-avatar/wx-avatar.component';
import { WxSelectComponent, WxOpcion } from '../wx-select/wx-select.component';
import { WxGuideSpeakerComponent } from '../wx-guide/wx-guide-speaker.component';
import { EstadoGuia } from '../wx-guide/guia-tipos';
import { GuiaService } from '../wx-guia/guia.service';

interface Usuario { id: number; usuario: string; rol: string; active: boolean | number; creation_date?: string; }

type ClaveRol = 'admin' | 'supervisor' | 'cajero';

/** Que significa cada paquete dicho como lo diria quien lleva el negocio. */
interface Acceso { paquete: string; titulo: string; detalle: string; icono: string; servicios?: boolean; }

/**
 * Los siete paquetes, en palabras. QUE paquetes tiene cada rol NO se escribe
 * aqui: llega de `security:catalogo`, la misma tabla con la que el proceso
 * principal autoriza. Asi esta pantalla no puede prometer algo que la caja
 * despues niega.
 */
const ACCESOS: Acceso[] = [
  { paquete: PAQUETES.VENTAS_OPERAR, titulo: 'Vender y cobrar', icono: 'ph-cash-register',
    detalle: 'Abrir su turno, vender, cobrar, registrar clientes y sacar el ticket o la factura de la venta.' },
  { paquete: PAQUETES.VENTAS_SUPERVISAR, titulo: 'Autorizar lo delicado', icono: 'ph-shield-check',
    detalle: 'Devoluciones, cancelaciones, abrir el cajón sin venta y cancelar facturas.' },
  { paquete: PAQUETES.INVENTARIO_OPERAR, titulo: 'Inventario y compras', icono: 'ph-package',
    detalle: 'Productos, precios, existencias, conteos, compras y proveedores.' },
  { paquete: PAQUETES.REPORTES_VER, titulo: 'Ver los números', icono: 'ph-chart-line',
    detalle: 'Estadísticas, cortes anteriores, reportes y comisiones.' },
  { paquete: PAQUETES.SERVICIOS_OPERAR, titulo: 'Órdenes y agenda', icono: 'ph-wrench', servicios: true,
    detalle: 'El trabajo diario de servicios: órdenes y citas.' },
  { paquete: PAQUETES.SERVICIOS_ADMINISTRAR, titulo: 'Organizar servicios', icono: 'ph-sliders', servicios: true,
    detalle: 'Catálogo de servicios, profesionales, horarios y comisiones.' },
  { paquete: PAQUETES.CONFIGURACION_ADMINISTRAR, titulo: 'Administrar el negocio', icono: 'ph-gear',
    detalle: 'Usuarios, aplicaciones, MultiCaja, respaldos, datos fiscales y dispositivos.' },
];

/** Los puestos, de arriba abajo en el organigrama. */
const PUESTOS: { clave: ClaveRol; nombre: string; icono: string; lema: string; explica: string }[] = [
  {
    clave: 'admin', nombre: 'Administrador', icono: 'ph-crown-simple',
    lema: 'Decide qué es el negocio.',
    explica: 'El Administrador es quien lleva el negocio: puede hacer todo lo que hacen los demás y, además, '
      + 'es el único que da de alta usuarios, enciende aplicaciones y toca respaldos, datos fiscales y dispositivos.',
  },
  {
    clave: 'supervisor', nombre: 'Encargado', icono: 'ph-user-gear',
    lema: 'Responde por el turno.',
    explica: 'El Encargado vende y cobra como un Operador, pero además autoriza lo delicado —devoluciones, '
      + 'cancelaciones, abrir el cajón sin venta—, lleva el inventario y ve los números. '
      + 'No toca usuarios ni la configuración del negocio.',
  },
  {
    clave: 'cajero', nombre: 'Operador', icono: 'ph-user',
    lema: 'Atiende al cliente.',
    explica: 'El Operador hace el trabajo del día: abre su turno, vende, cobra y registra clientes. '
      + 'Cuando algo necesita autorización, como una devolución o abrir el cajón, se lo pide a un Encargado o al Administrador.',
  },
];

/*
 * USUARIOS Y PERMISOS, COMO UN ORGANIGRAMA.
 *
 * Vivia como una tabla dentro de Configuracion. Salio de ahi por la misma razon
 * que Aplicaciones: dar de alta a una persona y decidir que puede hacer no es
 * configurar la caja, es organizar el equipo. Tiene entrada propia en el menu.
 *
 * Se dibuja por puestos, de arriba abajo, porque la pregunta que responde no
 * es "que usuarios hay" sino "quien puede que". Wybix (la variante de la
 * sesion, la misma que en la guia) explica el puesto o la persona elegida.
 *
 * Solo administradores: los canales `users:*` exigen CONFIGURACION_ADMINISTRAR
 * en el proceso principal; esconder la entrada del menu no es el permiso.
 */
@Component({
  selector: 'app-usuarios',
  standalone: true,
  imports: [CommonModule, FormsModule, WxAvatarComponent, WxSelectComponent, WxGuideSpeakerComponent],
  templateUrl: './usuarios.component.html',
  styleUrls: ['../panel-controls.css', './usuarios.component.css'],
})
export class Usuarios implements OnInit, OnDestroy {
  private readonly auth = inject(AuthService);
  private readonly caps = inject(CapabilityService);
  private readonly router = inject(Router);
  private readonly cd = inject(ChangeDetectorRef);
  readonly guia = inject(GuiaService);
  private get api() { return (window as any).electronAPI; }

  readonly puestos = PUESTOS;
  readonly opcionesRol: WxOpcion[] = PUESTOS.map(p => ({ valor: p.clave, etiqueta: p.nombre, nota: p.lema }));

  readonly usuarios = signal<Usuario[]>([]);
  /** Ids de quienes ya tienen PIN personal (solo sí/no; el PIN nunca viaja). */
  readonly conPin = signal<Set<number>>(new Set());
  readonly cargando = signal(true);
  /** Paquetes de cada rol, tal como los autoriza el proceso principal. */
  private readonly paquetesPorRol = signal<Record<string, string[]>>({});

  /** Lo elegido: un puesto o una persona. Nada = Wybix presenta el equipo. */
  readonly rolElegido = signal<ClaveRol | null>(null);
  readonly personaElegida = signal<number | null>(null);

  readonly estadoWybix = signal<EstadoGuia>('idle');
  private reloj: any = null;

  /* Nuevo usuario */
  showNuevo = false;
  guardando = false;
  form = { usuario: '', password: '', rol: 'cajero' as string };

  get yo(): number | null { return this.auth.usuarioActualId; }

  /** Personas por puesto, activas primero. */
  readonly niveles = computed(() => PUESTOS.map(p => ({
    ...p,
    gente: this.usuarios().filter(u => u.rol === p.clave),
  })));

  /** Un rol que esta version no conoce: entra y no puede hacer nada. */
  readonly sinRol = computed(() =>
    this.usuarios().filter(u => !PUESTOS.some(p => p.clave === u.rol)));

  readonly persona = computed(() =>
    this.usuarios().find(u => u.id === this.personaElegida()) ?? null);

  /** El puesto que se esta explicando: el elegido o el de la persona elegida. */
  readonly puesto = computed(() => {
    const p = this.persona();
    const clave = p ? p.rol : this.rolElegido();
    return PUESTOS.find(x => x.clave === clave) ?? null;
  });

  /** Lo que puede y lo que no, de la tabla real de permisos. */
  readonly accesos = computed(() => {
    const p = this.persona();
    const clave = p ? p.rol : this.rolElegido();
    if (!clave && !p) return null;
    const tiene = new Set(this.paquetesPorRol()[clave ?? ''] ?? []);
    const visibles = ACCESOS.filter(a => !a.servicios || this.caps.servicios);
    return {
      puede: visibles.filter(a => tiene.has(a.paquete)),
      noPuede: visibles.filter(a => !tiene.has(a.paquete)),
    };
  });

  /** Lo que dice Wybix. Entero: sin letra a letra, tambien sin movimiento reducido. */
  readonly frase = computed(() => {
    const p = this.persona();
    const puesto = this.puesto();
    if (p && !puesto) {
      return `${p.usuario} tiene un rol que esta versión no reconoce, así que entra pero no puede hacer nada. `
        + 'Asígnale un puesto para que pueda trabajar.';
    }
    if (p && puesto) {
      const quien = p.id === this.yo ? 'Tú eres' : `${p.usuario} es`;
      const inactivo = p.active ? '' : ' Ahora está desactivado: no puede entrar hasta que lo actives.';
      return `${quien} ${puesto.nombre}. ${puesto.explica}${inactivo}`;
    }
    if (puesto) return puesto.explica;
    const n = this.usuarios().filter(u => u.active).length;
    return `Este es tu equipo: ${n} ${n === 1 ? 'persona activa' : 'personas activas'} en tres puestos. `
      + 'Toca un puesto o a una persona y te explico qué puede hacer.';
  });

  async ngOnInit() {
    if (!this.auth.puede(PAQUETES.CONFIGURACION_ADMINISTRAR)) {
      await Swal.fire({ icon: 'info', title: 'Solo para administradores',
        text: 'Dar de alta personas y decidir qué pueden hacer le corresponde al Administrador.' });
      this.router.navigateByUrl('/dashboard/venta');
      return;
    }
    await Promise.all([this.cargar(), this.cargarCatalogo(), this.caps.load()]);
    this.cd.detectChanges();
  }

  ngOnDestroy() { clearTimeout(this.reloj); }

  private async cargarCatalogo() {
    try {
      const r = await this.api?.securityCatalogo?.();
      if (r?.success) this.paquetesPorRol.set(r.data?.paquetesPorRol ?? {});
    } catch { /* sin catalogo, la pantalla explica pero no lista accesos */ }
  }

  async cargar() {
    this.cargando.set(true);
    try {
      const r = await this.api?.usersList?.();
      this.usuarios.set(r?.success ? (r.data || []) : []);
      const pins = await this.api?.usersPinStatus?.();
      this.conPin.set(new Set<number>(pins?.success ? (pins.data || []) : []));
    } catch {
      this.usuarios.set([]);
    } finally {
      this.cargando.set(false);
    }
  }

  /** Wybix gesticula un momento y vuelve a reposo: el estado es gesto, no personaje. */
  private gesto(e: EstadoGuia, ms = 1400) {
    clearTimeout(this.reloj);
    this.estadoWybix.set(e);
    this.reloj = setTimeout(() => this.estadoWybix.set('idle'), ms);
  }

  elegirPuesto(clave: ClaveRol) {
    this.personaElegida.set(null);
    this.rolElegido.set(this.rolElegido() === clave ? null : clave);
    this.gesto('speaking');
  }

  elegirPersona(u: Usuario) {
    this.rolElegido.set(null);
    this.personaElegida.set(this.personaElegida() === u.id ? null : u.id);
    this.gesto('speaking');
  }

  limpiar() {
    this.rolElegido.set(null);
    this.personaElegida.set(null);
  }

  nombreRol(k: string): string {
    return PUESTOS.find(p => p.clave === k)?.nombre ?? `Sin rol asignado (${k || '—'})`;
  }

  // ------------------------------------------------------------- acciones
  async cambiarRol(u: Usuario, rol: string) {
    if (!rol || u.rol === rol) return;
    const r = await this.api?.usersUpdateRole?.({ id: u.id, rol });
    if (r?.success) { await this.cargar(); this.gesto('success'); }
    else {
      await Swal.fire({ icon: 'error', title: 'No se pudo', text: r?.error || 'Error al cambiar el puesto.' });
      await this.cargar();
    }
  }

  async resetPassword(u: Usuario) {
    const { value: pass } = await Swal.fire({
      title: `Nueva contraseña de ${u.usuario}`,
      input: 'password',
      inputPlaceholder: 'Mínimo 6 caracteres',
      showCancelButton: true,
      confirmButtonText: 'Guardar',
      cancelButtonText: 'Cancelar',
      inputValidator: (v) => (!v || v.length < 6) ? 'Mínimo 6 caracteres' : undefined,
    });
    if (!pass) return;
    const r = await this.api?.usersResetPassword?.({ id: u.id, password: pass });
    if (r?.success) await Swal.fire({ icon: 'success', title: 'Contraseña actualizada', timer: 1200, showConfirmButton: false });
    else await Swal.fire({ icon: 'error', title: 'No se pudo', text: r?.error || 'Error.' });
  }

  /**
   * PIN PERSONAL. Sirve para autorizar en caja (p. ej. cerrar el turno de otra
   * persona) y es el mismo con el que se entra a las Pantallas Operativas. Lo
   * pone un administrador; se teclea dos veces y no se muestra.
   */
  async asignarPin(u: Usuario) {
    const res = await Swal.fire({
      title: `PIN de ${u.usuario}`,
      html: `<p style="font-size:14px;color: var(--wx-text-muted);margin:0 0 10px;">
               De 4 a 8 números. Sirve para autorizar en caja y para entrar a las Pantallas Operativas.</p>
             <input id="pin-1" type="password" inputmode="numeric" maxlength="8" class="swal2-input" placeholder="PIN" autocomplete="off">
             <input id="pin-2" type="password" inputmode="numeric" maxlength="8" class="swal2-input" placeholder="Repite el PIN" autocomplete="off">`,
      showCancelButton: true, confirmButtonText: 'Guardar', cancelButtonText: 'Cancelar', focusConfirm: false,
      preConfirm: () => {
        const a = (document.getElementById('pin-1') as HTMLInputElement)?.value ?? '';
        const b = (document.getElementById('pin-2') as HTMLInputElement)?.value ?? '';
        if (!/^\d{4,8}$/.test(a)) { Swal.showValidationMessage('De 4 a 8 números.'); return false; }
        if (a !== b) { Swal.showValidationMessage('Los dos PIN no coinciden.'); return false; }
        return a;
      },
    });
    if (!res.isConfirmed || !res.value) return;
    const r = await this.api?.usersSetPin?.({ id: u.id, pin: res.value });
    if (r?.success) {
      await this.cargar();
      await Swal.fire({ icon: 'success', title: 'PIN guardado', timer: 1200, showConfirmButton: false });
    } else await Swal.fire({ icon: 'error', title: 'No se pudo', text: r?.error || 'Error.' });
  }

  async toggleActivo(u: Usuario) {
    const r = await this.api?.usersSetActive?.({ id: u.id, active: !u.active });
    if (r?.success) { await this.cargar(); this.gesto('success'); }
    else await Swal.fire({ icon: 'error', title: 'No se pudo', text: r?.error || 'Error.' });
  }

  nuevo(rol: string = 'cajero') {
    this.form = { usuario: '', password: '', rol };
    this.showNuevo = true;
  }
  cerrarNuevo() { this.showNuevo = false; }

  async guardarNuevo() {
    if (this.form.usuario.trim().length < 3) { await Swal.fire({ icon: 'warning', title: 'Usuario muy corto', text: 'Mínimo 3 caracteres.' }); return; }
    if (this.form.password.length < 6) { await Swal.fire({ icon: 'warning', title: 'Contraseña muy corta', text: 'Mínimo 6 caracteres.' }); return; }
    this.guardando = true;
    try {
      const r = await this.api?.usersCreate?.({ usuario: this.form.usuario.trim(), password: this.form.password, rol: this.form.rol });
      if (!r?.success) throw new Error(r?.error || 'No se pudo crear.');
      this.showNuevo = false;
      await this.cargar();
      const creado = this.usuarios().find(u => u.usuario === this.form.usuario.trim());
      if (creado) { this.rolElegido.set(null); this.personaElegida.set(creado.id); }
      this.gesto('success');
    } catch (e: any) {
      await Swal.fire({ icon: 'error', title: 'Error', text: e?.message || 'No se pudo crear el usuario.' });
    } finally {
      this.guardando = false;
    }
  }
}
