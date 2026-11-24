import { ChangeDetectionStrategy, Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { WxSelectComponent, WxOpcion } from '../../app/wx-select/wx-select.component';
import { WxDateComponent } from '../../app/wx-date/wx-date.component';
import { AuthService, PAQUETES } from '../../services/auth.service';
import { ProductoFarmacia, ROMANOS, ResumenFarmacia, SaludService, hoyIso } from '../salud.service';

interface FichaForm {
  productId: number; nombre: string; fraccion: number | null; esAntibiotico: boolean; sustanciaActiva: string;
  presentacion: string; registroSanitario: string; refrigeracion: boolean; precioMaximo: number | null; controlaLotes: boolean;
}
interface LoteForm { productId: number; nombre: string; lote: string; caducidad: string; cantidad: number | null; costo: number | null; disponible: number; }

/**
 * FARMACIA: el catálogo visto por su ficha sanitaria.
 *
 * Qué pide receta, qué lleva lote, cuánto de la existencia ya tiene lote y
 * cuál es la caducidad más próxima. Desde aquí se da la ficha y se asigna
 * lote a lo que entró. Lo que se VENDE sigue en la caja de siempre: esta
 * pantalla no vende.
 *
 * La búsqueda va al proceso principal con un respiro de 250 ms y TOP 200:
 * una farmacia tiene miles de claves y la pantalla nunca necesita todas.
 */
@Component({
  selector: 'app-salud-farmacia',
  standalone: true,
  imports: [CommonModule, FormsModule, WxSelectComponent, WxDateComponent],
  styleUrls: ['../../modulo-servicios/servicios.css', '../salud.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './farmacia.component.html',
})
export class SaludFarmacia implements OnInit, OnDestroy {
  private readonly salud = inject(SaludService);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  readonly romanos = ROMANOS;
  readonly hoy = hoyIso();
  readonly resumen = signal<ResumenFarmacia | null>(null);
  readonly productos = signal<ProductoFarmacia[]>([]);
  readonly cargando = signal(true);
  readonly error = signal<string | null>(null);
  buscar = '';
  soloMedicamentos = false;

  readonly ficha = signal<FichaForm | null>(null);
  readonly lote = signal<LoteForm | null>(null);
  readonly guardando = signal(false);
  readonly errorDialogo = signal<string | null>(null);

  readonly opcFraccion: WxOpcion[] = [
    { valor: null, etiqueta: 'No es medicamento', nota: 'Higiene, curación, suplementos' },
    { valor: 1, etiqueta: 'Fracción I', nota: 'Estupefacientes · receta especial' },
    { valor: 2, etiqueta: 'Fracción II', nota: 'Psicotrópicos · se retiene la receta' },
    { valor: 3, etiqueta: 'Fracción III', nota: 'Psicotrópicos · hasta 3 surtidos' },
    { valor: 4, etiqueta: 'Fracción IV', nota: 'Con receta, se puede resurtir' },
    { valor: 5, etiqueta: 'Fracción V', nota: 'Sin receta, solo en farmacia' },
    { valor: 6, etiqueta: 'Fracción VI', nota: 'Venta libre' },
  ];

  get responsable(): boolean { return this.auth.puede(PAQUETES.SALUD_FARMACIA); }

  readonly conReceta = computed(() => this.productos().filter((p) => p.requiere_receta).length);

  private temporizador: ReturnType<typeof setTimeout> | null = null;
  private pedido = 0;

  async ngOnInit(): Promise<void> {
    await Promise.all([this.cargarResumen(), this.cargar()]);
  }

  ngOnDestroy(): void { if (this.temporizador) clearTimeout(this.temporizador); }

  async cargarResumen(): Promise<void> {
    const r = await this.salud.resumenFarmacia();
    if (r.ok) this.resumen.set(r.datos);
  }

  alEscribir(): void {
    if (this.temporizador) clearTimeout(this.temporizador);
    this.temporizador = setTimeout(() => void this.cargar(), 250);
  }

  async cargar(): Promise<void> {
    /* Solo cuenta la respuesta del último pedido: si escribes rápido, una
       búsqueda vieja que llega tarde no pisa a la nueva. */
    const yo = ++this.pedido;
    this.cargando.set(true);
    const r = await this.salud.productos({ buscar: this.buscar, soloMedicamentos: this.soloMedicamentos });
    if (yo !== this.pedido) return;
    this.cargando.set(false);
    if (!r.ok) { this.error.set(r.error || 'No se pudo cargar la farmacia.'); return; }
    this.error.set(null);
    this.productos.set(r.datos);
  }

  irACaducidades(): void { void this.router.navigate(['/dashboard/salud/caducidades']); }
  irATemperaturas(): void { void this.router.navigate(['/dashboard/salud/temperaturas']); }

  etiquetaFraccion(p: ProductoFarmacia): string {
    if (p.es_antibiotico) return 'Antibiótico';
    return p.fraccion ? `Fr. ${ROMANOS[p.fraccion]}` : '';
  }

  // ------------------------------------------------------------- ficha
  abrirFicha(p: ProductoFarmacia): void {
    if (!this.responsable) return;
    this.errorDialogo.set(null);
    this.ficha.set({
      productId: p.product_id, nombre: p.nombre, fraccion: p.fraccion, esAntibiotico: !!p.es_antibiotico,
      sustanciaActiva: p.sustancia_activa ?? '', presentacion: p.presentacion ?? '',
      registroSanitario: p.registro_sanitario ?? '', refrigeracion: !!p.refrigeracion,
      precioMaximo: p.precio_maximo, controlaLotes: p.tiene_ficha ? !!p.controla_lotes : true,
    });
  }

  async guardarFicha(): Promise<void> {
    const f = this.ficha();
    if (!f || this.guardando()) return;
    this.guardando.set(true);
    const r = await this.salud.guardarFicha({ ...f, precioMaximo: f.precioMaximo || null });
    this.guardando.set(false);
    if (!r.ok) { this.errorDialogo.set(r.error || 'No se pudo guardar.'); return; }
    this.ficha.set(null);
    await Promise.all([this.cargar(), this.cargarResumen()]);
  }

  // -------------------------------------------------------------- lote
  abrirLote(p: ProductoFarmacia, ev?: Event): void {
    ev?.stopPropagation();
    if (!this.responsable) return;
    this.errorDialogo.set(null);
    this.lote.set({ productId: p.product_id, nombre: p.nombre, lote: '', caducidad: '', cantidad: p.sin_lote || null, costo: null, disponible: p.sin_lote });
  }

  async guardarLote(): Promise<void> {
    const l = this.lote();
    if (!l || this.guardando()) return;
    if (!l.lote.trim() || !l.caducidad || !l.cantidad || l.cantidad <= 0) {
      this.errorDialogo.set('Lote, caducidad y cantidad son obligatorios.');
      return;
    }
    this.guardando.set(true);
    const r = await this.salud.entradaLote({ productId: l.productId, lote: l.lote, caducidad: l.caducidad, cantidad: l.cantidad, costo: l.costo });
    this.guardando.set(false);
    if (!r.ok) { this.errorDialogo.set(r.error || 'No se pudo guardar el lote.'); return; }
    this.lote.set(null);
    await Promise.all([this.cargar(), this.cargarResumen()]);
  }

  /** Inmutables a propósito: con OnPush, cambiar un campo dentro del objeto no repinta. */
  editarFicha<K extends keyof FichaForm>(k: K, v: FichaForm[K]): void { const f = this.ficha(); if (f) this.ficha.set({ ...f, [k]: v }); }
  editarLote<K extends keyof LoteForm>(k: K, v: LoteForm[K]): void { const l = this.lote(); if (l) this.lote.set({ ...l, [k]: v }); }

  trackProducto = (_: number, p: ProductoFarmacia) => p.product_id;
}
