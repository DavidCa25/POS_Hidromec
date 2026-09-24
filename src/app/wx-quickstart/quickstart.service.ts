import { Injectable, computed, inject, signal } from '@angular/core';
import { GuiaService } from '../wx-guia/guia.service';

/**
 * EL ESTADO DE LAS CARGAS, EN UN SOLO SITIO.
 *
 * La pantalla no guarda nada: todo lo que se ve sale de aqui, y todo lo que
 * hay aqui sale de la base. Una carga a medias sobrevive a cerrar Wybix
 * porque nunca vivio en memoria.
 */

export type EstadoCarga = 'CAPTURANDO' | 'ANALIZANDO' | 'REVISION' | 'LISTA' | 'IMPORTADA' | 'DESCARTADA';

export interface Carga {
  id: number;
  origen: string;
  etiqueta: string;
  estado: EstadoCarga;
  preset: string | null;
  total_filas: number;
  creadas: number;
  actualizadas: number;
  pendientes: number;
  listas: number;
  usuario: string | null;
  created_at: string;
  completed_at: string | null;
}

export interface FilaCarga {
  id: number;
  fila: number;
  tipo: string;
  nombre: string | null;
  part_number: string | null;
  bar_code: string | null;
  price: number | null;
  cost: number | null;
  stock: number | null;
  category_name: string | null;
  brand_name: string | null;
  accion: string;
  match_product_id: number | null;
  match_motivo: string | null;
  problemas_json: string | null;
  aplicada: boolean;
}

/**
 * LAS COLUMNAS QUE AYUDAN A VALIDAR CADA COSA.
 *
 * La tabla de revisión era fija —Producto, Código, Costo, Precio,
 * Existencia— y eso es una tabla de tienda. Con ella, revisar una hoja de
 * ingredientes no enseñaba la UNIDAD (¿5000 qué? ¿gramos? ¿mililitros?) y
 * revisar cualquier cosa no enseñaba la CATEGORÍA, que el mapeo sí había
 * reconocido.
 *
 * Sale del mismo sitio que la semántica del backend: `semantica.js` declara
 * qué columnas importan para cada entidad, y aquí se pintan.
 */
export const COLUMNAS: Record<string, { campo: string; titulo: string; der?: boolean; num?: string }[]> = {
  PRODUCTO: [
    { campo: 'nombre', titulo: 'Producto' },
    { campo: 'part_number', titulo: 'Código' },
    { campo: 'category_name', titulo: 'Categoría' },
    { campo: 'brand_name', titulo: 'Marca' },
    { campo: 'cost', titulo: 'Costo', der: true, num: '1.2-2' },
    { campo: 'price', titulo: 'Precio', der: true, num: '1.2-2' },
    { campo: 'stock', titulo: 'Existencia', der: true, num: '1.0-2' },
  ],
  MATERIAL: [
    { campo: 'nombre', titulo: 'Nombre' },
    { campo: 'part_number', titulo: 'Código' },
    { campo: 'category_name', titulo: 'Categoría' },
    { campo: 'cost', titulo: 'Costo', der: true, num: '1.2-2' },
    { campo: 'price', titulo: 'Precio', der: true, num: '1.2-2' },
    { campo: 'stock', titulo: 'Existencia', der: true, num: '1.0-2' },
  ],
  /* Un ingrediente no tiene precio de venta y SÍ tiene unidad: sin ella,
     «5000» no dice nada. */
  INGREDIENTE: [
    { campo: 'nombre', titulo: 'Ingrediente' },
    { campo: 'part_number', titulo: 'Código' },
    { campo: 'category_name', titulo: 'Categoría' },
    { campo: 'cost', titulo: 'Costo', der: true, num: '1.2-2' },
    { campo: 'stock', titulo: 'Existencia', der: true, num: '1.0-2' },
    { campo: 'base_uom', titulo: 'Unidad' },
  ],
  /* Un producto de menú no tiene existencia propia: enseñarla sería mentir. */
  MENU: [
    { campo: 'nombre', titulo: 'Producto de menú' },
    { campo: 'part_number', titulo: 'Código' },
    { campo: 'category_name', titulo: 'Categoría' },
    { campo: 'cost', titulo: 'Costo', der: true, num: '1.2-2' },
    { campo: 'price', titulo: 'Precio', der: true, num: '1.2-2' },
  ],
  SERVICIO: [
    { campo: 'nombre', titulo: 'Servicio' },
    { campo: 'part_number', titulo: 'Código' },
    { campo: 'category_name', titulo: 'Categoría' },
    { campo: 'price', titulo: 'Precio', der: true, num: '1.2-2' },
    { campo: 'duration_minutes', titulo: 'Duración', der: true, num: '1.0-0' },
    { campo: 'default_commission_pct', titulo: 'Comisión %', der: true, num: '1.0-2' },
  ],
};

