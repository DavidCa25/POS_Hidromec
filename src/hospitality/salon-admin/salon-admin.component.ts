import {
  ChangeDetectionStrategy, ChangeDetectorRef, Component, OnInit, computed, inject, signal,
} from '@angular/core';
import { NgClass, NgFor, NgIf } from '@angular/common';
import { FormsModule } from '@angular/forms';
import Swal from 'sweetalert2';
import { CapabilityService } from '../../core';
import { WxOpcion, WxSelectComponent } from '../../app/wx-select/wx-select.component';
import { MesitaComponent } from '../mesita/mesita.component';
import { colorEstacion, iconoDeArea, siguienteNombre } from '../hx';

interface Area { id: number; nombre: string; orden: number; }
interface Mesa { id: number; area_id: number; nombre: string; capacidad: number | null; estado: string; }
type Salida = 'PANTALLA' | 'IMPRESORA' | 'AMBOS';
interface Estacion {
  id: number | null; nombre: string; salida: Salida;
  impresora: string | null; ancho_mm: number | null; productos?: number;
}
interface ProductoPrep { product_id: number; nombre: string; part_number: string; category_name: string; station_id: number | null; }

/** «Todos», una estacion por id, o los que no se preparan. */
type FiltroEstacion = 'todos' | 'ninguna' | number;

const LUGARES_POR_DEFECTO = 4;

/**
 * COMO ES EL LOCAL Y QUIEN PREPARA QUE.
 *
 * Dos cosas de configuracion que se hacen una vez y se tocan poco:
 *
 *   SALON       las areas (salon, terraza, barra) y sus mesas, dibujadas
 *               como un plano: cada mesa con sus lugares. Tocar una la
 *               edita ahi mismo, sin ventana encima.
 *   ESTACIONES  donde se prepara cada producto, y como le llegan las
 *               comandas a esa estacion: en pantalla, en papel o en las dos.
 *               Cada estacion tiene un color, el mismo que en la cocina.
 *
 * Cada pestana aparece solo con su modulo encendido.
 */
