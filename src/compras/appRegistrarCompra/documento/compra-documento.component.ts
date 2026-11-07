import { Component, EventEmitter, HostListener, Input, OnInit, Output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { NgIf, NgFor, NgClass, CurrencyPipe, DecimalPipe, SlicePipe } from '@angular/common';
import Swal from 'sweetalert2';
import { HospitalityService } from '../../../core';
import { WxOpcion, WxSelectComponent } from '../../../app/wx-select/wx-select.component';
import { WxCargandoComponent } from '../../../app/wx-cargando/wx-cargando.component';
import { ProveedorFormComponent } from '../../../app/proveedores/proveedor-form.component';

/**
 * SUBIR UN TICKET O UNA FACTURA Y CONVERTIRLO EN COMPRA
 * =====================================================
 *
 * La persona sube una foto del ticket o nota del proveedor, o el XML de la
 * factura. El proceso principal la lee (OCR local o lectura exacta del XML,
 * ver electron/ipc/compras-documentos.js) y devuelve renglones con cantidad,
 * presentación, precio, importe, IVA e IEPS, más una sugerencia de producto
 * para cada uno.
 *
 * Esta pantalla NO registra nada: enseña lo que se leyó, deja corregirlo y
 * pasa los renglones confirmados a la compra. Registrar sigue siendo el botón
 * de siempre, con sus validaciones y su permiso.
 *
 * El costo que llega a la compra es el que REALMENTE se pagó por unidad:
 *   (importe − descuento del renglón − su parte del descuento global + IEPS)
 *   ÷ cantidad, sin IVA.
 * El IEPS va al costo: la tienda no lo acredita. El IVA no: va aparte.
 * Los envases (depósito de refresco/cerveza) no son mercancía y se dejan fuera.
 */

export interface ProductoCompra {
  id: number;
  product_name: string;
  part_number?: string;
  bar_code?: string;
  base_uom: string;
  objeto_impuesto: string;
  tasa_iva: number;
}

interface Presentacion { id: number | null; nombre: string; factor: number; }

/** Un renglón del documento, ya con lo que la persona decidió. */
interface Renglon {
  texto: string;
  codigo: string | null;
  unidad: string;
  cantidadDoc: number;
  /** Unidades base que trae UNA unidad del documento (caja ×12 = 12). */
  factorDoc: number;
  importe: number;
  descuento: number;
  ieps: number;
  tasaDoc: number | null;
  granel: boolean;
  /** Llegó sin cargo (combo, promoción): 0 de importe. */
  regalo: boolean;

  incluir: boolean;
  productId: number | null;
  por: string | null;
  certeza: number;
  candidatos: { product_id: number; nombre: string; certeza: number }[];

  presentaciones: Presentacion[];
  presOpciones: WxOpcion[];
  /** id de la presentación, null = unidad base, 'nueva' = crearla al pasar. */
  presSel: number | null | 'nueva';
  nombreNueva: string;

  cantidad: number;
  costo: number;
}

export interface DocumentoAplicado {
  document_id: number;
  supplier_id: number;
  /** CFDI, TICKET o NOTA: un ticket o nota casi siempre se pagó al recibir. */
  tipo: string;
  lineas: {
    productId: number;
    cantidad: number;
    costo: number;
    presentationId: number | null;
    texto: string;
    codigo: string | null;
    factor: number;
  }[];
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const r4 = (n: number) => Math.round(n * 10000) / 10000;

@Component({
  selector: 'app-compra-documento',
  standalone: true,
  templateUrl: './compra-documento.component.html',
  styleUrls: ['./compra-documento.component.css'],
  imports: [FormsModule, NgIf, NgFor, NgClass, CurrencyPipe, DecimalPipe, SlicePipe, WxSelectComponent, WxCargandoComponent, ProveedorFormComponent],
})
export class CompraDocumentoComponent implements OnInit {
  @Input() productos: ProductoCompra[] = [];
  @Input() proveedores: { id: number; nombre: string }[] = [];
  /** El padre recarga su lista de proveedores y la vuelve a pasar. */
  @Output() proveedorCreado = new EventEmitter<{ id: number | null; nombre: string }>();
  @Output() aplicar = new EventEmitter<DocumentoAplicado>();
  @Output() cerrado = new EventEmitter<void>();

  paso: 'elegir' | 'leyendo' | 'revisar' = 'elegir';
  arrastrando = false;
  error = '';

  nombreArchivo = '';
  vistaPrevia = '';
  documentId = 0;
  tipo = '';
  doc: any = null;
  proveedorDetectado: { id: number; nombre: string; por: string; parecido?: number } | null = null;
  proveedorId: number | null = null;
  altaProveedor: { nombre: string; rfc: string } | null = null;

  renglones: Renglon[] = [];
  /** Ticket de mostrador: los precios ya traen el IVA adentro. */
  preciosConIva = false;
  pasando = false;

  opcionesProducto: WxOpcion[] = [];
  private presCache = new Map<number, Presentacion[]>();

  constructor(private hosp: HospitalityService) {}

  ngOnInit() {
    this.opcionesProducto = this.productos.map(p => ({
      valor: p.id,
      etiqueta: p.product_name,
      nota: p.part_number || undefined,
      busca: [p.part_number, p.bar_code].filter(Boolean).join(' '),
    }));
  }

  get opcionesProveedor(): WxOpcion[] {
    return this.proveedores.map(p => ({ valor: p.id, etiqueta: p.nombre }));
  }

  @HostListener('document:keydown.escape')
  alEscape() {
    if (!this.altaProveedor && this.paso !== 'leyendo') this.cerrar();
  }

  cerrar() { this.cerrado.emit(); }

  /* ------------------------------------------------------------ archivo */

  alSoltar(e: DragEvent) {
    e.preventDefault();
    this.arrastrando = false;
    const f = e.dataTransfer?.files?.[0];
    if (f) this.leer(f);
  }

  alElegir(e: Event) {
    const input = e.target as HTMLInputElement;
    const f = input.files?.[0];
    input.value = '';
    if (f) this.leer(f);
  }

  private aBase64(f: File): Promise<string> {
    return new Promise((ok, mal) => {
      const r = new FileReader();
      r.onload = () => ok(String(r.result || ''));
      r.onerror = () => mal(r.error);
      r.readAsDataURL(f);
    });
  }

  private aPng(dataUrl: string): Promise<string> {
    return new Promise((ok, mal) => {
      const img = new Image();
      img.onload = () => {
        const c = document.createElement('canvas');
        c.width = img.naturalWidth; c.height = img.naturalHeight;
        c.getContext('2d')!.drawImage(img, 0, 0);
        ok(c.toDataURL('image/png'));
      };
      img.onerror = () => mal(new Error('No se pudo abrir la imagen. Prueba con JPG o PNG.'));
      img.src = dataUrl;
    });
  }

  async leer(f: File) {
    this.error = '';
    this.paso = 'leyendo';
    this.nombreArchivo = f.name;
    try {
      let dataUrl = await this.aBase64(f);
      let nombre = f.name, mime = f.type;
      /* El proceso principal (nativeImage) solo abre PNG y JPG. Una foto
         WEBP, GIF o BMP (las de WhatsApp suelen venir en WEBP) la convierte
         aquí el navegador, que sí las abre. */
      if (/^data:image\/(webp|gif|bmp)/i.test(dataUrl)) {
        dataUrl = await this.aPng(dataUrl);
        nombre = nombre.replace(/\.(webp|gif|bmp)$/i, '') + '.png';
        mime = 'image/png';
      }
      this.vistaPrevia = /^data:image\//.test(dataUrl) ? dataUrl : '';
      const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
      const res = await (window as any).electronAPI.comprasDocLeer({ nombre, mime, base64 });
      if (!res?.success) throw new Error(res?.error || 'No se pudo leer el documento.');
      await this.cargar(res.data);
      this.paso = 'revisar';
    } catch (e: any) {
      this.error = e?.message || 'No se pudo leer el documento.';
      this.paso = 'elegir';
    }
  }

  /* ----------------------------------------------------------- revisión */

  private async cargar(d: any) {
    this.documentId = d.document_id;
    this.tipo = d.tipo;
    this.doc = d.doc;
    this.proveedorDetectado = d.proveedor || null;
    this.proveedorId = d.proveedor?.id ?? null;

    /* Sin renglón de IVA y con la suma de renglones igual al total: los
       precios del ticket ya lo traen (ticket de mostrador). */
    const t = d.doc.totales || {};
    const suma = (d.doc.lineas || []).reduce((a: number, l: any) => a + (Number(l.importe) || 0), 0);
    this.preciosConIva = d.tipo !== 'CFDI' && !t.iva && t.total != null && Math.abs(suma - (t.total - (t.envases || 0) + (t.descuento || 0))) <= 0.1;

    const sug = d.sugerencias || [];
    this.renglones = (d.doc.lineas || []).map((l: any, i: number) => {
      const s = sug[i] || {};
      const factorDoc = Number(l.factor) > 0 ? Number(l.factor) : 1;
      const r: Renglon = {
        texto: l.descripcion || '',
        codigo: l.codigo || null,
        unidad: l.unidad || 'pza',
        cantidadDoc: Number(l.cantidad) || 0,
        factorDoc,
        importe: Number(l.importe) || 0,
        descuento: Number(l.descuento) || 0,
        ieps: Number(l.ieps) || 0,
        tasaDoc: l.tasa_iva == null ? null : Number(l.tasa_iva),
        granel: !!l.granel,
        /* Sin marcar: lo que llegó sin cargo y lo que el OCR leyó imposible. */
        incluir: (Number(l.importe) || 0) > 0 && !l.dudoso,
        regalo: !!l.regalo,
        productId: s.product_id ?? null,
        por: s.por ?? null,
        certeza: Number(s.certeza) || 0,
        candidatos: (s.candidatos || []).filter((c: any) => c.product_id !== s.product_id),
        presentaciones: [], presOpciones: [],
        presSel: s.presentation_id ?? null,
        nombreNueva: '',
        cantidad: 0, costo: 0,
      };
      return r;
    });
    await Promise.all(this.renglones.map(r => this.prepararProducto(r, true)));
  }

  private producto(id: number | null) {
    return id == null ? null : this.productos.find(p => p.id === id) || null;
  }

  private async presentacionesDe(id: number): Promise<Presentacion[]> {
    if (this.presCache.has(id)) return this.presCache.get(id)!;
    let lista: Presentacion[] = [];
    try {
      lista = (await this.hosp.presentations(id)).map((p: any) => ({
        id: Number(p.id), nombre: String(p.name), factor: Number(p.factor_to_base) || 1,
      }));
    } catch { /* sin presentaciones: se compra en unidad base */ }
    this.presCache.set(id, lista);
    return lista;
  }

  /** Nombre que tendría la presentación que trae el documento. */
  private nombrePresentacion(r: Renglon): string {
    const u = (r.unidad || '').toLowerCase();
    const base = u === 'caja' || u === 'paquete' || u === 'bulto' || u === 'costal' || u === 'charola' || u === 'six'
      ? u.charAt(0).toUpperCase() + u.slice(1) : 'Caja';
    return `${base} ×${r.factorDoc}`;
  }

  /**
   * Al cambiar (o sugerir) el producto: sus presentaciones, la que coincide
   * con lo que dice el documento y la opción de crearla si no existe.
   */
  async prepararProducto(r: Renglon, conSugerencia = false) {
    const p = this.producto(r.productId);
    if (!p) { r.presentaciones = []; r.presOpciones = []; r.presSel = null; this.recalcular(r); return; }
    const lista = await this.presentacionesDe(p.id);
    r.presentaciones = [{ id: null, nombre: `Por ${p.base_uom}`, factor: 1 }, ...lista];
    const coincide = lista.find(x => Math.abs(x.factor - r.factorDoc) < 0.001);
    r.nombreNueva = this.nombrePresentacion(r);
    r.presOpciones = r.presentaciones.map(x => ({ valor: x.id, etiqueta: x.nombre, nota: x.id === null ? p.base_uom : `×${x.factor}` }));
    if (r.factorDoc > 1 && !coincide) {
      r.presOpciones.push({ valor: 'nueva', etiqueta: `Crear «${r.nombreNueva}»`, nota: `×${r.factorDoc} ${p.base_uom}` });
    }
    if (!(conSugerencia && r.presSel != null && r.presentaciones.some(x => x.id === r.presSel))) {
      r.presSel = coincide ? coincide.id : (r.factorDoc > 1 ? 'nueva' : null);
    }
    this.recalcular(r);
  }

  async elegirProducto(r: Renglon, id: number | null) {
    r.productId = id;
    r.por = id == null ? null : 'manual';
    if (id != null) r.incluir = true;
    await this.prepararProducto(r);
  }

  factorSel(r: Renglon): number {
    /* Sin producto todavía: se ve tal como viene en el documento (2 cajas, no 24 pzas). */
    if (r.presSel === 'nueva' || !r.productId) return r.factorDoc;
    return r.presentaciones.find(x => x.id === r.presSel)?.factor || 1;
  }

  /** Descuento global (no el de cada renglón) repartido por importe. */
  private descuentoProrrateado(r: Renglon): number {
    const t = this.doc?.totales || {};
    /* En el CFDI el descuento total ya incluye el de cada concepto; en un
       ticket el del pie es aparte (el de un renglón es, p. ej., el cambio
       físico de ese producto). */
    const deRenglones = this.tipo === 'CFDI' ? this.renglones.reduce((a, x) => a + x.descuento, 0) : 0;
    const global = Math.max(0, (Number(t.descuento) || 0) - deRenglones);
    const suma = this.renglones.reduce((a, x) => a + x.importe, 0);
    return global && suma ? global * (r.importe / suma) : 0;
  }

  tasaDe(r: Renglon): number {
    const p = this.producto(r.productId);
    if (r.tasaDoc != null) return r.tasaDoc;
    if (!p) return 0.16;
    return p.objeto_impuesto !== '02' ? 0 : (Number(p.tasa_iva) || 0);
  }

  /** Cantidad y costo sin IVA en la presentación elegida. */
  recalcular(r: Renglon) {
    if (!r.cantidadDoc) { r.cantidad = 0; r.costo = 0; return; }
    let pagado = r.importe - r.descuento - this.descuentoProrrateado(r) + r.ieps;
    if (this.preciosConIva) pagado = pagado / (1 + this.tasaDe(r));
    const unidadesBase = r.cantidadDoc * r.factorDoc;
    const costoBase = pagado / unidadesBase;
    const f = this.factorSel(r);
    r.cantidad = r4(unidadesBase / f);
    r.costo = r4(costoBase * f);
  }

  alCambiarPrecioConIva() {
    this.renglones.forEach(r => this.recalcular(r));
  }

  usarCandidato(r: Renglon, id: number) {
    this.elegirProducto(r, id);
  }

  nombreProducto(id: number | null) {
    return this.producto(id)?.product_name || '';
  }

  etiquetaPor(r: Renglon): { texto: string; clase: string } {
    if (!r.productId) return { texto: 'Elige el producto', clase: 'falta' };
    switch (r.por) {
      case 'memoria': return { texto: 'Ya lo conocía', clase: 'ok' };
      case 'codigo': return { texto: 'Por código', clase: 'ok' };
      case 'parecido': return { texto: `Parecido ${Math.round(r.certeza * 100)}%`, clase: r.certeza >= 0.75 ? 'ok' : 'duda' };
      default: return { texto: 'Elegido', clase: 'ok' };
    }
  }

  /* ------------------------------------------------------------ totales */

  get incluidos() { return this.renglones.filter(r => r.incluir); }
  get sinProducto() { return this.incluidos.filter(r => !r.productId).length; }

  get subtotalCompra() {
    return r2(this.incluidos.reduce((a, r) => a + (Number(r.cantidad) || 0) * (Number(r.costo) || 0), 0));
  }
  get ivaCompra() {
    return r2(this.incluidos.reduce((a, r) => a + (Number(r.cantidad) || 0) * (Number(r.costo) || 0) * this.tasaDe(r), 0));
  }
  get totalCompra() { return r2(this.subtotalCompra + this.ivaCompra); }

  /** Lo que el documento cobra por mercancía: sin envases ni retenciones. */
  get totalDocumento(): number | null {
    const t = this.doc?.totales;
    if (!t || t.total == null) return null;
    return r2(t.total - (t.envases || 0) + (t.retenciones || 0));
  }

  get diferencia(): number | null {
    return this.totalDocumento == null ? null : r2(this.totalCompra - this.totalDocumento);
  }

  get cuadra() {
    const d = this.diferencia;
    return d != null && Math.abs(d) <= Math.max(0.5, this.incluidos.length * 0.02);
  }

  /* ------------------------------------------------------------- pasar */

  async pasar() {
    if (!this.proveedorId) {
      await Swal.fire({ icon: 'warning', title: 'Falta el proveedor', text: 'Elige o agrega el proveedor del documento.' });
      return;
    }
    if (!this.incluidos.length) {
      await Swal.fire({ icon: 'warning', title: 'No hay renglones', text: 'Marca al menos un renglón para pasarlo a la compra.' });
      return;
    }
    if (this.sinProducto) {
      await Swal.fire({ icon: 'warning', title: 'Faltan productos',
        text: `${this.sinProducto} ${this.sinProducto === 1 ? 'renglón no tiene' : 'renglones no tienen'} producto. Elígelo o desmárcalo.` });
      return;
    }
    if (this.incluidos.some(r => !(Number(r.cantidad) > 0) || !(Number(r.costo) > 0))) {
      await Swal.fire({ icon: 'warning', title: 'Revisa cantidades y costos', text: 'Cada renglón necesita cantidad y costo mayores a 0.' });
      return;
    }

    this.pasando = true;
    try {
      /* Las presentaciones que el documento trae y el producto no tenía. */
      for (const r of this.incluidos.filter(x => x.presSel === 'nueva')) {
        const id = await this.hosp.savePresentation({ productId: r.productId!, name: r.nombreNueva, factorToBase: r.factorDoc });
        this.presCache.delete(r.productId!);
        /* La nueva entra a la lista del renglón: de ahí sale el factor que se recuerda. */
        for (const o of this.incluidos.filter(x => x.presSel === 'nueva' && x.productId === r.productId && x.factorDoc === r.factorDoc)) {
          o.presentaciones = [...o.presentaciones, { id, nombre: o.nombreNueva, factor: o.factorDoc }];
          o.presSel = id;
        }
      }
      this.aplicar.emit({
        document_id: this.documentId,
        supplier_id: this.proveedorId,
        tipo: this.tipo,
        lineas: this.incluidos.map(r => ({
          productId: r.productId!,
          cantidad: Number(r.cantidad),
          costo: Number(r.costo),
          presentationId: typeof r.presSel === 'number' ? r.presSel : null,
          texto: r.texto,
          codigo: r.codigo,
          factor: this.factorSel(r),
        })),
      });
    } catch (e: any) {
      await Swal.fire({ icon: 'error', title: 'No se pudo pasar', text: e?.message || 'Ocurrió un error.' });
    } finally {
      this.pasando = false;
    }
  }

  /* -------------------------------------------------------- proveedor */

  abrirAltaProveedor() {
    this.altaProveedor = { nombre: this.doc?.proveedor || '', rfc: this.doc?.rfc || '' };
  }

  alGuardarProveedor(p: { id: number | null; nombre: string }) {
    this.altaProveedor = null;
    this.proveedorCreado.emit(p);
    if (p.id != null) this.proveedorId = Number(p.id);
  }

  otroDocumento() {
    this.paso = 'elegir';
    this.renglones = [];
    this.doc = null;
    this.error = '';
  }
}
