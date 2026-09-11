/**
 * Estado compartido de una tabla: filtrar, agrupar y elegir columnas.
 *
 * POR QUE UNA CLASE Y NO UN COMPONENTE QUE PINTE LA TABLA
 * ------------------------------------------------------
 * Las tablas de Wybix no son iguales por dentro. Inventario, Compras y Ventas
 * usan `castrol-table`; Proveedores y Clientes usan `tabla-corte`, con otra
 * estructura y otras celdas. Reescribirlas todas para unificarlas seria mucho
 * riesgo por muy poca ganancia.
 *
 * Asi que lo compartido es el ESTADO y las DECISIONES -que columna se ve, que
 * filas pasan el filtro, en que orden y con que cabeceras de grupo-, y cada
 * pantalla sigue pintando sus propias celdas. La barra de herramientas
 * (`wx-tabla-barra`) lee y escribe este objeto; la tabla solo pregunta.
 *
 * COMO SE USA
 * -----------
 *     tabla = new EstadoTabla('inventario', [
 *       { clave: 'product_name', titulo: 'Producto', obligatoria: true },
 *       { clave: 'category_name', titulo: 'Categoria', filtrable: true, agrupable: true },
 *       ...
 *     ]);
 *
 *     <th *ngIf="tabla.esVisible('category_name')">Categoria</th>
 *     <ng-container *ngFor="let it of tabla.aplanar(filasDeLaPagina)">
 *
 * La configuracion se guarda en `localStorage` por tabla: quien esconde tres
 * columnas no quiere volver a esconderlas cada vez que entra.
 */

export interface WxColumna {
  /** Clave de la columna en la fila. Tambien es su identificador. */
  clave: string;
  titulo: string;
  /** No se puede ocultar. Sin esto se podria dejar la tabla en blanco. */
  obligatoria?: boolean;
  /** Nace oculta (columnas utiles pero secundarias). */
  ocultaPorDefecto?: boolean;
  /** Aparece en "Filtrar por". */
  filtrable?: boolean;
  /** Aparece en "Agrupar por". */
  agrupable?: boolean;
  /**
   * Valor legible de la celda, para filtrar y agrupar. Por defecto
   * `fila[clave]`. Sirve cuando la columna es calculada o compuesta.
   */
  valor?: (fila: any) => any;
}

/** Un renglon de lo que se pinta: o una cabecera de grupo, o una fila. */
export type WxItem =
  | { tipo: 'grupo'; clave: string; etiqueta: string; total: number; abierto: boolean }
  | { tipo: 'fila'; fila: any };

const SIN_VALOR = '—';

export class EstadoTabla {
  readonly columnas: WxColumna[];
  private readonly id: string;

  /** Columnas escondidas por el usuario. */
  private ocultas = new Set<string>();
  /** clave -> valores elegidos. Vacio = esa columna no filtra. */
  private filtros = new Map<string, Set<string>>();
  /** Columna por la que se agrupa, o null. */
  grupo: string | null = null;
  /** Grupos plegados. */
  private plegados = new Set<string>();

  constructor(id: string, columnas: WxColumna[]) {
    this.id = id;
    this.columnas = columnas;
    for (const c of columnas) if (c.ocultaPorDefecto && !c.obligatoria) this.ocultas.add(c.clave);
    this.restaurar();
  }

  // ----------------------------------------------------------- columnas
  esVisible(clave: string): boolean { return !this.ocultas.has(clave); }

  get visibles(): WxColumna[] { return this.columnas.filter(c => this.esVisible(c.clave)); }

  /** Se puede ocultar si no es obligatoria y no es la ultima que queda. */
  puedeOcultar(clave: string): boolean {
    const c = this.columnas.find(x => x.clave === clave);
    if (!c || c.obligatoria) return false;
    if (!this.esVisible(clave)) return true;      // mostrarla siempre se puede
    return this.visibles.length > 1;
  }

  alternarColumna(clave: string): void {
    if (this.ocultas.has(clave)) this.ocultas.delete(clave);
    else if (this.puedeOcultar(clave)) this.ocultas.add(clave);
    this.guardar();
  }

  mostrarTodasLasColumnas(): void { this.ocultas.clear(); this.guardar(); }

  get columnasOcultas(): number { return this.ocultas.size; }

  // ------------------------------------------------------------ filtros
  /** Valores distintos de una columna, con cuantas filas tiene cada uno. */
  opcionesDeFiltro(clave: string, filas: any[]): { valor: string; etiqueta: string; n: number }[] {
    const cuenta = new Map<string, number>();
    for (const f of filas) {
      const v = this.textoDe(clave, f);
      cuenta.set(v, (cuenta.get(v) ?? 0) + 1);
    }
    return [...cuenta.entries()]
      .map(([valor, n]) => ({ valor, etiqueta: valor, n }))
      .sort((a, b) => a.etiqueta.localeCompare(b.etiqueta, 'es'));
  }

  filtroActivo(clave: string, valor: string): boolean {
    return this.filtros.get(clave)?.has(valor) ?? false;
  }

  alternarFiltro(clave: string, valor: string): void {
    const set = this.filtros.get(clave) ?? new Set<string>();
    if (set.has(valor)) set.delete(valor); else set.add(valor);
    if (set.size) this.filtros.set(clave, set); else this.filtros.delete(clave);
    this.guardar();
  }

