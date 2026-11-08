import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import Swal from 'sweetalert2';
import {
  CambioRecibido, ESTADOS_PEDIDO, EmpresaLocal, EmpresasService, PedidoEnviado, ResumenEmpresa, dinero, fechaLocal,
} from '../../core';
import { WxSelectComponent, WxOpcion } from '../wx-select/wx-select.component';

/*
 * MIS EMPRESAS (0080). docs/multiempresa.md.
 *
 *   Resumen     lo de cada empresa del grupo en un periodo, lado a lado, y el
 *               total. Las de esta computadora salen de su base; las de otra,
 *               de lo que su caja subió a la nube («Datos de las 14:32»).
 *   Pedidos     lo que esta empresa pidió a las demás y en qué quedó.
 *   Recibidos   lo que las demás cambiaron aquí (bitácora).
 *   Agregar     dar de alta una empresa en esta computadora o enlazar una de
 *               otra con un código. Solo quien administra el negocio.
 *
 * Los números y las reglas son del proceso principal y de SQL; aquí se pintan.
 */
type Pestana = 'resumen' | 'pedidos' | 'recibidos' | 'agregar';
type Periodo = 'hoy' | 'ayer' | 'semana' | 'mes';

const PERIODOS: { id: Periodo; etiqueta: string }[] = [
  { id: 'hoy', etiqueta: 'Hoy' }, { id: 'ayer', etiqueta: 'Ayer' },
  { id: 'semana', etiqueta: 'Últimos 7 días' }, { id: 'mes', etiqueta: 'Este mes' },
];

function rango(p: Periodo): { desde: string; hasta: string } {
  const hoy = new Date();
  const dia = (d: Date) => fechaLocal(d);
  if (p === 'ayer') { const a = new Date(hoy); a.setDate(a.getDate() - 1); return { desde: dia(a), hasta: dia(a) }; }
  if (p === 'semana') { const a = new Date(hoy); a.setDate(a.getDate() - 6); return { desde: dia(a), hasta: dia(hoy) }; }
  if (p === 'mes') return { desde: dia(new Date(hoy.getFullYear(), hoy.getMonth(), 1)), hasta: dia(hoy) };
  return { desde: dia(hoy), hasta: dia(hoy) };
}

