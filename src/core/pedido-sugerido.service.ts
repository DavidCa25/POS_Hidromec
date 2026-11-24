import { Injectable } from '@angular/core';

/**
 * 0090 · EL PEDIDO SUGERIDO, DE ALERTAS A COMPRAS.
 *
 * Alertas lee lo que se acaba agrupado por proveedor
 * (`compras:pedido-sugerido` → sp_purchase_order_suggestions) y, al tocar
 * «Registrar como compra», deja aquí el pedido de UN proveedor y navega a
 * Registrar compra, que lo toma una sola vez (`tomar()`) y llena la compra.
 *
 * Nada de esto registra: la compra es la de siempre, con su botón, sus
 * validaciones y su permiso. El pedido solo precarga renglones y se queda como
 * referencia para comparar contra lo que diga el ticket (lo que llegó).
 */

/** Un renglón tal como lo devuelve sp_purchase_order_suggestions. */
export interface FilaPedidoSugerido {
  supplier_id: number | null;
  supplier_name: string | null;
  supplier_phone: string | null;
  product_id: number;
  product_name: string;
  base_uom: string;
  stock: number;
  prom_diario: number;
  dias_restantes: number;
  presentation_id: number | null;
  presentation_name: string | null;
  presentation_factor: number | null;
  /** En unidad base, ya redondeado a la presentación. */
  pedir: number;
  /** Por unidad base, sin IVA. */
  costo: number;
  /* 0092 · lo que aprendió de las compras */
  dias_con_existencia?: number | null;
  ciclo_dias?: number | null;
  entrega_dias?: number | null;
  cobertura_dias?: number | null;
  proxima_compra?: unknown;
}

/** Un renglón del pedido en la unidad en que se compra (cajas, paquetes o piezas). */
export interface LineaPedido {
  productId: number;
  nombre: string;
  presentationId: number | null;
  presentacion: string;
  factor: number;
  /** En presentaciones: 3 cajas. */
  cantidad: number;
  /** Por presentación, sin IVA: el de la última compra × factor. */
  costo: number;
  incluido: boolean;
  diasRestantes: number;
  stock: number;
  baseUom: string;
}

export interface PedidoProveedor {
  supplierId: number | null;
  nombre: string;
  telefono: string | null;
  lineas: LineaPedido[];
  /** 0092 · cada cuántos días se le compra (null: menos de 3 compras en 120 días). */
  cicloDias?: number | null;
  /** 0092 · cuánto tarda en surtir un pedido mandado (null: no se ha medido). */
  entregaDias?: number | null;
  /** 0092 · para cuántos días alcanza lo que se pide. */
  coberturaDias?: number | null;
  proximaCompra?: unknown;
}

@Injectable({ providedIn: 'root' })
export class PedidoSugeridoService {
  private pendiente: PedidoProveedor | null = null;
  private get api() { return (window as any).electronAPI; }

  /** El pedido de cada proveedor; «Sin proveedor» al final. */
  async cargar(diasAlerta = 7, diasObjetivo = 7): Promise<{ ok: true; pedidos: PedidoProveedor[] } | { ok: false; error: string }> {
    const r = await this.api?.comprasPedidoSugerido?.({ dias_alerta: diasAlerta, dias_objetivo: diasObjetivo });
    if (!r?.success) return { ok: false, error: r?.error || 'No se pudo armar el pedido sugerido.' };
    return { ok: true, pedidos: PedidoSugeridoService.agrupar(r.data ?? []) };
  }

  static agrupar(filas: FilaPedidoSugerido[]): PedidoProveedor[] {
    const grupos = new Map<string, PedidoProveedor>();
    for (const f of filas) {
      const k = f.supplier_id == null ? 'sin' : String(f.supplier_id);
      if (!grupos.has(k)) grupos.set(k, {
        supplierId: f.supplier_id, nombre: f.supplier_name || 'Sin proveedor', telefono: f.supplier_phone || null, lineas: [],
        cicloDias: f.ciclo_dias ?? null, entregaDias: f.entrega_dias ?? null,
        coberturaDias: f.cobertura_dias ?? null, proximaCompra: f.proxima_compra ?? null,
      });
      const factor = Number(f.presentation_factor) > 1 ? Number(f.presentation_factor) : 1;
      grupos.get(k)!.lineas.push({
        productId: f.product_id,
        nombre: f.product_name,
        presentationId: factor > 1 ? f.presentation_id : null,
        presentacion: factor > 1 ? (f.presentation_name || `×${factor}`) : (f.base_uom || 'pza'),
        factor,
        cantidad: Math.max(1, Math.ceil(Number(f.pedir) / factor)),
        costo: Math.round(Number(f.costo || 0) * factor * 100) / 100,
        incluido: true,
        diasRestantes: Number(f.dias_restantes),
        stock: Number(f.stock),
        baseUom: f.base_uom || 'pza',
      });
    }
    return [...grupos.values()].sort((a, b) => (a.supplierId == null ? 1 : 0) - (b.supplierId == null ? 1 : 0) || a.nombre.localeCompare(b.nombre));
  }

  /** El texto del pedido para mandarlo al proveedor (WhatsApp o copiar). */
  static texto(p: PedidoProveedor, negocio = ''): string {
    const filas = p.lineas.filter(l => l.incluido && l.cantidad > 0)
      .map(l => `• ${l.cantidad} ${l.factor > 1 ? l.presentacion : l.baseUom} de ${l.nombre}`);
    return [`Hola${p.nombre && p.supplierId != null ? ' ' + p.nombre : ''}, te encargo este pedido${negocio ? ' para ' + negocio : ''}:`, ...filas, 'Gracias.'].join('\n');
  }

  /**
   * 0092 · Lo que el pedido sabe del proveedor, en una línea:
   * «Le compras cada ~7 días · tarda 2 días en surtir · alcanza para 9 días».
   * `proxima` llega ya escrita (la pantalla la formatea).
   */
  static memoria(p: PedidoProveedor, proxima = ''): string | null {
    const partes: string[] = [];
    const ciclo = Number(p.cicloDias), entrega = p.entregaDias == null ? NaN : Number(p.entregaDias);
    if (ciclo > 0) partes.push(`Le compras cada ~${ciclo} ${ciclo === 1 ? 'día' : 'días'}`);
    if (entrega >= 0) partes.push(entrega === 0 ? 'surte el mismo día' : `tarda ${entrega} ${entrega === 1 ? 'día' : 'días'} en surtir`);
    if (!partes.length) return null;
    if (proxima) partes.push(`próxima compra: ${proxima}`);
    if (Number(p.coberturaDias) > 0) partes.push(`el pedido alcanza para ${p.coberturaDias} días`);
    return partes.join(' · ');
  }

  /** 0092 · Se mandó o se copió: con la compra que llegue se mide la entrega. */
  async enviado(p: PedidoProveedor, via: 'WHATSAPP' | 'COPIA') {
    if (p.supplierId == null) return;
    try { await this.api?.comprasPedidoEnviado?.({ supplier_id: p.supplierId, via, lineas: p.lineas.filter(l => l.incluido && l.cantidad > 0).length }); }
    catch { /* no impide mandar el pedido */ }
  }

  /** Deja el pedido para que Registrar compra lo tome al abrir. */
  dejar(p: PedidoProveedor) { this.pendiente = { ...p, lineas: p.lineas.filter(l => l.incluido && l.cantidad > 0).map(l => ({ ...l })) }; }

  /** Lo toma una sola vez: volver a entrar a Compras no lo repite. */
  tomar(): PedidoProveedor | null { const p = this.pendiente; this.pendiente = null; return p; }
}
