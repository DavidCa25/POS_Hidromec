import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import Swal from 'sweetalert2';
import {
  CapabilityService, ElectronBridge, GASTO_REGLAS, GastoRegla, PayloadSocios, REGLAS, Regla,
  SociosService, dinero, fechaLocal, repartir,
} from '../../core';
import { WxDateComponent } from '../wx-date/wx-date.component';
import { WxSelectComponent, WxOpcion } from '../wx-select/wx-select.component';

/*
 * ASISTENTE DE SOCIOS (0079). docs/socios.md 1.8.
 *
 * Es como se ACTIVA la aplicacion (desde Aplicaciones) y tambien como se
 * cambia despues. Ocho pasos cortos; nada se guarda hasta el final, y el
 * final guarda todo y enciende el modulo en una sola transaccion
 * (sp_socios_config_guardar @activar = 1).
 *
 * El ejemplo del paso 4 se calcula aqui con los duenos que se estan
 * eligiendo, con un producto REAL del negocio: la persona ve cuanto se
 * llevaria cada quien de una venta suya antes de decidir.
 */

interface FilaSocio { clave: string; id?: number; nombre: string; userId: number | null; pctFijo: number | null; activo: boolean; }
/** El dueno de una categoria: '' = sin dueno, 'COMP' = compartida, o la clave de un socio. */
interface FilaCategoria { id: number; nombre: string; productos: number; dueno: string; pcts: Record<string, number>; }

const PASOS = ['Socios', 'Qué es de quién', 'Sin dueño', 'Ganancia', 'Gastos', 'Faltantes', 'Liquidación', 'Inicio'];
const DIAS = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];

@Component({
  selector: 'app-socios-asistente',
  standalone: true,
  imports: [CommonModule, FormsModule, WxSelectComponent, WxDateComponent],
  templateUrl: './socios-asistente.component.html',
  styleUrls: ['./socios.css'],
})
export class SociosAsistenteComponent implements OnInit {
  private readonly svc = inject(SociosService);
  private readonly caps = inject(CapabilityService);
  private readonly bridge = inject(ElectronBridge);
  private readonly router = inject(Router);

  readonly PASOS = PASOS;
  readonly REGLAS = REGLAS;
  readonly GASTO_REGLAS = GASTO_REGLAS;
  readonly dinero = dinero;
  readonly MAX = 10;

  paso = signal(0);
  cargando = signal(true);
  guardando = signal(false);
  error = signal('');
  /** Ya estaba activado: se guarda sin encender y el boton dice Guardar. */
  yaActivo = signal(false);
  hayLiquidaciones = signal(false);

  socios = signal<FilaSocio[]>([]);
  categorias = signal<FilaCategoria[]>([]);
  usuarios = signal<WxOpcion[]>([]);
  sinDueno = signal<string>('');
  regla = signal<Regla>('C');
  pctVende = signal(30);
  gastoRegla = signal<GastoRegla>('IGUALES');
  faltanteRegla = signal<'VENTAS' | 'IGUALES'>('VENTAS');
  liquidacion = signal<'SEMANAL' | 'MENSUAL'>('SEMANAL');
  diaCierre = signal(7);
  inicio = signal(fechaLocal());

  ejemplo = signal<{ producto: any; insumos: any[]; opciones: any[] } | null>(null);

