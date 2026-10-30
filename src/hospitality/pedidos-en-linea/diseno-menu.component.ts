import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { CurrencyPipe, NgFor, NgIf } from '@angular/common';
import { FormsModule } from '@angular/forms';
import Swal from 'sweetalert2';
import {
  DisenoMenu, ImagenMenu, PedidosEnLineaService, ProductoMenu, TipoImagenMenu, URL_MENU,
} from '../../core/pedidos-en-linea.service';
import { WxOpcion, WxSelectComponent } from '../../app/wx-select/wx-select.component';

/** Las etiquetas que pinta la plantilla. Ni una más: el CHECK de 0070 las limita. */
const ETIQUETAS: { clave: string; texto: string }[] = [
  { clave: 'NUEVO', texto: 'Nuevo' }, { clave: 'RECOMENDADO', texto: 'Recomendado' },
  { clave: 'PICANTE', texto: 'Picante' }, { clave: 'VEGETARIANO', texto: 'Vegetariano' },
];

interface FilaProducto extends ProductoMenu { tags: Set<string>; vista: string | null; cambiado: boolean; }

/**
 * DISEÑO DEL MENÚ (0070).
 *
 * Una sola plantilla para todos; aquí el negocio solo pone su contenido:
 * portada, logo, hasta 5 promociones, una foto grande y una descripción por
 * producto, etiquetas, colores, dirección y horario. «Lo más pedido» no se
 * edita: sale de las ventas de los últimos 30 días.
 *
 * Cada foto se reduce en el proceso principal (nativeImage) y se publica sola
 * en la siguiente sincronización.
 */