@Component({
  selector: 'app-salon-admin',
  standalone: true,
  imports: [NgIf, NgFor, NgClass, FormsModule, WxSelectComponent, MesitaComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './salon-admin.component.html',
  styleUrls: ['../hx.css', './salon-admin.component.css'],
})
export class SalonAdminComponent implements OnInit {
  readonly caps = inject(CapabilityService);
  private readonly cd = inject(ChangeDetectorRef);
  private get api(): any { return (window as any).wybix; }
  private get electron(): any { return (window as any).electronAPI; }

  readonly tab = signal<'salon' | 'estaciones'>(this.caps.mesas ? 'salon' : 'estaciones');

  readonly iconoDeArea = iconoDeArea;
  readonly colorEstacion = colorEstacion;

  // ----------------------------------------------------------------- salon
  readonly areas = signal<Area[]>([]);
  readonly mesas = signal<Mesa[]>([]);
  mesasDe(a: Area): Mesa[] { return this.mesas().filter(m => m.area_id === a.id); }
  lugares(m: Mesa): number { return m.capacidad || LUGARES_POR_DEFECTO; }
  lugaresDe(a: Area): number { return this.mesasDe(a).reduce((t, m) => t + this.lugares(m), 0); }
  enUsoDe(a: Area): number { return this.mesasDe(a).filter(m => m.estado !== 'LIBRE').length; }
  siguienteDe(a: Area): string { return siguienteNombre(this.mesasDe(a).map(m => m.nombre)); }

  readonly resumenSalon = computed(() => ({
    areas: this.areas().length,
    mesas: this.mesas().length,
    lugares: this.mesas().reduce((t, m) => t + this.lugares(m), 0),
  }));

  /** La mesa que se esta editando y lo que se lleva escrito. */
  readonly editando = signal<number | null>(null);
  borrador = { nombre: '', capacidad: LUGARES_POR_DEFECTO };
  mesaEditadaEn(a: Area): Mesa | null {
    const id = this.editando();
    return id == null ? null : this.mesasDe(a).find(m => m.id === id) ?? null;
  }

  // ------------------------------------------------------------ estaciones
  readonly estaciones = signal<Estacion[]>([]);
  readonly productos = signal<ProductoPrep[]>([]);
  readonly impresoras = signal<WxOpcion[]>([]);
  readonly recienGuardada = signal<number | null>(null);
  /** Como estaba cada estacion al leerla: para saber si hay algo sin guardar. */
  private guardadas = new Map<number, string>();

  readonly salidas: { valor: Salida; etiqueta: string; icono: string }[] = [
    { valor: 'PANTALLA', etiqueta: 'Pantalla', icono: 'ph-monitor' },
    { valor: 'IMPRESORA', etiqueta: 'Impresora', icono: 'ph-printer' },
    { valor: 'AMBOS', etiqueta: 'Las dos', icono: 'ph-stack' },
  ];
  readonly anchos = [58, 80];

  readonly opcionesEstacion = computed<WxOpcion[]>(() => [
    { valor: null, etiqueta: 'Sin preparación', nota: 'no genera comanda' },
    ...this.estaciones().filter(e => e.id != null).map(e => ({ valor: e.id, etiqueta: e.nombre })),
  ]);

  readonly filtroSig = signal('');
  readonly filtroEst = signal<FiltroEstacion>('todos');

  readonly productosVisibles = computed(() => {
    const f = this.filtroSig().trim().toLowerCase();
    const e = this.filtroEst();
    return this.productos()
      .filter(p => e === 'todos' || (e === 'ninguna' ? p.station_id == null : p.station_id === e))
      .filter(p => !f || `${p.nombre} ${p.part_number} ${p.category_name}`.toLowerCase().includes(f));
  });

  productosDe(id: number | null): number { return this.productos().filter(p => p.station_id === id).length; }

  async ngOnInit(): Promise<void> {
    await Promise.all([
      this.caps.mesas ? this.leerSalon() : Promise.resolve(),
      this.caps.comandas ? this.leerEstaciones() : Promise.resolve(),
    ]);
  }

  private async avisar(r: any, titulo: string): Promise<boolean> {
    if (r?.success) return true;
    await Swal.fire({ icon: 'error', title: titulo, text: r?.error || 'Error.' });
    return false;
  }

  private async pedirTexto(titulo: string, valor = '', etiqueta = 'Nombre'): Promise<string | null> {
    const { value, isConfirmed } = await Swal.fire({
      title: titulo, input: 'text', inputLabel: etiqueta, inputValue: valor,
      showCancelButton: true, confirmButtonText: 'Guardar', cancelButtonText: 'Cancelar',
      inputValidator: (v) => (!String(v || '').trim() ? 'Escribe un nombre.' : null),
    });
    return isConfirmed ? String(value).trim() : null;
  }

  // ----------------------------------------------------------------- salon
  async leerSalon() {
    const r = await this.api?.salon?.get();
    if (!r?.success) return;
    this.areas.set(r.sets?.[0] || []);
    this.mesas.set(r.sets?.[1] || []);
  }

  async nuevaArea() {
    const nombre = await this.pedirTexto('Nueva área');
    if (!nombre) return;
    const r = await this.api.salon.guardarArea({ nombre, orden: this.areas().length + 1 });
    if (await this.avisar(r, 'No se guardó el área')) await this.leerSalon();
  }

  async renombrarArea(a: Area) {
    const nombre = await this.pedirTexto('Renombrar área', a.nombre);
    if (!nombre) return;
    const r = await this.api.salon.guardarArea({ id: a.id, nombre, orden: a.orden });
    if (await this.avisar(r, 'No se guardó el área')) await this.leerSalon();
  }

  async quitarArea(a: Area) {
    const ok = await Swal.fire({
      icon: 'warning', title: `¿Quitar ${a.nombre}?`, text: 'Sus mesas también dejan de aparecer.',
      showCancelButton: true, confirmButtonText: 'Quitar', cancelButtonText: 'Cancelar', confirmButtonColor: '#dc2626',
    });
    if (!ok.isConfirmed) return;
    const r = await this.api.salon.guardarArea({ id: a.id, nombre: a.nombre, activa: false });
    if (await this.avisar(r, 'No se quitó el área')) await this.leerSalon();
  }

  /**
   * Agregar una mesa no pregunta nada: se crea con el nombre que sigue
   * -si el area va T1, T2, la nueva es T3- y se abre para editarla. Quien
   * arma un salon agrega diez mesas seguidas; diez dialogos serian castigo.
   */
  async nuevaMesa(a: Area) {
    const nombre = this.siguienteDe(a);
    const r = await this.api.salon.guardarMesa({
      areaId: a.id, nombre, capacidad: LUGARES_POR_DEFECTO, orden: this.mesasDe(a).length + 1,
    });
    if (!(await this.avisar(r, 'No se guardó la mesa'))) return;
    await this.leerSalon();
    const nueva = this.mesasDe(a).find(m => m.nombre === nombre);
    if (nueva) this.editar(nueva);
  }

  editar(m: Mesa) {
    if (this.editando() === m.id) { this.cerrarEditor(); return; }
    this.borrador = { nombre: m.nombre, capacidad: this.lugares(m) };
    this.editando.set(m.id);
    this.cd.markForCheck();
    setTimeout(() => (document.getElementById('sa-mesa-nombre') as HTMLInputElement | null)?.select(), 60);
  }

  cerrarEditor() { this.editando.set(null); }

  cambiarLugares(d: number) {
    this.borrador = { ...this.borrador, capacidad: Math.max(1, Math.min(12, this.borrador.capacidad + d)) };
  }

  async guardarMesa(m: Mesa) {
    const nombre = this.borrador.nombre.trim();
    if (!nombre) return;
    const r = await this.api.salon.guardarMesa({ id: m.id, areaId: m.area_id, nombre, capacidad: this.borrador.capacidad });
    if (!(await this.avisar(r, 'No se guardó la mesa'))) return;
    this.editando.set(null);
    await this.leerSalon();
  }

  async quitarMesa(m: Mesa) {
    const r = await this.api.salon.guardarMesa({ id: m.id, areaId: m.area_id, nombre: m.nombre, activa: false });
    if (!(await this.avisar(r, 'No se quitó la mesa'))) return;
    this.editando.set(null);
    await this.leerSalon();
  }

  // ------------------------------------------------------------ estaciones
  async leerEstaciones() {
    const [e, p, imp] = await Promise.all([
      this.api?.estaciones?.listar(),
      this.api?.estaciones?.productos(),
      this.electron?.listPrinters?.(),
    ]);
    if (e?.success) {
      const lista: Estacion[] = (e.data || []).map((x: any) => ({ ...x }));
      this.guardadas = new Map(lista.map(x => [x.id as number, this.huella(x)]));
      this.estaciones.set(lista);
    }
    if (p?.success) this.productos.set(p.data || []);
    if (imp?.success) {
      this.impresoras.set((imp.data || []).map((x: any) => ({
        valor: x.name, etiqueta: x.displayName || x.name, nota: x.isDefault ? 'predeterminada' : undefined,
      })));
    }
  }

  private huella(e: Estacion): string {
    const imp = this.usaImpresora(e);
    return JSON.stringify([e.nombre.trim(), e.salida, imp ? e.impresora : null, imp ? Number(e.ancho_mm || 58) : null]);
  }

  /** Una estacion nueva, o una con cambios que aun no se guardaron. */
  sucia(e: Estacion): boolean {
    return e.id == null || this.guardadas.get(e.id) !== this.huella(e);
  }

  iconoSalida(s: Salida): string { return this.salidas.find(x => x.valor === s)?.icono ?? 'ph-monitor'; }

  nuevaEstacion() {
    this.estaciones.update(l => [...l, { id: null, nombre: '', salida: 'PANTALLA', impresora: null, ancho_mm: 58 }]);
    setTimeout(() => {
      const campos = document.querySelectorAll<HTMLInputElement>('.sa-estacion__nombre');
      campos[campos.length - 1]?.focus();
    }, 60);
  }

  anchoDe(e: Estacion): number { return Number(e.ancho_mm || 58); }

  usaImpresora(e: Estacion): boolean { return e.salida === 'IMPRESORA' || e.salida === 'AMBOS'; }

  async guardarEstacion(e: Estacion) {
    const r = await this.api.estaciones.guardar({
      id: e.id, nombre: e.nombre, salida: e.salida,
      impresora: this.usaImpresora(e) ? e.impresora : null,
      anchoMm: this.usaImpresora(e) ? e.ancho_mm : null,
    });
    if (!(await this.avisar(r, 'No se guardó la estación'))) return;
    const id = Number(r.data?.[0]?.id ?? e.id);
    await this.leerEstaciones();
    /* Se confirma en la propia tarjeta, sin ventana encima. */
    this.recienGuardada.set(id);
    setTimeout(() => { if (this.recienGuardada() === id) this.recienGuardada.set(null); }, 1600);
  }

  async quitarEstacion(e: Estacion) {
    if (e.id == null) { this.estaciones.update(l => l.filter(x => x !== e)); return; }
    const ok = await Swal.fire({
      icon: 'warning', title: `¿Quitar ${e.nombre}?`,
      text: 'Sus productos pasan a «sin preparación».',
      showCancelButton: true, confirmButtonText: 'Quitar', cancelButtonText: 'Cancelar', confirmButtonColor: '#dc2626',
    });
    if (!ok.isConfirmed) return;
    const r = await this.api.estaciones.guardar({ id: e.id, nombre: e.nombre, salida: e.salida, impresora: e.impresora, activa: false });
    if (await this.avisar(r, 'No se quitó la estación')) {
      if (this.filtroEst() === e.id) this.filtroEst.set('todos');
      await this.leerEstaciones();
    }
  }

  async asignar(p: ProductoPrep, stationId: number | null) {
    const antes = p.station_id;
    p.station_id = stationId;
    const r = await this.api.estaciones.asignar({ productId: p.product_id, stationId });
    if (!(await this.avisar(r, 'No se asignó la estación'))) p.station_id = antes;
    this.productos.set([...this.productos()]);
  }

  porId = (_: number, x: { id: number | null; nombre?: string }) => `${x.id}-${x.nombre}`;
  /* Una estacion nueva aun no tiene id: su posicion la identifica mientras tanto. */
  porEstacion = (i: number, x: Estacion) => x.id ?? `nueva-${i}`;
  porProducto = (_: number, p: ProductoPrep) => p.product_id;
}