  readonly opcionesDia: WxOpcion[] = DIAS.map((d, i) => ({ valor: i + 1, etiqueta: d }));
  readonly activos = computed(() => this.socios().filter(s => s.activo));
  readonly opcionesSocio = computed<WxOpcion[]>(() => this.activos().map(s => ({ valor: s.clave, etiqueta: s.nombre || 'Sin nombre' })));
  readonly opcionesDuenoCategoria = computed<WxOpcion[]>(() => [
    { valor: '', etiqueta: 'Sin dueño' },
    ...this.opcionesSocio(),
    { valor: 'COMP', etiqueta: 'Compartida…', nota: 'por porcentaje' },
  ]);
  readonly opcionesSinDueno = computed<WxOpcion[]>(() => [
    { valor: '', etiqueta: 'Partes iguales entre todos' },
    ...this.opcionesSocio(),
  ]);
  readonly opcionesEjemplo = computed<WxOpcion[]>(() =>
    (this.ejemplo()?.opciones ?? []).map(p => ({ valor: p.id, etiqueta: p.nombre, nota: dinero(p.precio) })));
  readonly sumaFijo = computed(() => this.activos().reduce((a, s) => a + (Number(s.pctFijo) || 0), 0));

  /** De quien es una categoria (clave -> fraccion), con lo que se esta eligiendo. */
  private duenosDe(categoriaId: number | null): Map<string, number> {
    const c = this.categorias().find(x => x.id === categoriaId);
    const m = new Map<string, number>();
    if (c?.dueno === 'COMP') for (const [k, v] of Object.entries(c.pcts)) { if (v > 0) m.set(k, v / 100); }
    else if (c?.dueno) m.set(c.dueno, 1);
    if (!m.size) {
      if (this.sinDueno()) m.set(this.sinDueno(), 1);
      else for (const s of this.activos()) m.set(s.clave, 1 / this.activos().length);
    }
    return m;
  }

  /** El ejemplo: A, B y C (con el % elegido) para una unidad del producto. */
  readonly tablaEjemplo = computed(() => {
    const e = this.ejemplo();
    if (!e?.producto) return null;
    const precio = Number(e.producto.precio) || 0;
    const vende = this.duenosDe(e.producto.category_id);
    const costos = new Map<string, number>();
    for (const i of e.insumos) {
      for (const [s, f] of this.duenosDe(i.category_id)) costos.set(s, (costos.get(s) ?? 0) + Number(i.costo) * f);
    }
    const nombre = (k: string) => this.activos().find(s => s.clave === k)?.nombre || k;
    const reglas = [
      { id: 'A', titulo: 'A. Quien vende', r: repartir(precio, vende, costos, 100) },
      { id: 'B', titulo: 'B. Quien aporta', r: repartir(precio, vende, costos, 0) },
      { id: 'C', titulo: `C. Mixta, ${this.pctVende()} % a quien vende`, r: repartir(precio, vende, costos, this.pctVende()) },
    ];
    const claves = this.activos().map(s => s.clave).filter(k => reglas.some(x => x.r.has(k)) || costos.has(k) || vende.has(k));
    return {
      producto: e.producto.nombre, precio, costo: [...costos.values()].reduce((a, b) => a + b, 0),
      aporta: claves.map(k => ({ nombre: nombre(k), costo: costos.get(k) ?? 0 })).filter(x => x.costo > 0),
      vende: [...vende.keys()].map(nombre).join(', '),
      socios: claves.map(nombre),
      filas: reglas.map(x => ({ id: x.id, titulo: x.titulo, montos: claves.map(k => x.r.get(k)?.total ?? 0) })),
    };
  });

