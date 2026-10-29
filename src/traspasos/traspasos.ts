import { Component, OnInit, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { WxSelectComponent, type WxOpcion } from '../app/wx-select/wx-select.component';
import { TraspasosMapaComponent, type MapaEnvio, type MapaEtiqueta } from './mapa/traspasos-mapa.component';
import { FechaSqlPipe } from '../core';

/**
 * TRASPASOS ENTRE SUCURSALES (MultiSucursal).
 *
 *   - Enviar: sale del inventario de ESTA sucursal en el momento (BRANCH_OUT).
 *     Sin Internet también se envía; la otra sucursal lo ve cuando vuelva.
 *   - Por recibir: lo que otra sucursal mandó aquí. Se cuenta lo que llegó y
 *     solo eso entra al inventario (BRANCH_IN).
 *   - Historial: enviado, recibido y diferencia, de los dos lados.
 *
 * Quien envía y quien recibe salen de la sesión, no de la pantalla.
 */
interface Sucursal { id: string; nombre: string; es_matriz: boolean; }
interface Entrante { id: string; from_location_id: string; from_nombre: string; note: string | null; sent_at: string; sent_by_name: string | null;
  lines: Array<{ product_uuid: string; nombre: string; qty: number }>; }

@Component({
  selector: 'app-traspasos',
  standalone: true,
  imports: [FechaSqlPipe, CommonModule, FormsModule, WxSelectComponent, TraspasosMapaComponent],
  templateUrl: './traspasos.html',
  styleUrls: ['../eventos/eventos.css', './traspasos.css'],
})
export class Traspasos implements OnInit {
  private get api() { return (window as any).electronAPI; }

  cargando = signal(true);
  error = signal<string | null>(null);
  aviso = signal<string | null>(null);
  activo = signal(false);
  /** La nube contestó: solo entonces «no tiene MultiSucursal» es verdad. */
  conocido = signal(false);
  locationId = signal<string | null>(null);
  sucursales = signal<Sucursal[]>([]);
  porRecibir = signal<Entrante[]>([]);
  historial = signal<any[]>([]);
  productos = signal<Array<{ product_uuid: string; nombre: string; stock: number; decimales: boolean }>>([]);

  destino: string | null = null;
  productoElegido: string | null = null;
  cantidad: number | null = null;
  nota = '';
  lineas = signal<Array<{ product_uuid: string; nombre: string; qty: number }>>([]);
  enviando = signal(false);
  /** Lo que llegó de cada producto, por traspaso: arranca con lo enviado. */
  recibido: Record<string, Record<string, number>> = {};

  readonly opcionesDestino = computed<WxOpcion[]>(() => this.sucursales()
    .filter((s) => s.id !== this.locationId())
    .map((s) => ({ valor: s.id, etiqueta: s.nombre, nota: s.es_matriz ? 'Matriz' : undefined })));
  readonly opcionesProductos = computed<WxOpcion[]>(() => this.productos().map((p) => ({
    valor: p.product_uuid, etiqueta: p.nombre, nota: `Hay ${p.stock}`,
  })));

  /* -------------------------------------------- el mapa (la pantalla misma) */
  readonly aquiNombre = computed(() => this.sucursales().find((s) => s.id === this.locationId())?.nombre ?? '');
  /** Lo que todavía no se recibe: lo que viene aquí y lo que salió de aquí. */
  readonly enCamino = computed<MapaEnvio[]>(() => [
    ...this.porRecibir().map((t) => ({ clave: 'in:' + t.id, desdeId: t.from_location_id, haciaId: this.locationId(),
      desdeNombre: t.from_nombre, haciaNombre: this.aquiNombre(), piezas: t.lines.reduce((a, l) => a + Number(l.qty || 0), 0),
      hora: t.sent_at, quien: t.sent_by_name, entrante: true, lineas: t.lines.map((l) => ({ nombre: l.nombre, qty: Number(l.qty) })) })),
    ...this.historial().filter((h) => h.kind === 'BRANCH_OUT' && h.status === 'SENT').map((h) => ({
      clave: 'out:' + (h.transfer_uuid || h.created_at), desdeId: this.locationId(),
      haciaId: this.sucursales().find((s) => s.nombre === h.event_name)?.id ?? null,
      desdeNombre: this.aquiNombre(), haciaNombre: h.event_name, piezas: Number(h.total_sent || 0),
      hora: h.created_at, quien: null, entrante: false,
      lineas: (h.lineas ?? []).map((l: any) => ({ nombre: l.nombre ?? l.product_name ?? 'Producto', qty: Number(l.qty_sent ?? l.qty ?? 0) })) })),
  ]);

  /** La sucursal del panel de la derecha (tu sucursal, si no tocaron otra). */
  readonly sucursalElegida = signal<string | null>(null);
  readonly panel = computed(() => {
    const id = this.sucursalElegida() ?? this.locationId();
    const s = this.sucursales().find((x) => x.id === id) ?? null;
    if (!s) return null;
    const aqui = s.id === this.locationId();
    return { ...s, aqui,
      entrantes: aqui ? this.porRecibir() : [],
      hacia: this.enCamino().filter((e) => !e.entrante && e.haciaId === s.id) };
  });
  /** El envío del seguimiento de abajo (el que tocaron, o el primero). */
  readonly envioElegido = signal<string | null>(null);
  readonly seguimiento = computed(() => this.enCamino().find((e) => e.clave === this.envioElegido()) ?? this.enCamino()[0] ?? null);

  /** Existencia de aquí, para el panel: lo que más hay, con su estado. */
  readonly existenciaAqui = computed(() => [...this.productos()].sort((a, b) => b.stock - a.stock).slice(0, 6)
    .map((p) => ({ nombre: p.nombre, stock: p.stock, tono: p.stock <= 0 ? 'falta' : p.stock <= 5 ? 'pocas' : 'bien' })));
  readonly kpis = computed(() => {
    const salen = this.enCamino().filter((e) => !e.entrante), vienen = this.enCamino().filter((e) => e.entrante);
    const hoy = new Date().toDateString();
    const enviadoHoy = this.historial().filter((h) => h.kind === 'BRANCH_OUT' && new Date(h.created_at).toDateString() === hoy);
    return {
      enCamino: salen.reduce((a, e) => a + e.piezas, 0), envios: salen.length,
      porRecibir: vienen.reduce((a, e) => a + e.piezas, 0), entrantes: vienen.length,
      enviadoHoy: enviadoHoy.reduce((a, h) => a + Number(h.total_sent || 0), 0), enviosHoy: enviadoHoy.length,
    };
  });
  /** Lo que dice la etiqueta de cada local en el mapa. */
  readonly etiquetas = computed<Record<string, MapaEtiqueta>>(() => {
    const out: Record<string, MapaEtiqueta> = {};
    for (const s of this.sucursales()) {
      if (s.id === this.locationId()) {
        const vienen = this.kpis().porRecibir;
        out[s.id] = vienen ? { sub: `Por recibir: ${vienen} piezas`, tono: 'acc' }
          : this.enHorno() ? { sub: `${this.enHorno()} tanda(s) en el horno`, tono: 'warn' } : { sub: 'Estás aquí', tono: null };
      } else {
        const van = this.enCamino().filter((e) => !e.entrante && e.haciaId === s.id).reduce((a, e) => a + e.piezas, 0);
        out[s.id] = van ? { sub: `Le llegan ${van} piezas`, tono: 'acc' } : { sub: 'Toca para mandarle', tono: null };
      }
    }
    return out;
  });
  /** Tandas en preparación aquí (si esta caja ve Producción): el horno del mapa. */
  readonly enHorno = signal(0);

  /* Ventanas: enviar, recibir e historial. Nada de formularios debajo del mapa. */
  readonly ventana = signal<'enviar' | 'recibir' | 'historial' | null>(null);
  readonly recibiendo = signal<Entrante | null>(null);

  elegirSucursal(id: string) { this.sucursalElegida.set(id); }
  tocarEnvio(e: MapaEnvio) {
    this.envioElegido.set(e.clave);
    if (e.entrante) this.abrirRecibir(this.porRecibir().find((t) => 'in:' + t.id === e.clave) ?? null);
  }
  abrirEnviar(id: string) { this.destino = id; this.lineas.set([]); this.nota = ''; this.error.set(null); this.ventana.set('enviar'); }
  abrirRecibir(t: Entrante | null) { if (!t) return; this.recibiendo.set(t); this.error.set(null); this.ventana.set('recibir'); }
  cerrarVentana() { if (!this.enviando()) { this.ventana.set(null); this.recibiendo.set(null); } }
  nombreDestino() { return this.sucursales().find((s) => s.id === this.destino)?.nombre ?? ''; }
  hora(iso: string | null) {
    if (!iso) return '';
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });
  }

  async ngOnInit() { await this.cargar(); }

  async cargar() {
    this.cargando.set(true);
    this.error.set(null);
    try {
      const e = await this.api?.multiEstado?.();
      if (!e?.success) throw new Error(e?.error || 'No se pudo leer el estado de las sucursales.');
      this.conocido.set(true);
      this.activo.set(!!e.data.multisucursal);
      this.locationId.set(e.data.locationId ?? null);
      this.sucursales.set(e.data.sucursales ?? []);
      if (!e.data.multisucursal) return;
      const [t, p] = await Promise.all([this.api?.multiTraspasos?.(), this.api?.multiProductosTraspaso?.()]);
      if (!t?.success) throw new Error(t?.error || 'No se pudieron leer los traspasos.');
      this.porRecibir.set(t.data.porRecibir ?? []);
      for (const x of this.porRecibir()) {
        this.recibido[x.id] ??= Object.fromEntries(x.lines.map((l) => [l.product_uuid, Number(l.qty)]));
      }
      const lineas: any[] = t.data.lineas ?? [];
      this.historial.set((t.data.historial ?? []).map((h: any) => ({ ...h, lineas: lineas.filter((l) => l.transfer_uuid === h.transfer_uuid) })));
      this.productos.set((p?.data ?? []).map((x: any) => ({ ...x, stock: Number(x.stock) })));
      // El horno del mapa: solo si esta caja ve Producción (si no, el canal lo niega y no pasa nada).
      try {
        const b = await (window as any).wybix?.produccion?.tablero?.({});
        this.enHorno.set(b?.success ? (b.data.tandas ?? []).filter((x: any) => x.status === 'IN_PROGRESS').length : 0);
      } catch { this.enHorno.set(0); }
      if (!this.destino && this.opcionesDestino().length === 1) this.destino = this.opcionesDestino()[0].valor;
    } catch (err: any) {
      this.error.set(err?.message ?? 'Error inesperado.');
    } finally {
      this.cargando.set(false);
    }
  }

  agregar() {
    const p = this.productos().find((x) => x.product_uuid === this.productoElegido);
    const q = Number(this.cantidad);
    if (!p || !(q > 0)) return;
    if (!p.decimales && !Number.isInteger(q)) { this.error.set(`${p.nombre} se maneja en piezas enteras.`); return; }
    if (q > p.stock) { this.error.set(`Solo hay ${p.stock} de ${p.nombre}.`); return; }
    this.error.set(null);
    this.lineas.update((l) => [...l.filter((x) => x.product_uuid !== p.product_uuid), { product_uuid: p.product_uuid, nombre: p.nombre, qty: q }]);
    this.productoElegido = null;
    this.cantidad = null;
  }
  quitar(uuid: string) { this.lineas.update((l) => l.filter((x) => x.product_uuid !== uuid)); }

  async enviar() {
    const s = this.sucursales().find((x) => x.id === this.destino);
    if (!s || !this.lineas().length) return;
    this.enviando.set(true);
    this.error.set(null);
    this.aviso.set(null);
    try {
      const r = await this.api?.multiTraspasoEnviar?.({ toLocationId: s.id, toNombre: s.nombre, nota: this.nota || null,
        lineas: this.lineas().map((l) => ({ product_uuid: l.product_uuid, qty: l.qty })) });
      if (!r?.success) throw new Error(r?.error || 'No se pudo enviar.');
      const piezas = this.lineas().reduce((a, l) => a + l.qty, 0);
      this.aviso.set(r.data.enNube
        ? `${piezas} piezas salieron hacia ${s.nombre}. Ya aparecen para recibir allá.`
        : `${piezas} piezas salieron hacia ${s.nombre}. Sin conexión: ${s.nombre} lo verá en cuanto esta caja se conecte.`);
      this.lineas.set([]);
      this.nota = '';
      this.ventana.set(null);
      await this.cargar();
    } catch (err: any) {
      this.error.set(err?.message ?? 'No se pudo enviar.');
    } finally {
      this.enviando.set(false);
    }
  }

  async recibir(t: Entrante) {
    this.error.set(null);
    this.aviso.set(null);
    const r = await this.api?.multiTraspasoRecibir?.({ traspaso: t, recibido: this.recibido[t.id] });
    if (!r?.success) { this.error.set(r?.error || 'No se pudo recibir el traspaso.'); return; }
    this.aviso.set(`Recibido de ${t.from_nombre}. La mercancía ya está en el inventario de esta sucursal.`);
    this.ventana.set(null);
    this.recibiendo.set(null);
    await this.cargar();
  }

  async cancelar(h: any) {
    this.error.set(null);
    const r = await this.api?.multiTraspasoCancelar?.({ id: h.transfer_uuid });
    if (!r?.success) { this.error.set(r?.error || 'No se pudo cancelar.'); return; }
    this.aviso.set(`Traspaso a ${h.event_name} cancelado. La mercancía regresó a este inventario.`);
    await this.cargar();
  }

  estado(h: any): string {
    if (h.status === 'CANCELLED') return 'Cancelado';
    if (h.status === 'RECEIVED') return h.kind === 'BRANCH_IN' ? 'Recibido aquí' : 'Recibido';
    return 'En camino';
  }
}
