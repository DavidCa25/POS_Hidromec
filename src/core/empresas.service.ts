import { Injectable, computed, inject, signal } from '@angular/core';
import { ElectronBridge } from './electron-bridge.service';

/*
 * MULTIEMPRESA (0080). docs/multiempresa.md.
 *
 * Las empresas del mismo dueño:
 *   locales   en ESTA computadora (otra base del mismo SQL Server): se entra.
 *   remotas   en OTRA computadora: se consultan por la nube y se les piden
 *             cambios por bandeja.
 *
 * Las reglas viven en el proceso principal (electron/empresas/) y en SQL; aquí
 * solo se habla con él y se guarda lo que la barra superior necesita pintar.
 */

export interface EmpresaLocal {
  base: string; nombre: string; giro: 'RETAIL' | 'HOSPITALITY' | string;
  esEsta: boolean; puedeEntrar: boolean;
}
export interface EmpresaRemota {
  companyId: string; nombre: string; ultimaSync: string | null;
  ubicaciones: { id: string; nombre: string }[];
}
export interface EstadoEmpresas {
  activa: EmpresaLocal | null; locales: EmpresaLocal[]; remotas: EmpresaRemota[]; administra: boolean;
}
export interface ResumenEmpresa {
  nombre: string; base?: string; companyId?: string; giro?: string;
  ventas: number; tickets: number; utilidad: number | null; turnosAbiertos: number; efectivoEnCaja: number;
  ultimaVenta: string | null; ultimaSync?: string | null; error: string | null; esEsta?: boolean;
}
export interface ProductoRemoto { uuid: string; nombre: string; precio: number; vendible: boolean; categoria_uuid: string | null; }
export type TipoPedido = 'PRODUCTO_ALTA' | 'PRODUCTO_PRECIO';
export interface PedidoEnviado {
  id: string; empresa: string; companyId: string; tipo: TipoPedido; datos: any;
  estado: 'PENDIENTE' | 'ENTREGADO' | 'APLICADO' | 'RECHAZADO'; detalle: string | null;
  pidio: string | null; creado: string; resuelto: string | null;
}
export interface CambioRecibido {
  comando_id: string; tipo: TipoPedido; origen_empresa: string; origen_usuario: string | null;
  payload: any; resultado: 'APLICADO' | 'RECHAZADO'; detalle: string | null; aplicado_en: string;
}

export type ResultadoEmpresas<T> = { ok: true; data: T } | { ok: false; error: string; code?: string | null };

export const ESTADOS_PEDIDO: Record<PedidoEnviado['estado'], { etiqueta: string; tono: 'neutro' | 'espera' | 'bien' | 'mal' }> = {
  PENDIENTE: { etiqueta: 'En camino', tono: 'espera' },
  ENTREGADO: { etiqueta: 'Recibido, aplicando', tono: 'espera' },
  APLICADO: { etiqueta: 'Aplicado', tono: 'bien' },
  RECHAZADO: { etiqueta: 'No se aplicó', tono: 'mal' },
};

@Injectable({ providedIn: 'root' })
export class EmpresasService {
  private readonly bridge = inject(ElectronBridge);

  /** Lo que pinta el selector. null = todavía no se pregunta o no aplica. */
  readonly estado = signal<EstadoEmpresas | null>(null);
  /** Hay a dónde cambiar o algo que consultar: el selector se abre. */
  readonly hayOtras = computed(() => {
    const e = this.estado();
    return !!e && (e.locales.length > 0 || e.remotas.length > 0);
  });
  readonly cambiando = signal<string | null>(null);

  private async llamar<T>(fn: string, p?: any): Promise<ResultadoEmpresas<T>> {
    const api = this.bridge.api;
    if (!api?.[fn]) return { ok: false, error: 'Esta caja no tiene MultiEmpresa.' };
    try {
      const r = await api[fn](p);
      return r?.success ? { ok: true, data: r.data as T } : { ok: false, error: r?.error || 'No se pudo completar.', code: r?.code ?? null };
    } catch (e: any) {
      return { ok: false, error: e?.message || 'No se pudo completar.' };
    }
  }

  async cargar(): Promise<ResultadoEmpresas<EstadoEmpresas>> {
    const r = await this.llamar<EstadoEmpresas>('empresasListar');
    if (r.ok) this.estado.set(r.data);
    return r;
  }

  /**
   * Entrar a otra empresa local. Si sale bien, el proceso principal recarga la
   * ventana: lo que siga a este `await` puede no llegar a ejecutarse.
   */
  async cambiar(base: string): Promise<ResultadoEmpresas<{ cambiada: boolean; base: string; nombre?: string }>> {
    this.cambiando.set(base);
    const r = await this.llamar<{ cambiada: boolean; base: string; nombre?: string }>('empresasCambiar', { base });
    if (!r.ok || !r.data.cambiada) this.cambiando.set(null);
    return r;
  }

  resumen(desde: string, hasta: string) {
    return this.llamar<{ desde: string; hasta: string; locales: ResumenEmpresa[]; remotas: ResumenEmpresa[] }>('empresasResumen', { desde, hasta });
  }

  crear(p: { nombre: string; giro: string; rfc?: string | null }) {
    return this.llamar<{ base: string; nombre: string; giro: string }>('empresasCrear', p);
  }
  desvincular(base: string) { return this.llamar<{ base: string }>('empresasDesvincular', { base }); }

  // -------------------------------------------- en otra computadora (nube)
  codigo() { return this.llamar<{ codigo: string; vence: string }>('empresasEnlaceCodigo'); }
  unir(codigo: string) { return this.llamar<{ yaEstaba: boolean }>('empresasEnlaceUnir', { codigo }); }
  salir() { return this.llamar<{ salio: boolean }>('empresasEnlaceSalir'); }
  catalogo(companyId: string) {
    return this.llamar<{ version: number | null; publicado: string | null; productos: ProductoRemoto[] }>('empresasRemotaCatalogo', { companyId });
  }
  /** `claveCliente` se crea al abrir el formulario: reintentar no duplica el pedido. */
  pedir(p: { companyId: string; tipo: TipoPedido; datos: any; claveCliente: string }) {
    return this.llamar<{ id: string; estado: string; repetido: boolean }>('empresasRemotaPedir', p);
  }
  pedidos() { return this.llamar<PedidoEnviado[]>('empresasRemotaPedidos'); }
  recibidos() { return this.llamar<CambioRecibido[]>('empresasRecibidos'); }
}
