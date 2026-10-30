import { Injectable, inject, signal } from '@angular/core';
import { ElectronBridge } from './electron-bridge.service';

/** Un pedido del menú en línea, como lo pinta la bandeja (ipc/menu-en-linea.js). */
export interface PedidoEnLinea {
  id: number;
  uuid: string;
  origen: 'MOSTRADOR' | 'MESA' | 'REDES' | null;
  nombre: string;
  telefono: string;
  nota: string | null;
  total: number;
  /** Minutos desde que llegó (calculados en SQL). */
  minutos: number;
  estado: 'PENDIENTE' | 'ACEPTADO' | 'RECHAZADO';
  /** Lo que ve el cliente: RECIBIDO, ACEPTADO, PREPARANDO, LISTO, ENTREGADO, RECHAZADO, CANCELADO. */
  estadoCliente: string;
  motivo: string | null;
  cuentaId: number | null;
  numero: number | null;
  lineas: { nombre: string; cantidad: number; precio: number; nota: string | null;
            opciones: { nombre: string; delta: number; cantidad: number }[] }[];
}

export interface ConfigMenuEnLinea {
  activo: boolean;
  recibePedidos: boolean;
  slug: string | null;
  minutos: number;
  mensaje: string | null;
  pendientes: number;
  nube: boolean;
  sincronizacion: { publicado: string | null; bajado: string | null; error: string | null } | null;
}

export type Resultado<T> = { ok: true; datos: T } | { ok: false; error: string };

/** Donde vive la página del menú (wybix-landing). */
export const URL_MENU = 'https://www.wybixpos.com.mx/m/';

/**
 * PEDIDOS EN LÍNEA (0067).
 *
 * La bandeja de la caja: lo que llegó del menú del celular y lo que la caja
 * decide. Aceptar no cobra: abre la cuenta (número del día) y la manda a
 * cocina; se cobra al recoger, con la cuenta abierta, como cualquier otra.
 *
 * `pendientes` lo leen la navegación y el aviso: un pedido que nadie ve es un
 * cliente esperando en la puerta.
 */
@Injectable({ providedIn: 'root' })
export class PedidosEnLineaService {
  private readonly bridge = inject(ElectronBridge);
  private get api(): any { return this.bridge.api; }

  readonly pendientes = signal(0);
  /** El último aviso de pedidos nuevos (nombre de quien pidió), para el toast. */
  readonly nuevos = signal<{ nombre: string; n: number; en: number } | null>(null);
  private escuchando = false;

  /** Una sola vez por ventana: el proceso principal avisa de pedidos nuevos. */
  escuchar(): void {
    if (this.escuchando || !this.api?.onMenuLineaNuevos) return;
    this.escuchando = true;
    this.api.onMenuLineaNuevos((lista: { id: number; nombre: string }[]) => {
      if (!Array.isArray(lista) || !lista.length) return;
      this.pendientes.update(n => n + lista.length);
      this.nuevos.set({ nombre: lista[0].nombre, n: lista.length, en: Date.now() });
    });
  }

  async config(): Promise<Resultado<ConfigMenuEnLinea>> {
    try {
      const r = await this.api?.menuLineaConfig?.();
      if (!r?.success) return { ok: false, error: r?.error || 'No se pudo leer el menú en línea.' };
      this.pendientes.set(Number(r.data?.pendientes) || 0);
      return { ok: true, datos: r.data };
    } catch (e: any) { return { ok: false, error: e?.message || 'No se pudo leer el menú en línea.' }; }
  }

  async guardar(p: Partial<{ activo: boolean; recibePedidos: boolean; slug: string; minutos: number; mensaje: string; marca: unknown }>): Promise<Resultado<{ publicado: any }>> {
    const r = await this.api?.menuLineaGuardar?.(p);
    return r?.success ? { ok: true, datos: r.data } : { ok: false, error: r?.error || 'No se pudo guardar.' };
  }

