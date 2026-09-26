import { Injectable } from '@angular/core';
import { CartCustomer } from './models';

type Resultado<T> = { ok: true; datos: T } | { ok: false; error: string };

/**
 * EL CLIENTE DE UNA VENTA: buscarlo, elegirlo y, si no existe, darlo de alta.
 *
 * Lo comparten Venta y Touch. Cada una lo pinta a su manera (Venta en su
 * modal, Touch en una hoja con botones grandes), pero el dominio es uno:
 * `customers` por los mismos canales de siempre (`sp-get-customers`,
 * `sp-create-customer`), y la eleccion vive en el carrito
 * (`cart.customer`), que es lo que termina en `sales.customer_id`.
 *
 * El alta de aqui es la MINIMA: nombre y, si se quiere, telefono. Credito,
 * datos fiscales y lo demas siguen en Clientes: una caja con fila no es el
 * sitio para capturar un RFC.
 */
@Injectable({ providedIn: 'root' })
export class ClientesVentaService {
  private get api(): any { return (window as any).electronAPI; }

  get disponible(): boolean { return !!this.api?.getCustomers; }

  /** Los clientes activos, como los lleva el carrito. */
  async listar(): Promise<Resultado<CartCustomer[]>> {
    if (!this.api?.getCustomers) return { ok: false, error: 'La búsqueda de clientes no está disponible.' };
    try {
      const r = await this.api.getCustomers();
      if (!r?.success) return { ok: false, error: r?.error || 'No se pudieron cargar los clientes.' };
      const datos = (r.data || [])
        .filter((f: any) => f.active !== false && f.active !== 0)
        .map((f: any) => ClientesVentaService.deFila(f));
      return { ok: true, datos };
    } catch {
      return { ok: false, error: 'No se pudieron cargar los clientes.' };
    }
  }

  /** La misma busqueda que tenia Venta: nombre, RFC, telefono o correo. */
  static coincide(c: CartCustomer, q: string): boolean {
    const t = String(q || '').trim().toLowerCase();
    if (!t) return true;
    return [c.name, c.tax_id, c.phone, c.email].some(v => String(v || '').toLowerCase().includes(t));
  }

  filtrar(lista: CartCustomer[], q: string): CartCustomer[] {
    return lista.filter(c => ClientesVentaService.coincide(c, q));
  }

  /**
   * Alta minima desde la caja. Usa el mismo procedimiento que Clientes
   * (`sp_create_customer`) con credito en cero: nada de lo que no se captura
   * aqui se inventa.
   */
  async crearRapido(nombre: string, telefono?: string | null): Promise<Resultado<CartCustomer>> {
    const n = String(nombre || '').replace(/\s+/g, ' ').trim();
    const tel = String(telefono || '').trim();
    if (n.length < 2) return { ok: false, error: 'Escribe el nombre del cliente.' };
    if (n.length > 120) return { ok: false, error: 'El nombre es demasiado largo.' };
    if (tel && !/^[0-9 +()-]{7,20}$/.test(tel)) return { ok: false, error: 'El teléfono no parece válido.' };
    if (!this.api?.createCustomer) return { ok: false, error: 'El alta de clientes no está disponible.' };
    try {
      const r = await this.api.createCustomer(null, n, null, '', tel, 0, 0, true, null, null, null, 0, 0, 0, 0);
      if (!r?.success || !r.id) return { ok: false, error: r?.error || 'No se pudo crear el cliente.' };
      return { ok: true, datos: { id: Number(r.id), name: n, phone: tel || null } };
    } catch {
      return { ok: false, error: 'No se pudo crear el cliente.' };
    }
  }

  /** Una fila de `sp_get_customers` como la lleva el carrito. */
  static deFila(row: any): CartCustomer {
    return {
      id: Number(row.id),
      name: row.customerName,
      tax_id: row.tax_id,
      razon_social: row.razon_social,
      regimen_fiscal: row.regimen_fiscal,
      uso_cfdi: row.uso_cfdi,
      phone: row.phone,
      email: row.email,
    };
  }
}