/** Cómo se llama cada tipo en pantalla. */
export const NOMBRE_TIPO: Record<string, string> = {
  PRODUCTO: 'Productos',
  MATERIAL: 'Materiales',
  INGREDIENTE: 'Ingredientes',
  MENU: 'Productos de menú',
  SERVICIO: 'Servicios',
};

/**
 * QUÉ SE PUEDE HACER CON CADA CONFLICTO.
 *
 * En QA, «1 que se parece a algo que ya tienes» se podía ver pero no
 * resolver: la carga quedaba atrapada con un pendiente que no tenía botón.
 * Detectar un conflicto sin ofrecer salida es peor que no detectarlo.
 */
export const ACCIONES_CONFLICTO: Record<string, { texto: string; resolucion: string; fuerte?: boolean }[]> = {
  POSIBLE_DUPLICADO: [
    { texto: 'Es el mismo: actualizar', resolucion: 'ACTUALIZAR', fuerte: true },
    { texto: 'Es otro: crear aparte', resolucion: 'CREAR_OTRO' },
    { texto: 'Dejarlo fuera', resolucion: 'IGNORAR' },
  ],
  CODIGO_OTRO_NOMBRE: [
    { texto: 'Actualizar el que tengo', resolucion: 'ACTUALIZAR', fuerte: true },
    { texto: 'Crear uno nuevo', resolucion: 'CREAR_OTRO' },
    { texto: 'Dejarlo fuera', resolucion: 'IGNORAR' },
  ],
  DUP_ARCHIVO_SKU: [
    { texto: 'Dejar fuera la repetida', resolucion: 'IGNORAR', fuerte: true },
    { texto: 'Crearla igual', resolucion: 'CREAR_OTRO' },
  ],
  DUP_ARCHIVO_BARRAS: [
    { texto: 'Dejar fuera la repetida', resolucion: 'IGNORAR', fuerte: true },
    { texto: 'Crearla igual', resolucion: 'CREAR_OTRO' },
  ],
};

export interface Problema { codigo: string; campo: string; texto: string; gravedad: string; }
export interface Grupo { codigo: string; cuantos: number; }

/** Como se llama y que se ofrece para cada clase de problema. */
export const GRUPOS: Record<string, { titulo: string; explica: string; accion?: string; resolucion?: string; pide?: 'texto' | 'numero'; tono: string }> = {
  SIN_PRECIO:        { titulo: 'sin precio de venta', explica: 'Entran igual, pero no se podrán cobrar hasta que lo tengan.', accion: 'Ponerles precio', resolucion: 'PONER_VALOR', pide: 'numero', tono: 'peligro' },
  SIN_NOMBRE:        { titulo: 'sin nombre', explica: 'Sin nombre no hay producto. Estas se quedan fuera.', accion: 'Dejarlas fuera', resolucion: 'IGNORAR', tono: 'peligro' },
  NOMBRE_LARGO:      { titulo: 'con el nombre muy largo', explica: 'Wybix guarda hasta 100 caracteres.', accion: 'Recortar a 100', resolucion: 'IGNORAR', tono: 'peligro' },
  SIN_UNIDAD:        { titulo: 'sin unidad de medida', explica: 'Sin unidad no se pueden usar en una receta: «200» no dice si son ml o g.', accion: 'Poner unidad', resolucion: 'ASIGNAR', pide: 'texto', tono: 'peligro' },
  SIN_CATEGORIA:     { titulo: 'sin categoría', explica: 'Sin categoría no aparecen en la pantalla de venta.', accion: 'Asignar categoría', resolucion: 'ASIGNAR', pide: 'texto', tono: 'aviso' },
  CODIGO_OTRO_NOMBRE:{ titulo: 'con un código que ya tiene otro producto', explica: 'Estas no las decido yo: mira cada una.', tono: 'aviso' },
  POSIBLE_DUPLICADO: { titulo: 'que se parecen a algo que ya tienes', explica: 'Solo coincide el nombre, así que puede ser otro producto.', tono: 'aviso' },
  DUP_ARCHIVO_SKU:   { titulo: 'con el código repetido en el archivo', explica: 'El mismo código aparece dos veces.', accion: 'Dejar la primera', resolucion: 'IGNORAR', tono: 'aviso' },
  DUP_ARCHIVO_BARRAS:{ titulo: 'con el código de barras repetido', explica: 'El mismo código de barras aparece dos veces.', accion: 'Dejar la primera', resolucion: 'IGNORAR', tono: 'aviso' },
  UNIDAD_DESCONOCIDA:{ titulo: 'con una unidad que no existe', explica: 'Wybix no conoce esa unidad de medida.', accion: 'Usar «pza»', resolucion: 'ASIGNAR', tono: 'aviso' },
  PRECIO_NEGATIVO:   { titulo: 'con el precio en negativo', explica: 'Un precio negativo casi siempre es un error de captura.', tono: 'peligro' },
  STOCK_NEGATIVO:    { titulo: 'con existencia negativa', explica: 'Revisa si el archivo trae devoluciones mezcladas.', tono: 'aviso' },
  COSTO_NEGATIVO:    { titulo: 'con el costo en negativo', explica: 'Revisa esas filas antes de importar.', tono: 'aviso' },
  CODIGO_LARGO:      { titulo: 'con el código muy largo', explica: 'Wybix guarda hasta 100 caracteres de código.', tono: 'peligro' },
  BARRAS_LARGO:      { titulo: 'con el código de barras muy largo', explica: 'Wybix guarda hasta 50 caracteres.', tono: 'peligro' },
};

