import { Component, ElementRef, OnInit, ViewChild, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import {
  ESTADOS_PEDIDO, EmpresaRemota, EmpresasService, PedidoEnviado, ProductoRemoto, ResumenEmpresa, TipoPedido, dinero, fechaLocal,
} from '../../core';
import { AuthService, PAQUETES } from '../../services/auth.service';

/*
 * UNA EMPRESA EN OTRA COMPUTADORA (0080, Fases 2 y 3). docs/multiempresa.md.
 *
 * Lo que su caja subió a la nube: el resumen de hoy y el catálogo publicado.
 * Desde aquí se le PIDE un alta de producto o un cambio de precio; el pedido
 * espera en la nube y lo aplica su caja principal con sus propias reglas. Por
 * eso un pedido nunca se muestra como hecho hasta que esa caja responde.
 */
type Formulario = { tipo: TipoPedido; producto: ProductoRemoto | null; nombre: string; precio: number | null;
                    codigo: string; categoria: string; clave: string };

@Component({
  selector: 'app-empresa-remota',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './empresa-remota.component.html',
  styleUrls: ['./empresas.css'],
})
export class EmpresaRemotaComponent implements OnInit {
  private readonly svc = inject(EmpresasService);
  private readonly auth = inject(AuthService);
  private readonly route = inject(ActivatedRoute);
  readonly router = inject(Router);
  readonly dinero = dinero;
  readonly estados = ESTADOS_PEDIDO;

  @ViewChild('dialogo') dialogo?: ElementRef<HTMLDialogElement>;

  companyId = '';
  empresa = signal<EmpresaRemota | null>(null);
  resumen = signal<ResumenEmpresa | null>(null);
  productos = signal<ProductoRemoto[]>([]);
  publicado = signal<string | null>(null);
  pedidos = signal<PedidoEnviado[]>([]);
  cargando = signal(true);
  error = signal('');
  filtro = signal('');
  enviando = signal(false);
  avisoForm = signal('');

  form: Formulario = this.formVacio('PRODUCTO_ALTA');

  readonly visibles = computed(() => {
    const f = this.filtro().trim().toLowerCase();
    return f ? this.productos().filter(p => p.nombre.toLowerCase().includes(f)) : this.productos();
  });
  get puedePedir(): boolean { return this.auth.puede(PAQUETES.CONFIGURACION_ADMINISTRAR); }

  async ngOnInit(): Promise<void> {
    this.companyId = this.route.snapshot.paramMap.get('id') ?? '';
    if (!this.svc.estado()) await this.svc.cargar();
    const e = this.svc.estado()?.remotas.find(x => x.companyId === this.companyId) ?? null;
    if (!e) { void this.router.navigate(['/dashboard/empresas']); return; }
    this.empresa.set(e);
    await this.cargar();
  }

  async cargar(): Promise<void> {
    this.cargando.set(true);
    this.error.set('');
    const hoy = fechaLocal();
    const [res, cat, ped] = await Promise.all([this.svc.resumen(hoy, hoy), this.svc.catalogo(this.companyId), this.svc.pedidos()]);
    this.cargando.set(false);
    if (res.ok) this.resumen.set(res.data.remotas.find(x => x.companyId === this.companyId) ?? null);
    if (cat.ok) { this.productos.set(cat.data.productos); this.publicado.set(cat.data.publicado); }
    else this.error.set(cat.error);
    if (ped.ok) this.pedidos.set(ped.data.filter(p => p.companyId === this.companyId));
  }

  private formVacio(tipo: TipoPedido, producto: ProductoRemoto | null = null): Formulario {
    return { tipo, producto, nombre: producto?.nombre ?? '', precio: producto?.precio ?? null, codigo: '', categoria: '',
             clave: crypto.randomUUID() };
  }

  /** La clave del pedido nace al abrir el formulario: reintentar el envío no lo duplica. */
  abrir(tipo: TipoPedido, producto: ProductoRemoto | null = null): void {
    this.form = this.formVacio(tipo, producto);
    this.avisoForm.set('');
    this.dialogo?.nativeElement.showModal();
  }

  cerrar(): void { this.dialogo?.nativeElement.close(); }

  async enviar(): Promise<void> {
    const f = this.form;
    if (f.precio == null || !(Number(f.precio) >= 0)) { this.avisoForm.set('Escribe un precio válido.'); return; }
    if (f.tipo === 'PRODUCTO_ALTA' && f.nombre.trim().length < 2) { this.avisoForm.set('Escribe el nombre del producto.'); return; }
    this.enviando.set(true);
    const datos = f.tipo === 'PRODUCTO_PRECIO'
      ? { productUuid: f.producto?.uuid, nombre: f.producto?.nombre, precio: Number(f.precio) }
      : { nombre: f.nombre.trim(), precio: Number(f.precio), codigo: f.codigo.trim() || null, categoria: f.categoria.trim() || null };
    const r = await this.svc.pedir({ companyId: this.companyId, tipo: f.tipo, datos, claveCliente: f.clave });
    this.enviando.set(false);
    if (!r.ok) { this.avisoForm.set(r.error); return; }
    this.cerrar();
    const p = await this.svc.pedidos();
    if (p.ok) this.pedidos.set(p.data.filter(x => x.companyId === this.companyId));
  }

  datosDe(iso: string | null | undefined): string {
    if (!iso) return 'Sin datos de la nube todavía';
    const d = new Date(iso);
    return `Datos al ${d.toLocaleDateString('es-MX', { day: 'numeric', month: 'short' })}, ${d.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })}`;
  }
  cuando(iso: string | null | undefined): string {
    return iso ? new Date(iso).toLocaleString('es-MX', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—';
  }
  queSePidio(p: PedidoEnviado): string {
    return p.tipo === 'PRODUCTO_PRECIO'
      ? `Precio de ${p.datos?.nombre || 'un producto'} a ${dinero(p.datos?.precio)}`
      : `Alta de ${p.datos?.nombre} a ${dinero(p.datos?.precio)}`;
  }
  trackProducto(_i: number, p: ProductoRemoto) { return p.uuid; }
}