@Component({
  selector: 'app-mis-empresas',
  standalone: true,
  imports: [CommonModule, FormsModule, WxSelectComponent],
  templateUrl: './mis-empresas.component.html',
  styleUrls: ['./empresas.css'],
})
export class MisEmpresasComponent implements OnInit {
  readonly svc = inject(EmpresasService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  readonly dinero = dinero;
  readonly periodos = PERIODOS;
  readonly estados = ESTADOS_PEDIDO;

  pestana = signal<Pestana>('resumen');
  periodo = signal<Periodo>('hoy');
  cargando = signal(false);
  error = signal('');

  locales = signal<ResumenEmpresa[]>([]);
  remotas = signal<ResumenEmpresa[]>([]);
  remotasError = signal('');
  pedidos = signal<PedidoEnviado[]>([]);
  recibidos = signal<CambioRecibido[]>([]);

  readonly todas = computed(() => [...this.locales(), ...this.remotas()]);
  readonly total = computed(() => {
    const t = { ventas: 0, tickets: 0, efectivo: 0, utilidad: 0, turnos: 0 };
    for (const e of this.todas()) {
      if (e.error) continue;
      t.ventas += e.ventas; t.tickets += e.tickets; t.efectivo += e.efectivoEnCaja; t.turnos += e.turnosAbiertos;
    }
    for (const e of this.locales()) if (!e.error) t.utilidad += e.utilidad ?? 0;
    return t;
  });
  get administra(): boolean { return !!this.svc.estado()?.administra; }

  // -------------------------------------------------------------- agregar
  nueva = { nombre: '', giro: 'RETAIL', rfc: '' };
  readonly giros: WxOpcion[] = [
    { valor: 'RETAIL', etiqueta: 'Tienda', nota: 'abarrotes, papelería, refacciones…' },
    { valor: 'HOSPITALITY', etiqueta: 'Restaurante o cafetería', nota: 'mesas, comandas, cocina' },
  ];
  creando = signal(false);
  codigo = signal<{ codigo: string; vence: string } | null>(null);
  codigoEscrito = '';
  enlazando = signal(false);
  avisoAgregar = signal('');

  async ngOnInit(): Promise<void> {
    if (this.route.snapshot.queryParamMap.get('agregar') === '1') this.pestana.set('agregar');
    await this.svc.cargar();
    await this.cargarPestana();
  }

  async cambiar(p: Pestana): Promise<void> {
    this.pestana.set(p);
    await this.cargarPestana();
  }

  async elegirPeriodo(p: Periodo): Promise<void> {
    this.periodo.set(p);
    await this.cargarResumen();
  }

  private async cargarPestana(): Promise<void> {
    if (this.pestana() === 'resumen') await this.cargarResumen();
    if (this.pestana() === 'pedidos') await this.cargarPedidos();
    if (this.pestana() === 'recibidos') await this.cargarRecibidos();
  }

  async cargarResumen(): Promise<void> {
    this.cargando.set(true);
    this.error.set('');
    const { desde, hasta } = rango(this.periodo());
    const r = await this.svc.resumen(desde, hasta);
    this.cargando.set(false);
    if (!r.ok) { this.error.set(r.error); return; }
    this.locales.set(r.data.locales);
    const errorNube = r.data.remotas.find(x => !x.nombre && x.error);
    this.remotasError.set(errorNube?.error ?? '');
    this.remotas.set(r.data.remotas.filter(x => !!x.nombre));
  }

  async cargarPedidos(): Promise<void> {
    this.cargando.set(true);
    const r = await this.svc.pedidos();
    this.cargando.set(false);
    if (r.ok) { this.pedidos.set(r.data); this.error.set(''); }
    else this.error.set(r.code === 'NO_CLOUD' ? '' : r.error);
  }

  async cargarRecibidos(): Promise<void> {
    this.cargando.set(true);
    const r = await this.svc.recibidos();
    this.cargando.set(false);
    if (r.ok) { this.recibidos.set(r.data); this.error.set(''); }
    else this.error.set(r.code === 'NO_CLOUD' ? '' : r.error);
  }

  // ------------------------------------------------------------- acciones
  esLocal(e: ResumenEmpresa): boolean { return !!e.base; }

  async entrar(e: ResumenEmpresa): Promise<void> {
    const local = this.svc.estado()?.locales.find((x: EmpresaLocal) => x.base === e.base);
    if (!local) return;
    const r = await this.svc.cambiar(local.base);
    if (!r.ok) this.error.set(r.error);
  }

  ver(e: ResumenEmpresa): void {
    if (e.companyId) void this.router.navigate(['/dashboard/empresas/remota', e.companyId]);
  }

  async crear(): Promise<void> {
    const nombre = this.nueva.nombre.trim();
    if (nombre.length < 2) { this.avisoAgregar.set('Escribe el nombre de la empresa.'); return; }
    const ok = await Swal.fire({
      title: `¿Dar de alta ${nombre}?`,
      html: 'Se crea su propia base en esta computadora: productos, ventas, cortes y facturación aparte. ' +
            'Entras con tu mismo usuario y contraseña. Tarda alrededor de un minuto.',
      icon: 'question', showCancelButton: true, confirmButtonText: 'Dar de alta', cancelButtonText: 'Cancelar',
    });
    if (!ok.isConfirmed) return;
    this.creando.set(true);
    this.avisoAgregar.set('');
    const r = await this.svc.crear({ nombre, giro: this.nueva.giro, rfc: this.nueva.rfc.trim() || null });
    this.creando.set(false);
    if (!r.ok) { this.avisoAgregar.set(r.error); return; }
    this.nueva = { nombre: '', giro: 'RETAIL', rfc: '' };
    await this.svc.cargar();
    const ir = await Swal.fire({
      title: `${r.data.nombre} está lista`, icon: 'success',
      html: 'Ya aparece en la pastilla del negocio, arriba a la izquierda. ¿Entrar ahora para darle sus productos y su caja?',
      showCancelButton: true, confirmButtonText: 'Entrar', cancelButtonText: 'Después',
    });
    if (ir.isConfirmed) {
      const c = await this.svc.cambiar(r.data.base);
      if (!c.ok) this.avisoAgregar.set(c.error);
    }
  }

  async generarCodigo(): Promise<void> {
    this.avisoAgregar.set('');
    const r = await this.svc.codigo();
    if (r.ok) this.codigo.set(r.data);
    else this.avisoAgregar.set(r.error);
  }

  venceA(iso: string): string {
    return new Date(iso).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });
  }

  async enlazar(): Promise<void> {
    this.enlazando.set(true);
    this.avisoAgregar.set('');
    const r = await this.svc.unir(this.codigoEscrito);
    this.enlazando.set(false);
    if (!r.ok) { this.avisoAgregar.set(r.error); return; }
    this.codigoEscrito = '';
    await this.svc.cargar();
    await Swal.fire({ title: r.data.yaEstaba ? 'Ya estaban enlazadas' : 'Empresas enlazadas', icon: 'success',
      text: 'La otra empresa ya aparece en Mis empresas y en la pastilla del negocio.' });
  }

  async desvincular(base: string, nombre: string): Promise<void> {
    const ok = await Swal.fire({
      title: `¿Sacar a ${nombre} del grupo?`,
      text: 'No se borra nada: sigue operando sola, con sus productos y ventas. Solo deja de aparecer aquí.',
      icon: 'warning', showCancelButton: true, confirmButtonText: 'Sacar del grupo', cancelButtonText: 'Cancelar',
    });
    if (!ok.isConfirmed) return;
    const r = await this.svc.desvincular(base);
    if (!r.ok) { this.avisoAgregar.set(r.error); return; }
    await this.svc.cargar();
    await this.cargarResumen();
  }

  async salirDeLaNube(): Promise<void> {
    const ok = await Swal.fire({
      title: '¿Sacar a esta empresa del grupo en la nube?',
      text: 'Las empresas de otras computadoras dejan de verla y lo que le hubieran pedido se cancela.',
      icon: 'warning', showCancelButton: true, confirmButtonText: 'Sacar', cancelButtonText: 'Cancelar',
    });
    if (!ok.isConfirmed) return;
    const r = await this.svc.salir();
    if (!r.ok) { this.avisoAgregar.set(r.error); return; }
    await this.svc.cargar();
  }

  // -------------------------------------------------------------- formato
  icono(e: ResumenEmpresa): string {
    if (!this.esLocal(e)) return 'ph ph-cloud';
    return e.giro === 'HOSPITALITY' ? 'ph-fill ph-fork-knife' : 'ph-fill ph-storefront';
  }
  turnos(n: number): string { return n === 1 ? '1 turno abierto' : `${n} turnos abiertos`; }
  datosDe(iso: string | null | undefined): string {
    if (!iso) return 'Sin datos de la nube todavía';
    const d = new Date(iso);
    return `Datos al ${d.toLocaleDateString('es-MX', { day: 'numeric', month: 'short' })}, ${d.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })}`;
  }
  cuando(iso: string | null | undefined): string {
    if (!iso) return '—';
    return new Date(iso).toLocaleString('es-MX', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  }
  queSePidio(p: { tipo: string; datos?: any; payload?: any }): string {
    const d = p.datos ?? p.payload ?? {};
    return p.tipo === 'PRODUCTO_PRECIO'
      ? `Precio de ${d.nombre || 'un producto'} a ${dinero(d.precio)}`
      : `Alta de ${d.nombre} a ${dinero(d.precio)}`;
  }
  trackResumen(_i: number, e: ResumenEmpresa) { return e.base ?? e.companyId; }
}