@Injectable({ providedIn: 'root' })
export class QuickstartService {
  private get api(): any { return (window as any).electronAPI; }
  private readonly guia = inject(GuiaService);

  /** La cara de Wybix en esta sesión. La decide la Guía, una sola vez. */
  readonly variante = computed(() => this.guia.variante());

  readonly cargas = signal<Carga[]>([]);
  readonly activa = signal<Carga | null>(null);
  readonly filas = signal<FilaCarga[]>([]);
  readonly grupos = signal<Grupo[]>([]);
  /** Qué tipos trae la carga abierta. Decide las columnas de la revisión. */
  readonly tipos = signal<{ tipo: string; cuantos: number }[]>([]);
  readonly resumen = signal<Record<string, number>>({});
  readonly contexto = signal<any>({ servicios: false, hospitality: false, preset: null, material: null, uoms: [] });
  readonly ocupado = signal(false);
  readonly avance = signal<{ procesadas: number; creadas: number; actualizadas: number; total: number } | null>(null);

  /** Cuántas cargas están vivas: lo que decide si el dock enseña un aviso. */
  readonly vivas = computed(() => this.cargas().filter(c => c.estado !== 'IMPORTADA').length);

  /** El vocabulario del giro. «Refacción» en un taller, «Producto» en una tienda. */
  readonly material = computed(() => this.contexto()?.material?.singular ?? 'Producto');
  readonly materiales = computed(() => this.contexto()?.material?.plural ?? 'Productos');

  private soltarAvance: (() => void) | null = null;

  async cargarContexto() {
    const r = await this.api?.qsContexto?.();
    if (r?.success) this.contexto.set(r.data);
  }

  async listar() {
    const r = await this.api?.qsCargas?.({});
    if (r?.success) this.cargas.set(r.data ?? []);
  }

  /** Abre una carga: su resumen, sus grupos de problemas y sus filas. */
  async abrir(batchId: number, filtro = 'TODAS') {
    const r = await this.api?.qsCarga?.({ batchId });
    if (r?.success) {
      const [batch, totales, grupos, tipos] = r.sets ?? [];
      this.activa.set(batch?.[0] ?? null);
      this.resumen.set(totales?.[0] ?? {});
      this.grupos.set((grupos ?? []).filter((g: Grupo) => !!GRUPOS[g.codigo]));
      this.tipos.set(tipos ?? []);
    }
    await this.verFilas(batchId, filtro);
  }

  async verFilas(batchId: number, filtro = 'TODAS', desde = 0, tope = 200) {
    const r = await this.api?.qsFilas?.({ batchId, filtro, desde, tope });
    if (r?.success) this.filas.set(r.data ?? []);
  }

  async analizarArchivo(ruta: string, hoja?: string, mapping?: any[]) {
    this.ocupado.set(true);
    try { return await this.api?.qsAnalizarArchivo?.({ ruta, hoja, mapping }); }
    finally { this.ocupado.set(false); }
  }

  async analizarPegado(texto: string, mapping?: any[]) {
    this.ocupado.set(true);
    try { return await this.api?.qsAnalizarPegado?.({ texto, mapping }); }
    finally { this.ocupado.set(false); }
  }

  async remapear(batchId: number, mapping: any[]) {
    this.ocupado.set(true);
    try { return await this.api?.qsRemapear?.({ batchId, mapping }); }
    finally { this.ocupado.set(false); }
  }