  async pedidos(): Promise<Resultado<PedidoEnLinea[]>> {
    try {
      const r = await this.api?.menuLineaPedidos?.();
      if (!r?.success) return { ok: false, error: r?.error || 'No se pudieron leer los pedidos.' };
      const lista: PedidoEnLinea[] = r.data || [];
      this.pendientes.set(lista.filter(p => p.estado === 'PENDIENTE').length);
      return { ok: true, datos: lista };
    } catch (e: any) { return { ok: false, error: e?.message || 'No se pudieron leer los pedidos.' }; }
  }

  async aceptar(id: number): Promise<Resultado<{ cuentaId: number; numero: number }>> {
    const r = await this.api?.menuLineaAceptar?.({ id });
    return r?.success ? { ok: true, datos: r.data } : { ok: false, error: r?.error || 'No se pudo aceptar.' };
  }

  async rechazar(id: number, motivo: string): Promise<Resultado<null>> {
    const r = await this.api?.menuLineaRechazar?.({ id, motivo });
    return r?.success ? { ok: true, datos: null } : { ok: false, error: r?.error || 'No se pudo rechazar.' };
  }

  async sincronizar(): Promise<Resultado<any>> {
    const r = await this.api?.menuLineaSincronizar?.();
    return r?.success ? { ok: true, datos: r.data } : { ok: false, error: r?.error || 'Sin conexión con la nube.' };
  }

  // ---------------------------------------------- 0070 · diseño del menú
  async diseno(): Promise<Resultado<DisenoMenu>> {
    const r = await this.api?.menuLineaDiseno?.();
    return r?.success ? { ok: true, datos: r.data } : { ok: false, error: r?.error || 'No se pudo leer el diseño.' };
  }

  async guardarDiseno(p: { color: string | null; acento: string | null; frase: string; direccion: string; horario: string }): Promise<Resultado<null>> {
    const r = await this.api?.menuLineaDisenoGuardar?.(p);
    return r?.success ? { ok: true, datos: null } : { ok: false, error: r?.error || 'No se pudo guardar el diseño.' };
  }

  async guardarImagen(p: { tipo: TipoImagenMenu; id?: number | null; productId?: number | null; titulo?: string | null;
                           subtitulo?: string | null; orden?: number; dataUrl?: string | null }): Promise<Resultado<ImagenMenu>> {
    const r = await this.api?.menuLineaImagenGuardar?.(p);
    return r?.success ? { ok: true, datos: r.data } : { ok: false, error: r?.error || 'No se pudo guardar la imagen.' };
  }

  async borrarImagen(id: number): Promise<Resultado<null>> {
    const r = await this.api?.menuLineaImagenBorrar?.({ id });
    return r?.success ? { ok: true, datos: null } : { ok: false, error: r?.error || 'No se pudo quitar la imagen.' };
  }

  async verImagen(id: number): Promise<string | null> {
    const r = await this.api?.menuLineaImagenVer?.({ id });
    return r?.success ? r.data : null;
  }

  async guardarProducto(p: { productId: number; descripcion: string; etiquetas: string[]; destacado: boolean; oculto: boolean }): Promise<Resultado<null>> {
    const r = await this.api?.menuLineaProductoGuardar?.(p);
    return r?.success ? { ok: true, datos: null } : { ok: false, error: r?.error || 'No se pudo guardar el producto.' };
  }
}

export type TipoImagenMenu = 'PORTADA' | 'LOGO' | 'PROMO' | 'PRODUCTO';
export interface ImagenMenu {
  id: number; tipo: TipoImagenMenu; product_id: number | null; titulo: string | null; subtitulo: string | null;
  orden: number; version: number; ancho: number; alto: number;
}
export interface ProductoMenu {
  product_id: number; nombre: string; price: number; categoria: string | null; image_version: number | null;
  descripcion: string | null; etiquetas: string | null; destacado: boolean; oculto: boolean; foto_id: number | null; foto_version: number | null;
}
export interface DisenoMenu {
  config: { color: string | null; acento: string | null; frase: string | null; direccion: string | null; horario: string | null; slug: string | null };
  imagenes: ImagenMenu[];
  productos: ProductoMenu[];
  masVendidos: { product_id: number; piezas: number }[];
}
