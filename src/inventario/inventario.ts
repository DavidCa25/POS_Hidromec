import { ChangeDetectorRef, Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { JsonPipe, NgFor, NgIf, NgStyle, CurrencyPipe } from '@angular/common';
import Swal from 'sweetalert2';
import { ReportService, ReportConfig } from '../services/report.service';
import { CatalogoItem } from '../services/catalogos.service';
import { ClaveSatPicker } from '../app/clave-sat-picker/clave-sat-picker.component';
import { WxMenuComponent, WxMenuOpcion } from '../app/wx-menu/wx-menu.component';
import { WxTablaBarraComponent } from '../app/wx-tabla/wx-tabla-barra.component';
import { EstadoTabla, WxItem } from '../app/wx-tabla/tabla-estado';
import { WxSelectComponent, WxOpcion } from '../app/wx-select/wx-select.component';
import { CapabilityService, HospitalityService, InventoryMode, Uom } from '../core';


interface ProductRow {
  id: number;
  part_number: string;
  product_name?: string;
  nombre?: string;
  name?: string;
  bar_code?: string;
  price: number;
  stock: number;
  brand_id?: number;
  category_id?: number;
  category_name?: string;
  brand_name?: string;
  clave_prod_serv?: string;
  clave_unidad?: string;
  objeto_impuesto?: string;
  tasa_iva?: number;
  default_supplier_name?: string;
  inventory_mode?: InventoryMode;
  sellable?: boolean | number;
  base_uom?: string;
  allow_decimal_qty?: boolean | number;
  image_version?: number;
}

interface ProductForm {
  brand: number | null;
  category: number | null;
  partNumber: string;
  name: string;
  price: number | null;
  stock: number;
  barCode: string; 
  claveProdServ: string;      
  claveProdServDesc: string;  
  claveUnidad: string;        
  claveUnidadDesc: string;   
  objetoImpuesto: string;   
  tasaIva: number;           
  /**
   * Como se controla el producto. Ya existia en products y en los procedures
   * desde el dominio Hospitality; lo que faltaba era poder decirlo desde aqui,
   * asi que todo nacia DIRECT / vendible / pza aunque fuera un ingrediente.
   *
   * Los dos ejes son independientes a proposito: un producto DIRECT puede
   * venderse en caja Y usarse como ingrediente de una receta.
   */
  inventoryMode: InventoryMode;
  sellable: boolean;
  baseUom: string;
  allowDecimalQty: boolean;
  /**
   * Si el producto lleva codigo de barras. No es una columna: `bar_code` ya
   * admite NULL. Es solo la forma de decir "este no tiene" sin dejar un campo
   * de texto vacio pidiendo atencion en cada alta.
   */
  tieneCodigoBarras: boolean;
}

/** Valores con los que nace un producto Retail: identicos a los de antes. */
const CONTROL_RETAIL = {
  inventoryMode: 'DIRECT' as InventoryMode,
  sellable: true,
  baseUom: 'pza',
  allowDecimalQty: false,
  tieneCodigoBarras: false,
};

interface CategoryRow { id: number; namee: string; }
interface BrandRow { id: number; namee: string; }

type PageItem = number | '...';

type SupplierRow = { id: number; nombre: string };

type ProductSupplierRow = {
  product_id: number;
  supplier_id: number;
  supplier_name: string;
  is_default: boolean;
  last_cost: number | null;
  active: boolean;
};

@Component({
  selector: 'app-inventario',
  templateUrl: './inventario.html',
  standalone: true,
  imports: [WxMenuComponent, WxTablaBarraComponent, RouterOutlet, FormsModule, JsonPipe, NgFor, NgStyle, NgIf, CurrencyPipe, ClaveSatPicker, WxSelectComponent],
  styleUrls: ['./inventario.css']
})
export class Inventario {
  form: ProductForm = {
    brand: null, category: null, partNumber: '', name: '', price: null, stock: 0, barCode: '',
    claveProdServ: '', claveProdServDesc: '', claveUnidad: '', claveUnidadDesc: '',
    objetoImpuesto: '02', tasaIva: 0.16, ...CONTROL_RETAIL
  };

  // ----------------------------------------------------- presentaciones
  /**
   * Como se COMPRA este producto, cuando no se compra de uno en uno.
   *
   * `product_presentations` y la conversion en `sp_register_purchase` existian
   * desde el dominio Hospitality, pero no habia forma de definir ninguna: la
   * tabla, sus tres procedimientos y el canal estaban completos y sin una sola
   * pantalla que los alcanzara.
   *
   * `factor_to_base` es cuantas unidades base trae la presentacion: una caja
   * de 1 L de leche son 1000 ml. Comprar 5 cajas sube el inventario 5000.
   */
  presentaciones: { id: number | null; name: string; factorToBase: number | null }[] = [];
  /** Las que habia al abrir: al guardar, lo que ya no este se da de baja. */
  private presentacionesOriginales: number[] = [];

  get gestionaPresentaciones(): boolean {
    return this.caps.hospitality && this.capturaStock;
  }

  agregarPresentacion() {
    this.presentaciones.push({ id: null, name: '', factorToBase: null });
  }

  quitarPresentacion(i: number) {
    this.presentaciones.splice(i, 1);
  }

  /** Cuantas unidades base son, para enseñarlo mientras se escribe. */
  equivalencia(p: { factorToBase: number | null }): string {
    const f = Number(p.factorToBase ?? 0);
    if (!f || f <= 0) return '';
    return `= ${f} ${this.form.baseUom}`;
  }

  private async cargarPresentaciones(productId: number) {
    this.presentaciones = [];
    this.presentacionesOriginales = [];
    if (!productId || !this.caps.hospitality) return;
    try {
      const lista = await this.hosp.presentations(productId);
      this.presentaciones = lista.map(p => ({
        id: Number(p.id), name: String(p.name ?? ''), factorToBase: Number(p.factor_to_base ?? 0),
      }));
      this.presentacionesOriginales = this.presentaciones.map(p => Number(p.id));
      this.cdr.detectChanges();
    } catch {
      // Sin presentaciones el alta sigue funcionando: son opcionales.
    }
  }

  /**
   * Guarda las presentaciones. Como la imagen, necesita el id del producto,
   * asi que corre DESPUES de crearlo o actualizarlo. Un fallo aqui no invalida
   * el producto: ya quedo guardado.
   */
  private async guardarPresentaciones(productId: number) {
    if (!productId || !this.caps.hospitality) return;
    const validas = this.presentaciones.filter(p => p.name.trim() && Number(p.factorToBase) > 0);
    try {
      for (const p of validas) {
        await this.hosp.savePresentation({
          id: p.id, productId, name: p.name.trim(), factorToBase: Number(p.factorToBase),
        });
      }
      const quedan = new Set(validas.map(p => p.id).filter((x): x is number => x != null));
      for (const id of this.presentacionesOriginales) {
        if (!quedan.has(id)) await this.hosp.deletePresentation(id);
      }
    } catch (e: any) {
      await Swal.fire({
        icon: 'warning',
        title: 'El producto se guardó, las presentaciones no',
        text: e?.message || 'Puedes volver a intentarlo editándolo.',
      });
    }
  }

  // ------------------------------------------------------------- imagen
  /** Lo que se ve en el modal: la miniatura actual o la recien elegida. */
  imagenPrevia: string | null = null;
  /** Solo se manda al guardar si el usuario la toco: elegir, cambiar o quitar. */
  private imagenTocada = false;
  notaImagen = '';

  /**
   * Lee el archivo y lo deja en vista previa. NO se guarda todavia: un
   * producto que aun no existe no tiene id al que colgarle una imagen, y una
   * edicion que el usuario cancele no debe haber cambiado nada.
   */
  elegirImagen(e: Event) {
    const input = e.target as HTMLInputElement;
    const archivo = input.files?.[0];
    if (!archivo) return;

    if (!archivo.type.startsWith('image/')) {
      this.notaImagen = 'Ese archivo no es una imagen.';
      return;
    }

    const lector = new FileReader();
    lector.onload = () => {
      this.imagenPrevia = String(lector.result || '') || null;
      this.imagenTocada = true;
      // El tamano real lo decide el proceso principal al guardar: reduce a
      // 192px y baja calidad hasta caber en 64 KB. Aqui no se rechaza nada
      // por peso, se avisa de lo que va a pasar.
      this.notaImagen = 'Se guardará reducida a 192 px.';
    };
    lector.onerror = () => { this.notaImagen = 'No se pudo leer la imagen.'; };
    lector.readAsDataURL(archivo);
  }

  quitarImagen() {
    this.imagenPrevia = null;
    this.imagenTocada = true;
    this.notaImagen = 'Se quitará al guardar.';
  }

  private limpiarImagen() {
    this.imagenPrevia = null;
    this.imagenTocada = false;
    this.notaImagen = '';
  }

  /** Trae la miniatura ya guardada para poder verla y cambiarla al editar. */
  private async cargarImagen(item: ProductRow) {
    const version = Number(item?.image_version ?? 0);
    if (!version) return;
    try {
      const api = (window as any).wybix;
      const r = await api?.images?.sync?.({ versions: { [Number(item.id)]: version } });
      // El canal devuelve { rutas, descargadas }, igual que lee MenuCatalog.
      // La miniatura puede no estar: si se quito, la version sigue subiendo
      // pero ya no hay fila en product_images. Eso no es un error.
      const url = r?.data?.rutas?.[Number(item.id)] ?? r?.data?.rutas?.[String(item.id)];
      if (!url) return;
      this.imagenPrevia = url;
      // La respuesta llega por `ipcRenderer.invoke`, cuya promesa nace en el
      // preload: fuera de la zona de Angular. Nadie programa deteccion de
      // cambios al resolverse, asi que la vista previa se quedaba en la
      // propiedad sin llegar a pintarse. Por eso el resto del Core usa
      // signals; aqui, que es una pantalla de zona, se avisa a mano.
      if (this.productoModalAbierto) this.cdr.detectChanges();
    } catch {
      // Sin miniatura el modal sigue sirviendo: se puede elegir otra.
      this.notaImagen = 'No se pudo cargar la imagen guardada.';
    }
  }

  /**
   * Guarda la imagen del producto. Se llama DESPUES de crear o actualizar,
   * porque `images:set` necesita el id.
   *
   * Un fallo aqui no invalida el producto: ya quedo guardado. Se avisa y se
   * sigue, en vez de dejar creer que no se guardo nada.
   */
  private async guardarImagen(productId: number) {
    if (!this.imagenTocada || !productId) return;
    try {
      const api = (window as any).wybix;
      const r = await api?.images?.set?.({ productId, dataUrl: this.imagenPrevia });
      if (!r?.success) throw new Error(r?.error || 'No se pudo guardar la imagen.');
    } catch (e: any) {
      await Swal.fire({
        icon: 'warning',
        title: 'El producto se guardó, la imagen no',
        text: e?.message || 'Puedes volver a intentarlo editándolo.',
      });
    }
  }

  /** El campo solo aparece si hay codigo; al desmarcar, se limpia. */
  alternarCodigoBarras(v: boolean) {
    this.form.tieneCodigoBarras = v;
    if (!v) {
      this.form.barCode = '';
      this.capturandoCodigo = false;
    }
  }

  // ---------------------------------------------------- control del producto
  /** Unidades BASE del dominio (pza, g, ml, cm). No se inventan aqui. */
  unidadesBase: Uom[] = [];
  /** Stock que tenia el producto antes de convertirlo a receta. */
  private stockAntesDeEditar = 0;
  private modoAntesDeEditar: InventoryMode = 'DIRECT';

  readonly modosInventario: { valor: InventoryMode; titulo: string; desc: string; icono: string }[] = [
    { valor: 'DIRECT', titulo: 'Inventario directo', icono: 'ph-package',
      desc: 'Se cuenta por unidades. Sirve para vender y también como ingrediente.' },
    { valor: 'RECIPE', titulo: 'Se prepara por receta', icono: 'ph-cooking-pot',
      desc: 'Su disponibilidad sale de los ingredientes de la receta.' },
    { valor: 'NONE', titulo: 'Sin inventario', icono: 'ph-hand-heart',
      desc: 'Servicios y cargos: no descuenta existencias.' },
  ];

  get opcUnidades(): WxOpcion[] {
    return this.unidadesBase.map(u => ({ valor: u.code, etiqueta: u.name, nota: u.code }));
  }

  /** El stock fisico solo tiene sentido cuando el producto se cuenta. */
  get capturaStock(): boolean { return this.form.inventoryMode === 'DIRECT'; }

  /**
   * Nombre de la unidad en la que se guarda el stock.
   *
   * Se guarda SIEMPRE en la unidad base -es lo que consumen las recetas-, y
   * el formulario no lo decia: quien escribia "12" en un producto medido en
   * mililitros creia estar guardando 12 envases y guardaba 12 ml. Con esa
   * cifra, una receta que pide 40 ml da cero unidades disponibles y el
   * producto sale "Agotado" sin que nadie entienda por que.
   */
  get unidadDeStock(): string {
    if (!this.caps.hospitality) return '';
    const u = this.unidadesBase.find(x => x.code === this.form.baseUom);
    return u ? `${u.name.toLowerCase()} (${u.code})` : this.form.baseUom;
  }

  /**
   * Presentacion elegida para CAPTURAR el stock. `null` = unidad base.
   *
   * Es la respuesta a "tengo 12 cajas de un litro": se escribe 12, se elige
   * "Caja 1 L" y se guardan 12000 ml. El stock en la base sigue siendo
   * siempre en unidad base, que es lo que consumen las recetas; lo unico que
   * cambia es en que piensa quien lo captura.
   */
  presentacionStock: number | null = null;

  get opcPresentacionesStock(): WxOpcion[] {
    const base = this.unidadesBase.find(u => u.code === this.form.baseUom);
    return [
      { valor: null, etiqueta: base ? base.name : this.form.baseUom, nota: this.form.baseUom },
      ...this.presentaciones
        .filter(p => p.name.trim() && Number(p.factorToBase) > 0)
        .map(p => ({ valor: p.id ?? p.name, etiqueta: p.name, nota: `x${p.factorToBase}` })),
    ];
  }

  private get factorDeCaptura(): number {
    if (this.presentacionStock == null) return 1;
    const p = this.presentaciones.find(x => (x.id ?? x.name) === this.presentacionStock);
    return Number(p?.factorToBase) > 0 ? Number(p!.factorToBase) : 1;
  }

  /** Lo que se guardara de verdad, en unidad base. */
  get stockEnUnidadBase(): number {
    return Number(this.form.stock ?? 0) * this.factorDeCaptura;
  }

  /** Se ensena solo cuando el numero escrito y el guardado no coinciden. */
  get equivalenciaStock(): string {
    if (this.presentacionStock == null) return '';
    return `Se guardarán ${this.stockEnUnidadBase} ${this.form.baseUom}`;
  }

  /** Ejemplo concreto para la unidad elegida. Vale mas que una explicacion. */
  get ayudaDeStock(): string {
    if (!this.caps.hospitality) return '';
    switch (this.form.baseUom) {
      case 'ml': return 'En mililitros: 12 cajas de 1 L son 12000.';
      case 'g':  return 'En gramos: 3 bolsas de 1 kg son 3000.';
      case 'cm': return 'En centimetros: un rollo de 5 m son 500.';
      default:   return '';
    }
  }

  /** Aviso corto bajo el selector de tipo. Sin jerga. */
  get notaDelModo(): string {
    if (this.form.inventoryMode === 'RECIPE')
      return 'La disponibilidad se calcula a partir de los ingredientes de la receta.';
    if (this.form.inventoryMode === 'NONE')
      return 'No descuenta existencias al venderse.';
    return '';
  }

  /**
   * Al cambiar de tipo solo se mueve lo que deja de tener sentido.
   *
   * Los decimales siguen a la unidad -gramos y mililitros se miden partidos,
   * las piezas no-, pero es una SUGERENCIA: el usuario puede cambiarla, porque
   * el modelo admite las dos combinaciones.
   */
  cambiarModo(m: InventoryMode) {
    this.form.inventoryMode = m;
    if (m === 'RECIPE') {
      this.form.baseUom = 'pza';
      this.form.allowDecimalQty = false;
    }
  }

  cambiarUnidad(code: string) {
    this.form.baseUom = code;
    this.form.allowDecimalQty = code !== 'pza';
  }

  /**
   * Lo que se manda al canal. En Retail se devuelve `null`: sin este objeto el
   * procedimiento aplica sus propios defaults, que son exactamente los de
   * antes. Asi el formulario Retail no adquiere responsabilidades nuevas.
   */
  private controlDelProducto(forma: 'camel' | 'snake' = 'camel'): any {
    if (!this.caps.hospitality) return forma === 'snake' ? {} : null;
    return forma === 'snake'
      ? {
          inventory_mode: this.form.inventoryMode,
          sellable: this.form.sellable,
          base_uom: this.form.baseUom,
          allow_decimal_qty: this.form.allowDecimalQty,
        }
      : {
          inventory_mode: this.form.inventoryMode,
          sellable: this.form.sellable,
          base_uom: this.form.baseUom,
          allow_decimal_qty: this.form.allowDecimalQty,
        };
  }

  /**
   * Convertir un producto que YA tiene existencias en una receta las pone a
   * cero: una receta no las tiene propias. Eso no se hace en silencio -son
   * unidades que alguien contó- asi que se dice y se pide confirmacion.
   *
   * No se inventa un movimiento de inventario aqui: registrar un ajuste es
   * una decision de negocio, no un efecto colateral de editar un producto.
   */
  private async confirmarPerdidaDeStock(): Promise<boolean> {
    const seVuelveReceta = this.modoAntesDeEditar !== 'RECIPE' && this.form.inventoryMode === 'RECIPE';
    if (!seVuelveReceta || this.stockAntesDeEditar <= 0) return true;
    const r = await Swal.fire({
      icon: 'warning',
      title: 'Este producto tiene existencias',
      html: `Tiene <b>${this.stockAntesDeEditar}</b> en inventario. Al pasarlo a receta, su disponibilidad`
          + ' pasa a depender de los ingredientes y esas existencias quedan en 0.',
      showCancelButton: true,
      confirmButtonText: 'Convertir en receta',
      cancelButtonText: 'Cancelar',
    });
    return r.isConfirmed;
  }

  private async cargarUnidades() {
    try {
      const todas = await this.hosp.loadUoms();
      this.unidadesBase = todas.filter(u => u.is_base);
    } catch {
      // Sin unidades el selector queda vacio y el producto nace en 'pza',
      // que es lo que hacia antes: no se bloquea el alta por esto.
      this.unidadesBase = [];
    }
  }

  inventario: any[] = [];
  colorModalAbierto = false;
  productoModalAbierto = false;

  proveedoresModalAbierto = false;
  selectedProduct: any = null;

  productSuppliers: ProductSupplierRow[] = [];
  suppliersCatalog: SupplierRow[] = [];
  supplierToAdd: number | null = null;
  supplierIsDefault = false;
  supplierLastCost: number | null = null;
  editingProductId: number | null = null; 

  newSupplierName = '';
  creatingSupplier = false;

  brands: BrandRow[] = [];
  categorys: CategoryRow[] = [];

  brandModalAbierto = false;
  categoryModalAbierto = false;

  newBrandName = '';
  newCategoryName = '';

  creatingBrand = false;
  creatingCategory = false;

  capturandoCodigo = false;
  guardando = false;

  facturacionActiva = false;

  objImpAbierto = false;
  tasaAbierta = false;

  colores = [
    { nombre: 'Navy Blue', value: '#000080' },
    { nombre: 'Dorado', value: '#B8860B' },
  ];

  filtro = '';
  expExportOpen = false;
  page = 1;
  pageSizeOptions = [10, 20, 50, 100];
  /** Mismas opciones de siempre, en el formato del selector Wybix. */
  /**
   * Listas de los selectores de los modales de Inventario. Son las mismas
   * opciones que estaban en el marcado; aqui solo cambian de formato.
   */
  get opcMarcas(): WxOpcion[] {
    return (this.brands || []).map((b: any) => ({ valor: b.id, etiqueta: b.namee }));
  }
  get opcCategorias(): WxOpcion[] {
    return (this.categorys || []).map((c: any) => ({ valor: c.id, etiqueta: c.namee }));
  }
  get opcProveedores(): WxOpcion[] {
    return (this.suppliersCatalog || []).map((s: any) => ({ valor: s.id, etiqueta: s.nombre }));
  }

  get opcionesPagina(): WxOpcion[] {
    return this.pageSizeOptions.map(n => ({ valor: n, etiqueta: String(n) }));
  }

  pageSize = 10;

  objetoImpuestoOpts = [
    { code: '01', label: 'No objeto de impuesto' },
    { code: '02', label: 'Si objeto de impuesto' },
    { code: '03', label: 'Si objeto, no obligado al desglose' },
    { code: '04', label: 'Si objeto, no causa impuesto' }
  ];

  tasaIvaOpts = [
    { value: 0.16, label: '16%' },
    { value: 0.08, label: '8% (frontera)' },
    { value: 0,    label: '0% / Exento' }
  ];

  constructor(
    private reports: ReportService,
    public caps: CapabilityService,
    private hosp: HospitalityService,
    private cdr: ChangeDetectorRef,
  ) {}

  async ngOnInit() {
    await this.consultarInventario();
    await this.cargarCategorias();
    await this.cargarMarcas();
    await this.cargarCatalogoProveedores();
    await this.verificarFacturacion();
    

    const api = (window as any).electronAPI;
    if (api?.onBarcodeScan) {
      api.onBarcodeScan((payload: any) => {
        if (!this.capturandoCodigo || !this.productoModalAbierto) return;
        const code = String(payload?.code || '').trim();
        if (!code) return;
        this.form.barCode = code;
        this.capturandoCodigo = false;
      });
    }
  }

  async verificarFacturacion() {
    try {
      const res = await (window as any).electronAPI?.getFiscalConfig?.();
      this.facturacionActiva = !!(res?.success && res.data?.csd_registrado);
    } catch {
      this.facturacionActiva = false;
    }
  }

  async consultarInventario() {
    try {
      const resultado = await (window as any).electronAPI.getActiveProducts();
      this.inventario = resultado ?? [];
    } catch (error) {
      console.error('Error al consultar el inventario:', error);
      this.inventario = [];
    }
  }

  async cargarCategorias() {
    try {
      const rs = await (window as any).electronAPI.getCategories();
      this.categorys = (Array.isArray(rs) && rs.length && 'id' in rs[0]) ? rs : [];
    } catch (error) {
      console.error('Error al cargar categorías:', error);
      this.categorys = [];
    }
  }

  async cargarMarcas() {
    try {
      const rs = await (window as any).electronAPI.getBrands();
      this.brands = (Array.isArray(rs) && rs.length && 'id' in rs[0]) ? rs : [];
    } catch (error) {
      console.error('❌ Error al cargar marcas:', error);
      this.brands = [];
    }
  }

  async cargarCatalogoProveedores() {
    try {
      const res = await (window as any).electronAPI.getSuppliers?.();
      const arr = Array.isArray(res) ? res : (Array.isArray(res?.data) ? res.data : []);
      this.suppliersCatalog = (arr ?? []).map((s: any) => ({
        id: Number(s.id),
        nombre: String(s.nombre ?? s.namee ?? s.name ?? '').trim()
      })).filter((s: SupplierRow) => Number.isFinite(s.id) && s.nombre);
    } catch (e) {
      console.error('❌ Error cargando catálogo proveedores:', e);
      this.suppliersCatalog = [];
    }
  }

  async addProduct() {
    try {
      const { brand, category, partNumber, name, price, stock } = this.form;
      if (brand == null || category == null || !partNumber || !name || price == null) {
        await Swal.fire({ icon: 'error', title: 'Campos incompletos', text: 'Completa los campos obligatorios.' });
        return;
      }

      const result = await (window as any).electronAPI.agregarProducto(
        brand, category, partNumber, name, price,
        // Una receta no tiene existencias propias: las tienen sus
        // ingredientes. El procedimiento tambien lo fuerza, pero mandarlo
        // desde aqui evita que el formulario prometa algo que no ocurre.
        // Lo que viaja es SIEMPRE unidad base: si se capturo en cajas, aqui
        // ya viene multiplicado por el factor de la presentacion.
        this.capturaStock ? this.stockEnUnidadBase : 0,
        this.form.claveProdServ || null,
        this.form.claveUnidad || null,
        this.form.objetoImpuesto || '02',
        this.form.tasaIva ?? 0.16,
        // Sin la casilla marcada se manda NULL: el contrato de `bar_code`
        // ya admite ausencia, no hace falta nada nuevo.
        this.form.tieneCodigoBarras ? (this.form.barCode || null) : null,
        this.controlDelProducto()
      );

      if (result?.success) {
        // La imagen necesita el id que acaba de devolver el alta.
        const nuevoId = Number(result?.data?.[0]?.id ?? 0);
        await this.guardarPresentaciones(nuevoId);
        await this.guardarImagen(nuevoId);
        await this.consultarInventario();
        this.cerrarProductoModal();
        this.form = { brand: null, category: null, partNumber: '', name: '', price: 0, stock: 0, barCode: '',
          claveProdServ: '', claveProdServDesc: '', claveUnidad: '', claveUnidadDesc: '',
          objetoImpuesto: '02', tasaIva: 0.16, ...CONTROL_RETAIL };
        await Swal.fire({
          icon: 'success',
          title: '¡Producto agregado!',
          text: 'Se guardó correctamente.',
          timer: 1600,
          showConfirmButton: false,
          timerProgressBar: true
        });
      } else {
        await Swal.fire({ icon: 'error', title: 'Error', text: result?.error ?? 'No se pudo agregar.' });
      }
    } catch (e) {
      console.error('❌ Error al agregar el producto:', e);
      await Swal.fire({ icon: 'error', title: 'Ups...', text: 'Error inesperado al agregar el producto.' });
    }
  }

  /** Producto cuya baja se esta procesando, para no repetir el clic. */
  dandoDeBaja: number | null = null;

  /**
   * Baja logica de un producto.
   *
   * Quien decide si se puede es el procedimiento, no esta pantalla: si el
   * producto sigue siendo ingrediente de una receta viva o lo usa un
   * modificador activo, devuelve el motivo con los nombres. Aqui solo se
   * pregunta, se espera el resultado y se refresca la tabla.
   */
  async darDeBajaProducto(item: ProductRow) {
    const id = Number(item?.id ?? 0);
    if (!id || this.dandoDeBaja) return;
    const nombre = String(item?.product_name ?? item?.nombre ?? item?.name ?? '').trim();

    const conf = await Swal.fire({
      icon: 'warning',
      title: 'Dar de baja producto',
      html: `<b>${nombre}</b><br>El producto dejará de estar disponible para nuevas ventas,`
          + ' pero conservará su historial.',
      showCancelButton: true,
      confirmButtonText: 'Dar de baja',
      cancelButtonText: 'Cancelar',
    });
    if (!conf.isConfirmed) return;

    this.dandoDeBaja = id;
    try {
      const res = await (window as any).electronAPI.darDeBajaProducto(id);
      if (!res?.success) {
        // El mensaje ya nombra las recetas o los modificadores que lo usan.
        await Swal.fire({ icon: 'error', title: 'No se puede dar de baja', text: res?.error || 'No se pudo completar.' });
        return;
      }
      // La tabla se rehace desde SQL: nada de quitar la fila a mano y esperar
      // que coincida con lo que quedo guardado.
      await this.consultarInventario();
      await Swal.fire({ icon: 'success', title: 'Producto dado de baja', timer: 1400, showConfirmButton: false });
    } catch (e: any) {
      await Swal.fire({ icon: 'error', title: 'Error', text: e?.message || 'Error inesperado.' });
    } finally {
      this.dandoDeBaja = null;
    }
  }

  async guardarProducto() {
    if (this.guardando) return;
    if (this.editingProductId) {
      await this.actualizarProducto();
    } else {
      await this.addProduct();
    }
  }

  async actualizarProducto() {
    const { name, price, stock, partNumber, barCode } = this.form;
    if (!name || price == null) {
      await Swal.fire({ icon: 'error', title: 'Campos incompletos', text: 'Nombre y precio son obligatorios.' });
      return;
    }

    if (!(await this.confirmarPerdidaDeStock())) return;

    try {
      this.guardando = true;
      const api = (window as any).electronAPI;
      const payload = {
        product_id: this.editingProductId,
        nombre: name,
        precio: price,
        stock: this.capturaStock ? this.stockEnUnidadBase : 0,
        numero_parte: partNumber,
        // Cadena vacia = limpiar; NULL = conservar. Al desmarcar la casilla
        // se manda vacia, que es como el procedimiento borra el codigo.
        bar_code: this.form.tieneCodigoBarras ? (barCode ?? '') : '',
        clave_prod_serv: this.form.claveProdServ || null,
        clave_unidad: this.form.claveUnidad || null,
        objeto_impuesto: this.form.objetoImpuesto || '02',
        tasa_iva: this.form.tasaIva ?? 0.16,
        ...this.controlDelProducto('snake'),
      };

      const res = await api.actualizarProducto(payload);
      if (!res?.success) {
        await Swal.fire({ icon: 'error', title: 'No se pudo actualizar', text: res?.error || 'Error al actualizar.' });
        return;
      }

      await this.guardarPresentaciones(Number(this.editingProductId));
      await this.guardarImagen(Number(this.editingProductId));
      await this.consultarInventario();
      this.cerrarProductoModal();
      await Swal.fire({ icon: 'success', title: 'Producto actualizado', timer: 1400, showConfirmButton: false });
    } catch (e: any) {
      await Swal.fire({ icon: 'error', title: 'Error', text: e?.message || 'Error inesperado.' });
    } finally {
      this.guardando = false;
    }
  }


  abrirProductoModal() {
    this.editingProductId = null;
    this.form = { brand: null, category: null, partNumber: '', name: '', price: null, stock: 0, barCode: '',
      claveProdServ: '', claveProdServDesc: '', claveUnidad: '', claveUnidadDesc: '',
      objetoImpuesto: '02', tasaIva: 0.16, ...CONTROL_RETAIL };
    this.stockAntesDeEditar = 0;
    this.modoAntesDeEditar = 'DIRECT';
    this.limpiarImagen();
    this.presentaciones = [];
    this.presentacionesOriginales = [];
    this.presentacionStock = null;
    this.capturandoCodigo = false;
    this.productoModalAbierto = true;
    this.cargarCategorias();
    this.cargarMarcas();
    if (this.caps.hospitality) this.cargarUnidades();
  }

  abrirEditarProducto(item: ProductRow) {
    this.editingProductId = Number(item?.id ?? 0) || null;
    this.form = {
      brand: item?.brand_id ?? null,
      category: item?.category_id ?? null,
      partNumber: String(item?.part_number ?? ''),
      name: String(item?.product_name ?? item?.nombre ?? item?.name ?? ''),
      price: Number(item?.price ?? 0),
      stock: Number(item?.stock ?? 0),
      barCode: String(item?.bar_code ?? ''),
      claveProdServ: String(item?.clave_prod_serv ?? ''),
      claveProdServDesc: '',
      claveUnidad: String(item?.clave_unidad ?? ''),
      claveUnidadDesc: '',
      objetoImpuesto: String(item?.objeto_impuesto ?? '02'),
      tasaIva: item?.tasa_iva != null ? Number(item.tasa_iva) : 0.16,
      // Lo que el producto ya es. Un producto anterior a Hospitality no trae
      // estos campos y cae en los mismos valores con los que se creo.
      inventoryMode: (item?.inventory_mode ?? 'DIRECT') as InventoryMode,
      sellable: item?.sellable != null ? !!item.sellable : true,
      baseUom: String(item?.base_uom ?? 'pza'),
      allowDecimalQty: !!item?.allow_decimal_qty,
      // Si ya tiene codigo, la casilla nace marcada y el campo visible.
      tieneCodigoBarras: !!String(item?.bar_code ?? '').trim(),
    };
    this.limpiarImagen();
    this.presentacionStock = null;
    this.cargarPresentaciones(Number(item?.id ?? 0));
    this.cargarImagen(item);
    this.stockAntesDeEditar = Number(item?.stock ?? 0) || 0;
    this.modoAntesDeEditar = this.form.inventoryMode;
    this.capturandoCodigo = false;
    this.productoModalAbierto = true;
    this.cargarCategorias();
    this.cargarMarcas();
    if (this.caps.hospitality) this.cargarUnidades();
  }

  cerrarProductoModal() { this.productoModalAbierto = false; }

  abrirColorModal() { this.colorModalAbierto = true; }
  cerrarColorModal() { this.colorModalAbierto = false; }
  cambiarColor(color: string) {
    document.documentElement.style.setProperty('--castrol-main', color);
    this.colorModalAbierto = false;
  }

  async abrirProveedoresModal(product: any) {
    this.selectedProduct = product;
    this.proveedoresModalAbierto = true;

    this.supplierToAdd = null;
    this.supplierIsDefault = false;
    this.supplierLastCost = null;

    this.newSupplierName = '';
    this.creatingSupplier = false;

    await this.cargarCatalogoProveedores();
    await this.cargarProveedoresDeProducto();
  }

  cerrarProveedoresModal() {
    this.proveedoresModalAbierto = false;
    this.selectedProduct = null;
    this.productSuppliers = [];
  }

  async cargarProveedoresDeProducto() {
    try {
      const api = (window as any).electronAPI;
      const productId = Number(this.selectedProduct?.id ?? 0);
      if (!productId) return;

      const res = await api.getProductSuppliers(productId, false);
      if (!res?.success) throw new Error(res?.error || 'No se pudieron cargar proveedores');

      this.productSuppliers = (res.data ?? []).map((r: any) => ({
        product_id: Number(r.product_id),
        supplier_id: Number(r.supplier_id),
        supplier_name: String(r.supplier_name ?? r.nombre ?? r.namee ?? '—'),
        is_default: !!r.is_default,
        last_cost: (r.last_cost === null || r.last_cost === undefined) ? null : Number(r.last_cost),
        active: r.active === undefined ? true : !!r.active
      }));
    } catch (e) {
      console.error('cargarProveedoresDeProducto:', e);
      this.productSuppliers = [];
    }
  }

  async agregarProveedorAlProducto() {
    try {
      const api = (window as any).electronAPI;
      const productId = Number(this.selectedProduct?.id ?? 0);
      const supplierId = Number(this.supplierToAdd ?? 0);

      if (!productId || !supplierId) {
        await Swal.fire('Falta proveedor', 'Selecciona un proveedor.', 'warning');
        return;
      }

      const payload = {
        product_id: productId,
        supplier_id: supplierId,
        is_default: this.supplierIsDefault ? 1 : 0,
        last_cost: this.supplierLastCost,
        active: 1
      };

      const res = await api.upsertProductSupplier(payload);
      if (!res?.success) throw new Error(res?.error || 'No se pudo agregar');

      this.productSuppliers = res.data ?? [];
      this.supplierToAdd = null;
      this.supplierIsDefault = false;
      this.supplierLastCost = null;

      await this.consultarInventario();
    } catch (e: any) {
      console.error(e);
      await Swal.fire('Error', e?.message || 'No se pudo agregar el proveedor.', 'error');
    }
  }

  async crearProveedorCatalogoYSeleccionar() {
    const nombre = (this.newSupplierName || '').trim();
    if (!nombre) {
      await Swal.fire('Falta nombre', 'Escribe el nombre del proveedor.', 'warning');
      return;
    }

    try {
      this.creatingSupplier = true;
      const res = await (window as any).electronAPI.addSupplier(nombre);
      if (!res?.success) throw new Error(res?.error || 'No se pudo crear proveedor');

      const newId = Number(res?.data?.id ?? 0);
      await this.cargarCatalogoProveedores();

      if (newId) this.supplierToAdd = newId;

      this.newSupplierName = '';
      await Swal.fire('Listo', 'Proveedor creado en catálogo.', 'success');
    } catch (e: any) {
      console.error(e);
      await Swal.fire('Error', e?.message || 'No se pudo crear el proveedor.', 'error');
    } finally {
      this.creatingSupplier = false;
    }
  }

  async setDefaultSupplier(row: ProductSupplierRow) {
    try {
      const api = (window as any).electronAPI;
      const res = await api.setProductDefaultSupplier(row.product_id, row.supplier_id);
      if (!res?.success) throw new Error(res?.error || 'No se pudo asignar default');

      this.productSuppliers = res.data ?? [];
      await this.consultarInventario(); 
    } catch (e: any) {
      console.error(e);
      await Swal.fire('Error', e?.message || 'No se pudo asignar default.', 'error');
    }
  }

  async updateLastCost(row: ProductSupplierRow) {
    try {
      const api = (window as any).electronAPI;
      const payload = {
        product_id: row.product_id,
        supplier_id: row.supplier_id,
        is_default: row.is_default ? 1 : 0,
        last_cost: row.last_cost,
        active: row.active ? 1 : 0
      };

      const res = await api.upsertProductSupplier(payload);
      if (!res?.success) throw new Error(res?.error || 'No se pudo actualizar');

      this.productSuppliers = res.data ?? [];
    } catch (e: any) {
      console.error(e);
      await Swal.fire('Error', e?.message || 'No se pudo actualizar.', 'error');
    }
  }

  async quitarProveedor(row: ProductSupplierRow) {
    const ok = await Swal.fire({
      icon: 'warning',
      title: 'Quitar proveedor',
      text: `¿Quitar "${row.supplier_name}" de este producto?`,
      showCancelButton: true,
      confirmButtonText: 'Sí, quitar',
      cancelButtonText: 'Cancelar'
    });

    if (!ok.isConfirmed) return;

    try {
      const api = (window as any).electronAPI;
      const res = await api.removeProductSupplier(row.product_id, row.supplier_id);
      if (!res?.success) throw new Error(res?.error || 'No se pudo quitar');

      this.productSuppliers = res.data ?? [];
      await this.consultarInventario(); // refresca columna default
    } catch (e: any) {
      console.error(e);
      await Swal.fire('Error', e?.message || 'No se pudo quitar.', 'error');
    }
  }

  get inventarioFiltrado(): any[] {
    const f = (this.filtro || '').toLowerCase().trim();
    if (!f) return this.inventario;

    return this.inventario.filter(p => {
      const part = String(p.part_number ?? '').toLowerCase();
      const name = String(p.product_name ?? p.nombre ?? '').toLowerCase();
      const cat  = String(p.category_name ?? '').toLowerCase();
      const brand= String(p.brand_name ?? '').toLowerCase();
      const supplier = String(p.default_supplier_name ?? '').toLowerCase();
      const price= String(p.price ?? '').toLowerCase();
      const stock= String(p.stock ?? '').toLowerCase();
      return (
        part.includes(f) ||
        name.includes(f) ||
        cat.includes(f) ||
        brand.includes(f) ||
        supplier.includes(f) ||
        price.includes(f) ||
        stock.includes(f)
      );
    });
  }

  /** Lo que buscó el usuario, ya pasado por los filtros de la barra. */
  get inventarioVisible(): any[] {
    return this.tabla.filtrar(this.inventarioFiltrado);
  }

  /**
   * Filas y cabeceras de grupo, en una sola lista plana. Se pagina esto y no
   * las filas sueltas: asi agrupar no rompe la paginacion ni la busqueda.
   */
  get itemsTabla(): WxItem[] {
    return this.tabla.aplanar(this.inventarioVisible);
  }

  get totalItems(): number { return this.itemsTabla.length; }

  get totalPages(): number {
    const t = Math.ceil(this.totalItems / this.pageSize);
    return Math.max(1, t);
  }

  get pageStartIndex(): number {
    return (this.page - 1) * this.pageSize;
  }

  get pageEndIndex(): number {
    return Math.min(this.pageStartIndex + this.pageSize, this.totalItems);
  }

  get inventarioPaginado(): WxItem[] {
    const start = this.pageStartIndex;
    return this.itemsTabla.slice(start, start + this.pageSize);
  }

  clearFilter() { this.filtro = ''; this.page = 1; }

  // ---- Exportar ----
  private cfgReporteInv(): ReportConfig {
    const rows = this.inventarioFiltrado.map((p: any) => {
      const precio = Number(p.price ?? 0);
      const stock = Number(p.stock ?? 0);
      return {
        part_number: p.part_number ?? '-',
        bar_code: p.bar_code ?? '-',
        nombre: p.product_name ?? p.nombre ?? '-',
        categoria: p.category_name ?? '-',
        marca: p.brand_name ?? '-',
        proveedor: p.default_supplier_name ?? '-',
        precio, stock, valor: precio * stock
      };
    });
    return {
      titulo: 'Inventario',
      subtitulo: 'Productos, stock y precios',
      columns: [
        { header: 'No. Parte', key: 'part_number', width: 16 },
        { header: 'Codigo barras', key: 'bar_code', width: 18 },
        { header: 'Producto', key: 'nombre', width: 30 },
        { header: 'Categoria', key: 'categoria', width: 16 },
        { header: 'Marca', key: 'marca', width: 16 },
        { header: 'Proveedor', key: 'proveedor', width: 18 },
        { header: 'Precio', key: 'precio', width: 14, align: 'right', money: true },
        { header: 'Stock', key: 'stock', width: 10, align: 'right' },
        { header: 'Valor', key: 'valor', width: 14, align: 'right', money: true }
      ],
      rows,
      totals: {
        stock: rows.reduce((a, r) => a + Number(r.stock || 0), 0),
        valor: rows.reduce((a, r) => a + Number(r.valor || 0), 0)
      },
      filename: 'inventario'
    };
  }

  /** Opciones del menu de exportacion. Constante: `wx-menu` compara por
      referencia y un getter crearia un arreglo nuevo en cada ciclo. */
  readonly opcionesExportar: WxMenuOpcion[] = [
    { valor: 'pdf',   etiqueta: 'PDF',   icono: 'ph ph-file-pdf' },
    { valor: 'excel', etiqueta: 'Excel', icono: 'ph ph-file-xls' },
  ];

  /**
   * Descriptor de la tabla: que columnas hay, cuales se pueden esconder y por
   * cuales tiene sentido filtrar o agrupar. La barra de herramientas y la
   * tabla leen de aqui; la logica vive en `EstadoTabla`, compartida.
   */
  readonly tabla = new EstadoTabla('inventario', [
    { clave: 'indice',    titulo: '#' },
    { clave: 'part_number', titulo: 'Código interno / SKU' },
    { clave: 'bar_code',  titulo: 'Código de barras', ocultaPorDefecto: true },
    // Sin el nombre, la tabla deja de identificar sus propias filas.
    { clave: 'product_name', titulo: 'Producto', obligatoria: true },
    { clave: 'price',     titulo: 'Precio' },
    { clave: 'stock',     titulo: 'Stock' },
    { clave: 'category_name', titulo: 'Categoría', filtrable: true, agrupable: true,
      valor: (f) => f.category_name || 'Sin categoría' },
    { clave: 'brand_name', titulo: 'Marca', filtrable: true, agrupable: true,
      valor: (f) => f.brand_name || 'Sin marca' },
    { clave: 'default_supplier_name', titulo: 'Proveedor (Default)', filtrable: true, agrupable: true,
      valor: (f) => f.default_supplier_name || 'Sin proveedor' },
    { clave: 'presentacion', titulo: 'Presentación de compra', ocultaPorDefecto: true,
      valor: (f) => f.default_presentation_name || '—' },
    // El tipo de inventario es lo que explica por que una receta no tiene
    // existencias propias: poder agrupar por el ahorra muchas preguntas.
    { clave: 'inventory_mode', titulo: 'Tipo', ocultaPorDefecto: true, filtrable: true, agrupable: true,
      valor: (f) => f.inventory_mode === 'RECIPE' ? 'Receta'
                  : f.inventory_mode === 'NONE' ? 'Sin inventario' : 'Directo' },
    { clave: 'acciones',  titulo: 'Acciones', obligatoria: true },
  ]);

  /** Un producto por receta no tiene existencias propias: su stock es 0. */
  esReceta(item: any): boolean {
    return (item?.inventory_mode ?? 'DIRECT') === 'RECIPE';
  }

  /**
   * Cuantas unidades alcanzan. Lo calcula SQL a partir de los ingredientes
   * -con conversion y merma-; si la columna no viniera, se cae al stock para
   * no inventar un cero.
   */
  disponibles(item: any): number {
    const n = Number(item?.available_units ?? item?.stock ?? 0);
    return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0;
  }

  async exportarInv(tipo: 'pdf' | 'excel') {
    this.expExportOpen = false;
    const cfg = this.cfgReporteInv();
    try {
      if (tipo === 'excel') await this.reports.exportExcel(cfg);
      else await this.reports.exportPdf(cfg);
    } catch (e: any) {
      await Swal.fire({ icon: 'error', title: 'Error al exportar', text: e?.message || 'No se pudo generar el archivo.' });
    }
  }
  onFilterChange() { this.page = 1; }

  onPageSizeChange(v: any) {
    const n = Number(v);
    this.pageSize = Number.isFinite(n) && n > 0 ? n : 10;
    this.page = 1;
  }

  prevPage() { if (this.page > 1) this.page--; }
  nextPage() { if (this.page < this.totalPages) this.page++; }

  goToPage(p: number) {
    const page = Math.max(1, Math.min(this.totalPages, p));
    this.page = page;
  }

  onPageClick(p: PageItem) {
    if (p === '...') return;
    this.goToPage(p);
  }

  get pagesToShow(): PageItem[] {
    const total = this.totalPages;
    const current = this.page;

    if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);

    const items: PageItem[] = [];
    const left = Math.max(2, current - 1);
    const right = Math.min(total - 1, current + 1);

    items.push(1);
    if (left > 2) items.push('...');
    for (let i = left; i <= right; i++) items.push(i);
    if (right < total - 1) items.push('...');
    items.push(total);

    return items;
  }

  abrirBrandModal() {
    this.newBrandName = '';
    this.brandModalAbierto = true;
    this.categoryModalAbierto = false;
  }

  cerrarBrandModal() {
    this.brandModalAbierto = false;
    this.newBrandName = '';
  }

  abrirCategoryModal() {
    this.newCategoryName = '';
    this.categoryModalAbierto = true;
    this.brandModalAbierto = false;
  }

  cerrarCategoryModal() {
    this.categoryModalAbierto = false;
    this.newCategoryName = '';
  }

  async crearBrandCatalogo() {
    const name = (this.newBrandName || '').trim();
    if (!name) {
      await Swal.fire('Falta nombre', 'Escribe el nombre de la marca.', 'warning');
      return;
    }

    try {
      this.creatingBrand = true;

      const res = await (window as any).electronAPI.createBrand({ name });
      if (!res?.success) throw new Error(res?.error || 'No se pudo crear la marca');

      await this.cargarMarcas();
      this.brandModalAbierto = false;

      await Swal.fire({
        icon: 'success',
        title: 'Marca creada',
        text: `"${name}" se agregó correctamente.`,
        timer: 1400,
        showConfirmButton: false
      });

      this.cerrarBrandModal();
    } catch (e: any) {
      console.error(e);
      await Swal.fire('Error', e?.message || 'No se pudo crear la marca.', 'error');
    } finally {
      this.creatingBrand = false;
    }
  }

  async crearCategoryCatalogo() {
    const name = (this.newCategoryName || '').trim();
    if (!name) {
      await Swal.fire('Falta nombre', 'Escribe el nombre de la categoría.', 'warning');
      return;
    }

    try {
      this.creatingCategory = true;

      const res = await (window as any).electronAPI.createCategory({ name });
      if (!res?.success) throw new Error(res?.error || 'No se pudo crear la categoría');

      await this.cargarCategorias();
      this.categoryModalAbierto = false;

      await Swal.fire({
        icon: 'success',
        title: 'Categoría creada',
        text: `"${name}" se agregó correctamente.`,
        timer: 1400,
        showConfirmButton: false
      });

      this.cerrarCategoryModal();
    } catch (e: any) {
      console.error(e);
      await Swal.fire('Error', e?.message || 'No se pudo crear la categoría.', 'error');
    } finally {
      this.creatingCategory = false;
    }
  }

  escanearCodigo() { this.capturandoCodigo = true; }
  cancelarEscaneo() { this.capturandoCodigo = false; }

  onClaveProdServ(item: CatalogoItem) {
    this.form.claveProdServ = item.code;
    this.form.claveProdServDesc = item.description;
  }

  onClaveUnidad(item: CatalogoItem) {
    this.form.claveUnidad = item.code;
    this.form.claveUnidadDesc = item.description;
  }

  get objetoImpuestoLabel(): string {
    const o = this.objetoImpuestoOpts.find(x => x.code === this.form.objetoImpuesto);
    return o ? `${o.code} - ${o.label}` : 'Selecciona';
  }

  get tasaIvaLabel(): string {
    const t = this.tasaIvaOpts.find(x => x.value === this.form.tasaIva);
    return t ? t.label : 'Selecciona';
  }
}