  async cargaManual(lector = false) { return this.api?.qsCargaManual?.({ lector }); }

  async capturar(batchId: number, p: any) { return this.api?.qsCapturar?.({ batchId, ...p }); }

  async resolverGrupo(batchId: number, codigo: string, resolucion: string, valor?: string) {
    const r = await this.api?.qsResolverGrupo?.({ batchId, codigo, resolucion, valor });
    if (r?.success) await this.abrir(batchId);
    return r;
  }

  async resolverFila(rowId: number, resolucion: string, campo?: string, valor?: string) {
    return this.api?.qsResolverFila?.({ rowId, resolucion, campo, valor });
  }

  /**
   * Confirma la importación.
   *
   * El avance llega por eventos desde el proceso principal, no preguntando
   * cada tanto: preguntar da una barra que va a saltos y encima ocupa el
   * hilo que está haciendo el trabajo.
   */
  async ejecutar(batchId: number) {
    this.ocupado.set(true);
    this.avance.set({ procesadas: 0, creadas: 0, actualizadas: 0, total: this.porImportar() });
    this.soltarAvance = this.api?.qsAlAvanzar?.((d: any) => this.avance.set(d)) ?? null;
    try {
      const r = await this.api?.qsEjecutar?.({ batchId });
      await this.listar();
      await this.abrir(batchId);
      return r;
    } finally {
      this.ocupado.set(false);
      this.soltarAvance?.();
      this.soltarAvance = null;
    }
  }

  async undoCheck(batchId: number) { return this.api?.qsUndoCheck?.({ batchId }); }

  async undo(batchId: number) {
    const r = await this.api?.qsUndo?.({ batchId });
    if (r?.success) { await this.listar(); await this.abrir(batchId); }
    return r;
  }

  /**
   * Suelta una carga de captura si está vacía.
   *
   * Lo llama la pantalla al salir. Con filas dentro no hace nada, así que se
   * puede invocar sin comprobar antes: la regla vive en SQL, en un solo sitio.
   */
  async soltarSiVacia(batchId: number) {
    const r = await this.api?.qsSoltarSiVacia?.({ batchId });
    if (r?.success) { this.activa.set(null); await this.listar(); }
    return r;
  }

  async descartar(batchId: number) {
    const r = await this.api?.qsDescartar?.({ batchId });
    if (r?.success) { this.activa.set(null); await this.listar(); }
    return r;
  }

  async plantilla() { return this.api?.qsPlantilla?.({}); }

  async guardarPerfil(nombre: string, huella: string, mapping: any[]) {
    return this.api?.qsGuardarPerfil?.({ nombre, huella, mapping });
  }

  /**
   * Cuántas filas quedan POR importar.
   *
   * `crear` y `actualizar` ya vienen contando solo las no aplicadas —lo
   * decide `sp_import_batch_summary`—, así que el botón no puede volver a
   * ofrecer las nueve que ya entraron, que es lo que pasaba en QA.
   */
  readonly porImportar = computed(() =>
    Number(this.resumen()['crear'] ?? 0) + Number(this.resumen()['actualizar'] ?? 0));

  /** Cuántas entraron ya. */
  readonly yaImportadas = computed(() => Number(this.resumen()['aplicadas'] ?? 0));

  /**
   * Cuántas siguen esperando una decisión.
   *
   * CONFLICT **y** PENDIENTE, que es exactamente lo que devuelve el filtro
   * `PENDIENTES`. La cabecera decía «12 por resolver» y el chip «Por revisar
   * 0» sobre las mismas doce filas, porque el chip contaba sólo los
   * conflictos. Un número que no cuadra con el de al lado no es un detalle:
   * es la pantalla contradiciéndose delante de quien la está leyendo.
   */
  readonly porResolver = computed(() =>
    Number(this.resumen()['conflicto'] ?? 0) + Number(this.resumen()['pendiente'] ?? 0));

  /** Las columnas con las que se revisa esta carga. */
  readonly columnas = computed(() => {
    const ts = this.tipos();
    const principal = ts.length ? ts[0].tipo : 'PRODUCTO';
    return COLUMNAS[principal] ?? COLUMNAS['PRODUCTO'];
  });

  /** Cargar otra hoja del mismo archivo. */
  async otraHoja(batchId: number, hoja: string) {
    this.ocupado.set(true);
    try { return await this.api?.qsOtraHoja?.({ batchId, hoja }); }
    finally { this.ocupado.set(false); }
  }

  /** Los problemas de una fila, ya parseados. */
  problemasDe(f: FilaCarga): Problema[] {
    try { return JSON.parse(f.problemas_json || '[]'); } catch { return []; }
  }
}