  limpiarFiltros(): void { this.filtros.clear(); this.guardar(); }

  get hayFiltros(): boolean { return this.filtros.size > 0; }

  /** Cuantos filtros hay puestos, para el contador de la barra. */
  get cuantosFiltros(): number {
    let n = 0;
    for (const s of this.filtros.values()) n += s.size;
    return n;
  }

  /** Aplica los filtros. La BUSQUEDA de texto la sigue haciendo la pantalla. */
  filtrar(filas: any[]): any[] {
    if (!this.filtros.size) return filas;
    return filas.filter(f => {
      for (const [clave, valores] of this.filtros) {
        if (!valores.has(this.textoDe(clave, f))) return false;
      }
      return true;
    });
  }

  // ------------------------------------------------------------- grupos
  get columnasAgrupables(): WxColumna[] { return this.columnas.filter(c => c.agrupable); }
  get columnasFiltrables(): WxColumna[] { return this.columnas.filter(c => c.filtrable); }

  agruparPor(clave: string | null): void {
    this.grupo = this.grupo === clave ? null : clave;
    this.plegados.clear();
    this.guardar();
  }

  get etiquetaGrupo(): string {
    const c = this.columnas.find(x => x.clave === this.grupo);
    return c ? c.titulo : '';
  }

  alternarGrupo(clave: string): void {
    if (this.plegados.has(clave)) this.plegados.delete(clave);
    else this.plegados.add(clave);
  }

  estaAbierto(clave: string): boolean { return !this.plegados.has(clave); }

  /**
   * Convierte las filas en lo que hay que pintar.
   *
   * Sin agrupacion devuelve las filas tal cual. Con agrupacion, las ordena por
   * grupo e intercala una cabecera por grupo. Un grupo plegado aporta su
   * cabecera y ninguna fila.
   *
   * Se devuelve una lista PLANA a proposito: asi la pantalla la puede paginar
   * con el mismo `slice` de siempre y la paginacion no se rompe.
   */
  aplanar(filas: any[]): WxItem[] {
    if (!this.grupo) return filas.map(fila => ({ tipo: 'fila', fila }) as WxItem);

    const porGrupo = new Map<string, any[]>();
    for (const f of filas) {
      const g = this.textoDe(this.grupo, f);
      if (!porGrupo.has(g)) porGrupo.set(g, []);
      porGrupo.get(g)!.push(f);
    }

    const salida: WxItem[] = [];
    for (const clave of [...porGrupo.keys()].sort((a, b) => a.localeCompare(b, 'es'))) {
      const filasDelGrupo = porGrupo.get(clave)!;
      const abierto = this.estaAbierto(clave);
      salida.push({ tipo: 'grupo', clave, etiqueta: clave, total: filasDelGrupo.length, abierto });
      if (abierto) for (const fila of filasDelGrupo) salida.push({ tipo: 'fila', fila });
    }
    return salida;
  }

  // -------------------------------------------------------------- apoyo
  /** El valor de una columna, como texto comparable. */
  private textoDe(clave: string, fila: any): string {
    const col = this.columnas.find(c => c.clave === clave);
    const v = col?.valor ? col.valor(fila) : fila?.[clave];
    if (v === null || v === undefined || v === '') return SIN_VALOR;
    return String(v);
  }

  // ------------------------------------------------- persistencia local
  /**
   * `localStorage` es por navegador y por equipo, que es exactamente el
   * alcance correcto: esconder una columna es una preferencia de quien esta
   * en esa caja, no del negocio. Todo va envuelto en try/catch porque puede
   * fallar (modo privado, almacenamiento bloqueado) y una preferencia perdida
   * no puede tumbar una pantalla.
   */
  private get llave(): string { return `wx-tabla:${this.id}`; }

  private guardar(): void {
    try {
      localStorage.setItem(this.llave, JSON.stringify({
        ocultas: [...this.ocultas],
        grupo: this.grupo,
        filtros: [...this.filtros].map(([k, v]) => [k, [...v]]),
      }));
    } catch { /* sin almacenamiento: la sesion sigue, sin recordar */ }
  }

  private restaurar(): void {
    try {
      const crudo = localStorage.getItem(this.llave);
      if (!crudo) return;
      const d = JSON.parse(crudo);
      // Se descarta cualquier clave que ya no exista: una columna retirada no
      // debe dejar un filtro fantasma que esconde filas sin explicacion.
      const validas = new Set(this.columnas.map(c => c.clave));
      if (Array.isArray(d.ocultas)) {
        this.ocultas = new Set(d.ocultas.filter((k: string) =>
          validas.has(k) && !this.columnas.find(c => c.clave === k)?.obligatoria));
      }
      this.grupo = validas.has(d.grupo) ? d.grupo : null;
      if (Array.isArray(d.filtros)) {
        this.filtros = new Map(
          d.filtros.filter(([k]: [string]) => validas.has(k))
                   .map(([k, v]: [string, string[]]) => [k, new Set(v)]));
      }
    } catch { /* preferencia ilegible: se empieza limpio */ }
  }
}