  async ngOnInit(): Promise<void> {
    const [cfg, users] = await Promise.all([this.svc.config(), this.cargarUsuarios()]);
    this.usuarios.set(users);
    if (!cfg.ok) { this.error.set(cfg.error); this.cargando.set(false); return; }
    const d = cfg.data;
    const c = d.config;
    this.yaActivo.set(!!c?.activo);
    this.hayLiquidaciones.set(!!c?.hay_liquidaciones);
    const filas: FilaSocio[] = d.socios.filter(s => s.activo).map(s => ({
      clave: `id${s.id}`, id: s.id, nombre: s.nombre, userId: s.user_id, pctFijo: s.pct_fijo, activo: true,
    }));
    while (filas.length < 2) filas.push(this.nuevoSocio(filas.length));
    this.socios.set(filas);

    const porCategoria = new Map<number, FilaCategoria>();
    for (const k of d.categorias) {
      const f = porCategoria.get(k.categoria_id) ?? { id: k.categoria_id, nombre: k.categoria, productos: k.productos, dueno: '', pcts: {} };
      if (k.socio_id) f.pcts[`id${k.socio_id}`] = Number(k.pct);
      porCategoria.set(k.categoria_id, f);
    }
    for (const f of porCategoria.values()) {
      const ks = Object.keys(f.pcts);
      f.dueno = ks.length === 1 && f.pcts[ks[0]] === 100 ? ks[0] : ks.length ? 'COMP' : '';
    }
    this.categorias.set([...porCategoria.values()]);

    if (c) {
      this.regla.set(c.regla); this.pctVende.set(c.regla === 'C' ? Number(c.pct_vende) : 30);
      this.gastoRegla.set(c.gasto_regla); this.faltanteRegla.set(c.faltante_regla);
      this.sinDueno.set(c.sin_dueno_socio_id ? `id${c.sin_dueno_socio_id}` : '');
      this.liquidacion.set(c.liquidacion); this.diaCierre.set(c.dia_cierre ?? 7);
      this.inicio.set(String(c.inicio).slice(0, 10));
    }
    await this.cambiarEjemplo(null);
    this.cargando.set(false);
  }

  private async cargarUsuarios(): Promise<WxOpcion[]> {
    try {
      const r = await this.bridge.api?.getActiveUsers?.();
      return [{ valor: null, etiqueta: 'Sin usuario' },
        ...((r?.data ?? []) as any[]).map(u => ({ valor: u.id, etiqueta: u.usuario, nota: u.rol }))];
    } catch { return [{ valor: null, etiqueta: 'Sin usuario' }]; }
  }

  private nuevoSocio(i: number): FilaSocio {
    return { clave: `n${Date.now().toString(36)}${i}`, nombre: '', userId: null, pctFijo: null, activo: true };
  }

  agregarSocio(): void {
    if (this.activos().length >= this.MAX) return;
    this.socios.update(l => [...l, this.nuevoSocio(l.length)]);
  }

  /** Un socio guardado no se borra: se desactiva y lo suyo vuelve a "sin dueño". */
  quitarSocio(s: FilaSocio): void {
    if (this.activos().length <= 2) return;
    this.socios.update(l => s.id ? l.map(x => x === s ? { ...x, activo: false } : x) : l.filter(x => x !== s));
    this.categorias.update(l => l.map(c => {
      const pcts = { ...c.pcts }; delete pcts[s.clave];
      return { ...c, dueno: c.dueno === s.clave ? '' : c.dueno, pcts };
    }));
    if (this.sinDueno() === s.clave) this.sinDueno.set('');
  }

  cambiarSocio(s: FilaSocio, campo: 'nombre' | 'userId' | 'pctFijo', valor: any): void {
    this.socios.update(l => l.map(x => x === s ? { ...x, [campo]: campo === 'pctFijo' ? (valor === '' ? null : Number(valor)) : valor } : x));
  }

  cambiarDueno(c: FilaCategoria, dueno: string): void {
    this.categorias.update(l => l.map(x => {
      if (x !== c) return x;
      if (dueno !== 'COMP') return { ...x, dueno, pcts: dueno ? { [dueno]: 100 } : {} };
      const n = this.activos().length, base = Math.floor(10000 / n) / 100;
      const pcts: Record<string, number> = {};
      this.activos().forEach((s, i) => pcts[s.clave] = i === 0 ? +(100 - base * (n - 1)).toFixed(2) : base);
      return { ...x, dueno, pcts };
    }));
  }

  cambiarPct(c: FilaCategoria, clave: string, v: any): void {
    this.categorias.update(l => l.map(x => x === c ? { ...x, pcts: { ...x.pcts, [clave]: Number(v) || 0 } } : x));
  }