@Component({
  selector: 'app-diseno-menu',
  standalone: true,
  imports: [NgIf, NgFor, CurrencyPipe, FormsModule, WxSelectComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './diseno-menu.component.html',
  styleUrls: ['./diseno-menu.component.css'],
})
export class DisenoMenuComponent implements OnInit {
  private readonly servicio = inject(PedidosEnLineaService);

  readonly etiquetas = ETIQUETAS;
  readonly cargando = signal(true);
  readonly datos = signal<DisenoMenu | null>(null);
  readonly vistas = signal<Record<number, string>>({});
  readonly filas = signal<FilaProducto[]>([]);
  readonly subiendo = signal<string | null>(null);
  readonly buscar = signal('');

  form = { color: '#1f7a8c', acento: '#ffd166', usarColores: false, frase: '', direccion: '', horario: '' };

  readonly portada = computed(() => this.datos()?.imagenes.find(i => i.tipo === 'PORTADA') ?? null);
  readonly logo = computed(() => this.datos()?.imagenes.find(i => i.tipo === 'LOGO') ?? null);
  readonly promos = computed(() => this.datos()?.imagenes.filter(i => i.tipo === 'PROMO') ?? []);
  readonly opcionesProducto = computed<WxOpcion[]>(() => [
    { valor: null, etiqueta: 'Sin producto' },
    ...(this.datos()?.productos ?? []).filter(p => !p.oculto).map(p => ({ valor: p.product_id, etiqueta: p.nombre })),
  ]);
  readonly masPedidos = computed(() => {
    const d = this.datos();
    return (d?.masVendidos ?? []).map(m => d!.productos.find(p => p.product_id === m.product_id)?.nombre).filter(Boolean) as string[];
  });
  readonly visibles = computed(() => {
    const q = this.buscar().trim().toLowerCase();
    return this.filas().filter(f => !q || f.nombre.toLowerCase().includes(q) || (f.categoria ?? '').toLowerCase().includes(q));
  });
  readonly url = computed(() => (this.datos()?.config.slug ? `${URL_MENU}${this.datos()!.config.slug}` : null));

  ngOnInit(): void { void this.leer(); }

  async leer(): Promise<void> {
    const r = await this.servicio.diseno();
    this.cargando.set(false);
    if (!r.ok) { await Swal.fire({ icon: 'error', title: 'No se pudo leer el diseño', text: r.error }); return; }
    this.datos.set(r.datos);
    const c = r.datos.config;
    this.form = { color: c.color || '#1f7a8c', acento: c.acento || '#ffd166', usarColores: !!(c.color || c.acento),
                  frase: c.frase ?? '', direccion: c.direccion ?? '', horario: c.horario ?? '' };
    this.filas.set(r.datos.productos.map(p => ({ ...p, descripcion: p.descripcion ?? '', tags: new Set((p.etiquetas ?? '').split(',').filter(Boolean)), vista: null, cambiado: false })));
    /* Las vistas previas se piden aparte: los bytes no viajan con el listado. */
    const vistas: Record<number, string> = {};
    for (const i of r.datos.imagenes) { const u = await this.servicio.verImagen(i.id); if (u) vistas[i.id] = u; }
    this.vistas.set(vistas);
  }

  async guardarDiseno(): Promise<void> {
    const r = await this.servicio.guardarDiseno({
      color: this.form.usarColores ? this.form.color : null, acento: this.form.usarColores ? this.form.acento : null,
      frase: this.form.frase, direccion: this.form.direccion, horario: this.form.horario,
    });
    if (!r.ok) { await Swal.fire({ icon: 'error', title: 'No se guardó', text: r.error }); return; }
    void Swal.fire({ icon: 'success', title: 'Diseño guardado', text: 'Se publica en la siguiente sincronización.', timer: 1800, showConfirmButton: false });
  }

  /** El archivo elegido -> data URL -> proceso principal (que lo reduce). */
  async subir(ev: Event, tipo: TipoImagenMenu, extra: { id?: number | null; productId?: number | null } = {}): Promise<void> {
    const input = ev.target as HTMLInputElement;
    const archivo = input.files?.[0];
    input.value = '';
    if (!archivo) return;
    if (!/^image\/(jpeg|png|webp)$/.test(archivo.type)) { await Swal.fire({ icon: 'info', title: 'Usa una foto JPG, PNG o WebP' }); return; }
    if (archivo.size > 15 * 1024 * 1024) { await Swal.fire({ icon: 'info', title: 'La foto pesa más de 15 MB' }); return; }
    const clave = `${tipo}-${extra.id ?? extra.productId ?? ''}`;
    this.subiendo.set(clave);
    try {
      const dataUrl = await new Promise<string>((ok, mal) => { const f = new FileReader(); f.onload = () => ok(String(f.result)); f.onerror = mal; f.readAsDataURL(archivo); });
      const promo = tipo === 'PROMO' && extra.id ? this.promos().find(p => p.id === extra.id) : null;
      const r = await this.servicio.guardarImagen({ tipo, id: extra.id ?? null, productId: extra.productId ?? promo?.product_id ?? null,
                                                    titulo: promo?.titulo ?? null, subtitulo: promo?.subtitulo ?? null, dataUrl });
      if (!r.ok) { await Swal.fire({ icon: 'error', title: 'No se guardó la foto', text: r.error }); return; }
      await this.leer();
    } finally { this.subiendo.set(null); }
  }

  async guardarPromo(p: ImagenMenu): Promise<void> {
    const r = await this.servicio.guardarImagen({ tipo: 'PROMO', id: p.id, productId: p.product_id, titulo: p.titulo, subtitulo: p.subtitulo, orden: p.orden });
    if (!r.ok) await Swal.fire({ icon: 'error', title: 'No se guardó la promoción', text: r.error });
  }

  async quitar(img: ImagenMenu | null): Promise<void> {
    if (!img) return;
    const r = await this.servicio.borrarImagen(img.id);
    if (!r.ok) { await Swal.fire({ icon: 'error', title: 'No se quitó', text: r.error }); return; }
    await this.leer();
  }

  alternar(f: FilaProducto, clave: string): void {
    if (f.tags.has(clave)) f.tags.delete(clave); else f.tags.add(clave);
    f.cambiado = true;
    this.filas.set([...this.filas()]);
  }

  marcar(f: FilaProducto): void { f.cambiado = true; this.filas.set([...this.filas()]); }

  async guardarProducto(f: FilaProducto): Promise<void> {
    const r = await this.servicio.guardarProducto({ productId: f.product_id, descripcion: f.descripcion ?? '', etiquetas: [...f.tags], destacado: !!f.destacado, oculto: !!f.oculto });
    if (!r.ok) { await Swal.fire({ icon: 'error', title: 'No se guardó', text: r.error }); return; }
    f.cambiado = false;
    this.filas.set([...this.filas()]);
  }

  fotoDe(f: FilaProducto): string | null { return f.foto_id ? this.vistas()[f.foto_id] ?? null : null; }
  vista(img: ImagenMenu | null): string | null { return img ? this.vistas()[img.id] ?? null : null; }
  porImagen = (_: number, x: ImagenMenu) => x.id;
  porProducto = (_: number, x: FilaProducto) => x.product_id;
}
