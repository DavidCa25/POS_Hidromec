import { Component, OnInit, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { WxSelectComponent, type WxOpcion } from '../app/wx-select/wx-select.component';

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
  imports: [CommonModule, FormsModule, WxSelectComponent],
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
