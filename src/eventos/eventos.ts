import { Component, OnInit, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import * as QRCode from 'qrcode';
import { WxSelectComponent, type WxOpcion } from '../app/wx-select/wx-select.component';

/**
 * ENVÍOS A EVENTOS (Fase 2).
 *
 * Una feria vende con la mercancía que le manda su sucursal base. Aquí:
 *   - Enviar: sale del inventario de ESTA sucursal (TRANSFER_OUT) y se genera
 *     un comprobante QR firmado por esta caja. La tablet lo recibe por la
 *     nube o, sin Internet, escaneando el QR.
 *   - Retornos por recibir: lo que la feria regresó; se cuenta lo que llegó y
 *     entra al inventario (RETURN_TRANSFER_IN). Si difiere, queda la diferencia.
 *   - Historial: enviado, recibido y diferencia de cada transferencia.
 *
 * Quien envía y quien recibe salen de la sesión, no de la pantalla.
 */
interface Evento { location_id: string; nombre: string; event_status: string; starts_at: string | null; ends_at: string | null; }
interface Retorno { transfer_uuid: string; event_location_uuid: string; event_name: string; lines: Array<{ product_uuid: string; product_name: string; qty_sent: string; qty_received?: string }>; }

@Component({
  selector: 'app-eventos',
  standalone: true,
  imports: [CommonModule, FormsModule, WxSelectComponent],
  templateUrl: './eventos.html',
  styleUrls: ['./eventos.css'],
})
export class Eventos implements OnInit {
  private get api() { return (window as any).electronAPI; }

  cargando = signal(true);
  error = signal<string | null>(null);
  sinConexion = signal(false);
  eventos = signal<Evento[]>([]);
  retornos = signal<Retorno[]>([]);
  historial = signal<any[]>([]);
  productos = signal<Array<{ id: number; nombre: string; stock: number }>>([]);

  eventoElegido: string | null = null;
  productoElegido: number | null = null;
  cantidad: number | null = null;
  nota = '';
  lineas = signal<Array<{ product_id: number; nombre: string; qty: number }>>([]);
  enviando = signal(false);
  resultado = signal<{ qr: string | null; total: number; evento: string } | null>(null);

  readonly opcionesEventos = computed<WxOpcion[]>(() => this.eventos().map((e) => ({
    valor: e.location_id, etiqueta: e.nombre, nota: e.event_status === 'OPEN' ? 'Abierto' : e.event_status === 'PLANNED' ? 'Planeado' : 'Cerrado',
  })));
  readonly opcionesProductos = computed<WxOpcion[]>(() => this.productos().map((p) => ({
    valor: p.id, etiqueta: p.nombre, nota: `Hay ${p.stock}`, desactivada: p.stock <= 0,
  })));

  async ngOnInit() { await this.cargar(); }

  async cargar() {
    this.cargando.set(true);
    this.error.set(null);
    try {
      const [r, p] = await Promise.all([this.api?.transferenciasListar?.(), this.api?.getActiveProducts?.()]);
      if (!r?.success) throw new Error(r?.error || 'No se pudieron leer las transferencias.');
      this.sinConexion.set(!!r.sinConexion);
      this.eventos.set(r.events ?? []);
      this.retornos.set((r.returns ?? []).map((x: Retorno) => ({ ...x, lines: x.lines.map((l) => ({ ...l, qty_received: String(Number(l.qty_sent)) })) })));
      const lineas: any[] = r.lineas ?? [];
      this.historial.set((r.transferencias ?? []).map((t: any) => ({ ...t, lineas: lineas.filter((l) => l.transfer_uuid === t.transfer_uuid) })));
      const lista = (p?.data ?? p ?? []) as any[];
      this.productos.set(lista.map((x) => ({ id: Number(x.id ?? x.product_id), nombre: String(x.nombre ?? x.name), stock: Number(x.stock ?? 0) })));
      if (!this.eventoElegido && this.eventos().length) this.eventoElegido = this.eventos()[0].location_id;
    } catch (e: any) {
      this.error.set(e?.message ?? 'Error inesperado.');
    } finally {
      this.cargando.set(false);
    }
  }

  agregar() {
    const p = this.productos().find((x) => x.id === this.productoElegido);
    const q = Number(this.cantidad);
    if (!p || !(q > 0)) return;
    if (q > p.stock) { this.error.set(`Solo hay ${p.stock} de ${p.nombre}.`); return; }
    this.error.set(null);
    this.lineas.update((l) => [...l.filter((x) => x.product_id !== p.id), { product_id: p.id, nombre: p.nombre, qty: q }]);
    this.productoElegido = null;
    this.cantidad = null;
  }
  quitar(id: number) { this.lineas.update((l) => l.filter((x) => x.product_id !== id)); }

  async enviar() {
    const ev = this.eventos().find((e) => e.location_id === this.eventoElegido);
    if (!ev || !this.lineas().length) return;
    this.enviando.set(true);
    this.error.set(null);
    try {
      const r = await this.api?.transferenciasEnviar?.({
        event_location_uuid: ev.location_id, event_name: ev.nombre, note: this.nota || null,
        lines: this.lineas().map((l) => ({ product_id: l.product_id, qty: l.qty })),
      });
      if (!r?.success) throw new Error(r?.error || 'No se pudo enviar.');
      const qr = r.qr ? await QRCode.toDataURL(r.qr, { errorCorrectionLevel: 'M', margin: 2, width: 360 }) : null;
      this.resultado.set({ qr, total: this.lineas().reduce((a, l) => a + l.qty, 0), evento: ev.nombre });
      this.lineas.set([]);
      this.nota = '';
      await this.cargar();
    } catch (e: any) {
      this.error.set(e?.message ?? 'No se pudo enviar.');
    } finally {
      this.enviando.set(false);
    }
  }

  async recibir(r: Retorno) {
    this.error.set(null);
    const res = await this.api?.transferenciasRecibirRetorno?.({
      transfer_uuid: r.transfer_uuid, event_location_uuid: r.event_location_uuid, event_name: r.event_name,
      lines: r.lines.map((l) => ({ product_uuid: l.product_uuid, qty_sent: Number(l.qty_sent), qty_received: Number(l.qty_received ?? l.qty_sent) })),
    });
    if (!res?.success) { this.error.set(res?.error || 'No se pudo recibir el retorno.'); return; }
    await this.cargar();
  }

  imprimirQr() { window.print(); }
}