  sumaCategoria(c: FilaCategoria): number { return Object.values(c.pcts).reduce((a, b) => a + (Number(b) || 0), 0); }

  async cambiarEjemplo(id: number | null): Promise<void> {
    const r = await this.svc.ejemplo(id);
    if (r.ok) this.ejemplo.set(r.data);
  }

  /** Lo que falta para pasar del paso actual, o '' si se puede. */
  readonly falta = computed(() => {
    const p = this.paso();
    const a = this.activos();
    if (p === 0) {
      if (a.length < 2) return 'Hacen falta al menos 2 socios.';
      if (a.length > this.MAX) return `Son ${this.MAX} socios como máximo.`;
      if (a.some(s => !s.nombre.trim())) return 'Cada socio necesita un nombre.';
      const nombres = a.map(s => s.nombre.trim().toLowerCase());
      if (new Set(nombres).size !== nombres.length) return 'Dos socios no pueden llamarse igual.';
      const us = a.map(s => s.userId).filter(u => u != null);
      if (new Set(us).size !== us.length) return 'Un usuario no puede ser dos socios.';
    }
    if (p === 1) {
      const mal = this.categorias().find(c => c.dueno === 'COMP' && Math.abs(this.sumaCategoria(c) - 100) > 0.01);
      if (mal) return `Lo de «${mal.nombre}» debe sumar 100 %.`;
    }
    if (p === 4 && this.gastoRegla() === 'FIJO' && Math.abs(this.sumaFijo() - 100) > 0.01)
      return 'Los porcentajes de los socios deben sumar 100.';
    if (p === 7 && !this.inicio()) return 'Indica desde cuándo se llevan las cuentas.';
    return '';
  });

  siguiente(): void { if (!this.falta() && this.paso() < PASOS.length - 1) this.paso.update(p => p + 1); }
  anterior(): void { if (this.paso() > 0) this.paso.update(p => p - 1); }
  ir(i: number): void { if (i < this.paso()) this.paso.set(i); }

  private payload(): PayloadSocios {
    return {
      regla: this.regla(), pctVende: this.regla() === 'A' ? 100 : this.regla() === 'B' ? 0 : this.pctVende(),
      gastoRegla: this.gastoRegla(), faltanteRegla: this.faltanteRegla(),
      sinDueno: this.sinDueno() || null, liquidacion: this.liquidacion(),
      diaCierre: this.liquidacion() === 'SEMANAL' ? this.diaCierre() : null, inicio: this.inicio(),
      socios: this.socios().map(s => ({ clave: s.clave, id: s.id, nombre: s.nombre.trim(), userId: s.userId,
        pctFijo: s.pctFijo, activo: s.activo })),
      categorias: this.categorias().filter(c => c.dueno).map(c => ({
        categoriaId: c.id,
        duenos: Object.entries(c.pcts).filter(([, v]) => v > 0).map(([socio, pct]) => ({ socio, pct })),
      })),
    };
  }

  async terminar(): Promise<void> {
    if (this.falta() || this.guardando()) return;
    this.guardando.set(true);
    this.error.set('');
    const r = this.yaActivo() ? await this.svc.guardar(this.payload()) : await this.svc.activar(this.payload());
    this.guardando.set(false);
    if (!r.ok) { this.error.set(r.error); return; }
    await this.caps.load(true);
    await Swal.fire({
      icon: 'success', title: this.yaActivo() ? 'Cambios guardados' : 'Socios activado',
      text: 'Cada venta se reparte desde ahora. Los productos pueden tener su propio dueño en «Pertenece a».',
      timer: 2600, showConfirmButton: false,
    });
    this.router.navigateByUrl('/dashboard/socios');
  }

  cancelar(): void { this.router.navigateByUrl(this.yaActivo() ? '/dashboard/socios' : '/dashboard/aplicaciones'); }
}
