import { ChangeDetectionStrategy, Component, HostListener, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import Swal from 'sweetalert2';
import { WxMascotaComponent } from '../wx-mascota/wx-mascota.component';
import { WxCargandoComponent } from '../wx-cargando/wx-cargando.component';
import { WxSelectComponent, WxOpcion } from '../wx-select/wx-select.component';
import { QuickstartService, Carga, FilaCarga, GRUPOS, COLUMNAS, NOMBRE_TIPO, ACCIONES_CONFLICTO } from './quickstart.service';

/**
 * WYBIX QUICKSTART — el muelle de carga.
 *
 * Una carga es un OBJETO con estado, no un asistente que se abre y se cierra.
 * Por eso la pantalla tiene riel a la izquierda —lo que hay— y area de
 * trabajo a la derecha —lo que estoy mirando—, y por eso se puede cerrar a
 * media captura sin perder nada.
 *
 * LO QUE ESTA PANTALLA NO HACE
 * ----------------------------
 * No escribe en el catalogo. Resolver un grupo de problemas cambia el
 * almacen intermedio; el catalogo se toca al confirmar, y lo hace SQL. Esa
 * separacion es lo que permite decir «nada ha tocado tu catalogo todavia» y
 * que sea verdad.
 */
@Component({
  selector: 'wx-quickstart',
  standalone: true,
  imports: [CommonModule, FormsModule, WxMascotaComponent, WxCargandoComponent, WxSelectComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './wx-quickstart.component.html',
  styleUrls: ['./wx-quickstart.component.css'],
})
export class WxQuickstartComponent implements OnInit {
  readonly qs = inject(QuickstartService);
  private readonly router = inject(Router);

  /** vacio | mapeo | revision | captura | listo */
  readonly vista = signal<'vacio' | 'hojas' | 'mapeo' | 'revision' | 'captura' | 'listo'>('vacio');
  readonly arrastrando = signal(false);
  readonly filtro = signal<'TODAS' | 'LISTAS' | 'PENDIENTES'>('TODAS');

  /** El mapeo que se está revisando, con sus dudas. */
  readonly propuesta = signal<any>(null);
  readonly perfilReconocido = signal<{ nombre: string; veces: number } | null>(null);

  /* La hoja que se está usando y las demás del libro. Sin esto, equivocarse
     de hoja obligaba a empezar desde el archivo otra vez. */
  readonly hojaEnUso = signal<string | null>(null);
  readonly hojasDelLibro = signal<any[]>([]);
  /** La ruta del último archivo, para poder cambiar de hoja sin re-elegirlo. */
  private rutaActual: string | null = null;

  /* El libro que se está mirando, partido en lo que parece datos y lo que no. */
  readonly hojasDatos = computed(() => this.hojasDelLibro().filter(h => h.esDatos));
  readonly hojasOtras = computed(() => this.hojasDelLibro().filter(h => !h.esDatos));

  /** La fila cuyo conflicto se está resolviendo. */
  readonly filaEnFoco = signal<FilaCarga | null>(null);

  /** Las opciones de categoría para resolver un grupo, sin `select` nativo. */
  readonly opcCategorias = computed<WxOpcion[]>(() =>
    ['General', 'Bebidas', 'Alimentos', 'Botanas', 'Abarrotes', 'Servicios']
      .map(c => ({ valor: c, etiqueta: c })));

  readonly opcUnidades = computed<WxOpcion[]>(() =>
    (this.qs.contexto()?.uoms ?? []).map((u: any) => ({
      valor: u.code, etiqueta: u.code, nota: u.name,
    })));

  /** Lo que se escribe en el grupo que pide un valor. */
  readonly valorGrupo = signal<Record<string, string>>({});

  /* -------------------------------------------------- captura de libreta */
  readonly capturaNombre = signal('');
  readonly capturaPrecio = signal('');
  readonly capturaStock = signal('');
  readonly capturaCodigo = signal('');
  readonly capturados = signal<FilaCarga[]>([]);
  readonly ultimoId = signal<number | null>(null);
  /** El atajo se enseña UNA vez, cuando ya hay ritmo, y se va solo. */
  readonly tipAtajo = computed(() => this.capturados().length === 2 && !this.tipVisto());
  private readonly tipVisto = signal(false);

  readonly gruposUI = computed(() =>
    this.qs.grupos().map(g => ({ ...g, ...(GRUPOS[g.codigo] ?? { titulo: g.codigo, explica: '', tono: 'aviso' }) })));

  readonly hayCatalogo = signal(false);

  async ngOnInit() {
    await this.qs.cargarContexto();
    await this.qs.listar();
    const viva = this.qs.cargas().find(c => c.estado !== 'IMPORTADA');
    if (viva) await this.elegir(viva);
  }

  // ==================================================================
  //  EL RIEL
  // ==================================================================
  async elegir(c: Carga) {
    await this.qs.abrir(c.id, this.filtro());
    if (c.origen === 'MANUAL' || c.origen === 'LECTOR') {
      this.capturados.set(this.qs.filas());
      this.vista.set('captura');
    } else if (c.estado === 'IMPORTADA') {
      this.vista.set('listo');
    } else {
      this.vista.set('revision');
    }
  }

  async cambiarFiltro(f: 'TODAS' | 'LISTAS' | 'PENDIENTES') {
    this.filtro.set(f);
    const a = this.qs.activa();
    if (a) await this.qs.verFilas(a.id, f);
  }

  selloDe(estado: string) {
    return {
      /* Una carga de captura sin filas NO está analizando nada. Decir que el
         sistema trabaja cuando no trabaja enseña a desconfiar del resto. */
      CAPTURANDO: { t: 'Capturando', c: 'es-capturando', gira: false },
      ANALIZANDO: { t: 'Analizando', c: 'es-analizando', gira: true },
      REVISION:   { t: 'Necesita revisión', c: 'es-revision', gira: false },
      LISTA:      { t: 'Lista', c: 'es-lista', gira: false },
      IMPORTADA:  { t: 'Importada', c: 'es-importada', gira: false },
    }[estado] ?? { t: estado, c: '', gira: false };
  }

  // ==================================================================
  //  ENTRADAS
  // ==================================================================
  @HostListener('dragover', ['$event'])
  alArrastrar(e: DragEvent) { e.preventDefault(); this.arrastrando.set(true); }

  @HostListener('dragleave', ['$event'])
  alSalir(e: DragEvent) {
    /* Solo cuando el puntero sale de la ventana de verdad: `dragleave` salta
       tambien al pasar por encima de cada hijo, y sin esto el pozo parpadea. */
    if (e.relatedTarget === null) this.arrastrando.set(false);
  }

  @HostListener('drop', ['$event'])
  async alSoltar(e: DragEvent) {
    e.preventDefault();
    this.arrastrando.set(false);
    const file = e.dataTransfer?.files?.[0];
    if (file) await this.conArchivo(file);
  }

  async alElegirArchivo(ev: Event) {
    const input = ev.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (file) await this.conArchivo(file);
  }

  private async conArchivo(file: File) {
    const api: any = (window as any).electronAPI;
    const ruta = api?.qsRutaDeArchivo?.(file) || '';
    if (!ruta) {
      await Swal.fire({ icon: 'error', title: 'No pude leer el archivo',
        text: 'Wybix no pudo obtener la ruta. Prueba a elegirlo con el botón.' });
      return;
    }
    this.rutaActual = ruta;
    const r = await this.qs.analizarArchivo(ruta);
    await this.trasAnalizar(r, ruta);
  }

  /** Pegar desde Excel o Sheets. Llega como TSV en el portapapeles. */
  @HostListener('document:paste', ['$event'])
  async alPegar(e: ClipboardEvent) {
    if (this.vista() === 'captura') return;          // ahí se pega en un campo
    const texto = e.clipboardData?.getData('text/plain') || '';
    if (!texto.includes('\n') && !texto.includes('\t')) return;
    e.preventDefault();
    const r = await this.qs.analizarPegado(texto);
    await this.trasAnalizar(r);
  }

  private async trasAnalizar(r: any, ruta?: string): Promise<void> {
    if (!r?.success) {
      /* Un archivo que no se puede leer NO puede dejar a nadie encerrado ni
         con la pantalla a medias: se avisa y se vuelve a las opciones, desde
         donde se puede elegir otro archivo u otro método. */
      await Swal.fire({
        icon: 'error',
        title: 'No pude leer ese archivo',
        text: r?.error || 'Revisa que sea un Excel o un CSV válido e inténtalo de nuevo.',
        confirmButtonText: 'Elegir otro',
      });
      this.rutaActual = null;
      this.vista.set('vacio');
      return;
    }
    if (r.data?.necesitaHoja) {
      /* El libro tiene más de una hoja con datos. Se enseñan CLASIFICADAS en
         una superficie de Wybix, no en un `<select>` del sistema operativo
         dentro de un modal: ahí no cabe decir cuál parece datos y cuál son
         notas, que es justo lo que ayuda a elegir. */
      this.hojasDelLibro.set(r.data.hojas ?? []);
      this.rutaActual = ruta ?? null;
      this.vista.set('hojas');
      return;
    }

    this.propuesta.set(r.data.propuesta);
    this.perfilReconocido.set(r.data.perfil);
    this.hojaEnUso.set(r.data.hoja ?? null);
    this.hojasDelLibro.set(r.data.hojas ?? []);
    await this.qs.listar();
    await this.qs.abrir(r.data.batchId);

    /* Si reconocí el formato o no quedó ninguna duda, el mapeo no se
       pregunta: se enseña en la revisión y se puede cambiar desde ahí. */
    this.vista.set(r.data.perfil || r.data.propuesta.dudas === 0 ? 'revision' : 'mapeo');
  }

  /** Elegir una hoja del libro que se está mirando. */
  async usarHoja(nombre: string) {
    if (!this.rutaActual) return;
    const r = await this.qs.analizarArchivo(this.rutaActual, nombre);
    await this.trasAnalizar(r, this.rutaActual);
  }

  /**
   * Cargar OTRA hoja del mismo archivo, después de haber cargado una.
   *
   * En QA hubo que subir el mismo XLSX dos veces para «Insumos» y «Menú».
   * El archivo ya se conoce: su ruta viaja con la carga.
   */
  async cargarOtraHoja(nombre: string) {
    const a = this.qs.activa();
    if (!a) return;
    const r = await this.qs.otraHoja(a.id, nombre);
    if (!r?.success) {
      await Swal.fire({ icon: 'error', title: 'No pude abrir esa hoja', text: r?.error ?? '' });
      return;
    }
    await this.qs.listar();
    await this.qs.abrir(r.data.batchId);
    this.hojaEnUso.set(r.data.hoja ?? nombre);
    this.hojasDelLibro.set(r.data.hojas ?? this.hojasDelLibro());
    this.vista.set('revision');
  }

  /** Las hojas del libro que TODAVÍA no se han cargado. */
  readonly hojasPendientes = computed(() => {
    const usada = this.hojaEnUso();
    return this.hojasDatos().filter(h => h.nombre !== usada);
  });

  nombreTipo(t: string) { return NOMBRE_TIPO[t] ?? t; }

  /** Las columnas con las que se revisa lo que hay delante. */
  readonly columnasVista = computed(() => this.qs.columnas());

  /** Cambiar de hoja sin volver a elegir el archivo. */
  /** Volver a la lista de hojas del libro. */
  cambiarHoja() {
    if (!this.rutaActual || this.hojasDelLibro().length < 2) return;
    this.vista.set('hojas');
  }

  // ==================================================================
  //  NAVEGACIÓN: nadie queda atrapado
  // ==================================================================

  /**
   * Volver a elegir método.
   *
   * Está en TODAS las vistas de una carga activa. Cambiar de opinión tiene
   * que costar un clic: si entrar por el lector encerrara al usuario, la
   * primera decisión pesaría más de lo que debe.
   *
   * Lo capturado NO se pierde: la carga sigue en el riel. Solo se suelta si
   * está vacía, y de eso decide SQL, no esta pantalla.
   */
  async volverAOpciones() {
    const a = this.qs.activa();
    if (a && (a.origen === 'MANUAL' || a.origen === 'LECTOR')) {
      await this.qs.soltarSiVacia(a.id);
    }
    this.propuesta.set(null);
    this.hojaEnUso.set(null);
    this.hojasDelLibro.set([]);
    this.rutaActual = null;
    await this.qs.listar();
    this.vista.set('vacio');
  }

  /**
   * Terminar la captura.
   *
   * «Terminar» significaba a la vez abandonar, guardar, volver e importar.
   * Ahora significa una sola cosa: dejar de escribir y pasar a revisar lo
   * escrito. Guardar ya pasó —cada Enter guarda— e importar es otro botón.
   */
  async terminarCaptura() {
    const a = this.qs.activa();
    if (!a) { this.vista.set('vacio'); return; }
    if (!this.capturados().length) { await this.volverAOpciones(); return; }
    await this.qs.abrir(a.id);
    this.vista.set('revision');
  }

  // ==================================================================
  //  MAPEO
  // ==================================================================
  async resolverColumna(indice: number, campo: string | null) {
    const p = this.propuesta();
    if (!p) return;
    const cols = p.columnas.map((c: any) =>
      c.indice === indice ? { ...c, campo, confianza: 'exacto' } : c);
    this.propuesta.set({ ...p, columnas: cols, dudas: cols.filter((c: any) => c.confianza === 'ambiguo').length });

    const a = this.qs.activa();
    if (a) { await this.qs.remapear(a.id, cols); await this.qs.abrir(a.id); }
    if (this.propuesta().dudas === 0) this.vista.set('revision');
  }

  etiquetaCampo(campo: string | null) {
    return campo ? ({
      nombre: 'Nombre', part_number: 'Código interno', bar_code: 'Código de barras',
      price: 'Precio de venta', cost: 'Costo', stock: 'Existencia',
      category_name: 'Categoría', brand_name: 'Marca', base_uom: 'Unidad',
      duration_minutes: 'Duración', default_commission_pct: 'Comisión %', tipo: 'Tipo',
    } as any)[campo] ?? campo : 'Sin usar';
  }

  async guardarPerfil() {
    const p = this.propuesta();
    if (!p) return;
    const { value } = await Swal.fire({
      title: '¿Cómo llamo a este formato?',
      input: 'text', inputPlaceholder: 'Lista Gonher',
      showCancelButton: true, confirmButtonText: 'Guardar',
    });
    if (!value) return;
    await this.qs.guardarPerfil(value, p.huella, p.columnas);
    await Swal.fire({ icon: 'success', title: 'Lo reconoceré la próxima vez',
      timer: 1400, showConfirmButton: false });
  }

  // ==================================================================
  //  RESOLVER
  // ==================================================================
  async resolver(g: any) {
    const a = this.qs.activa();
    if (!a || !g.resolucion) return;
    let valor = this.valorGrupo()[g.codigo] || '';
    if (g.codigo === 'SIN_CATEGORIA' && !valor) valor = 'General';
    if (g.codigo === 'UNIDAD_DESCONOCIDA') valor = 'pza';
    if (g.pide && !valor) return;
    await this.qs.resolverGrupo(a.id, g.codigo, g.resolucion, valor);
  }

  ponerValor(codigo: string, v: string) {
    this.valorGrupo.set({ ...this.valorGrupo(), [codigo]: v });
  }

  /** Las acciones que ofrece el conflicto de una fila. */
  accionesDe(f: FilaCarga) {
    for (const pr of this.qs.problemasDe(f)) {
      if (ACCIONES_CONFLICTO[pr.codigo]) return ACCIONES_CONFLICTO[pr.codigo];
    }
    /* Cualquier otro conflicto tiene al menos una salida: dejarlo fuera.
       Detectar algo y no ofrecer camino deja la carga atrapada. */
    return [{ texto: 'Dejarlo fuera', resolucion: 'IGNORAR', fuerte: false }];
  }

  /** Lo que dice el conflicto, para poder decidir. */
  motivoDe(f: FilaCarga): string {
    const ps = this.qs.problemasDe(f);
    return ps.length ? ps.map(p => p.texto).join(' ') : 'Necesita una decisión.';
  }

  abrirFila(f: FilaCarga) {
    this.filaEnFoco.set(this.filaEnFoco()?.id === f.id ? null : f);
  }

  async resolverFila(f: FilaCarga, resolucion: string) {
    const a = this.qs.activa();
    if (!a) return;
    const r = await this.qs.resolverFila(f.id, resolucion);
    if (!r?.success) {
      await Swal.fire({ icon: 'error', title: 'No se pudo resolver', text: r?.error ?? '' });
      return;
    }
    this.filaEnFoco.set(null);
    await this.qs.abrir(a.id, this.filtro());
  }

  valorDe(f: any, campo: string) { return f?.[campo]; }

  // ==================================================================
  //  CONFIRMAR Y DESHACER
  // ==================================================================
  async confirmar() {
    const a = this.qs.activa();
    if (!a) return;
    const listas = this.qs.porImportar();
    if (!listas) {
      await Swal.fire({ icon: 'info', title: 'Nada que importar', text: 'No hay filas listas todavía.' });
      return;
    }
    const conf = await Swal.fire({
      icon: 'question',
      title: `Importar ${listas}`,
      html: `Lo que quede pendiente <b>no se pierde</b>: sigue aquí para cuando quieras.`,
      showCancelButton: true, confirmButtonText: 'Importar', cancelButtonText: 'Ahora no',
    });
    if (!conf.isConfirmed) return;

    const r = await this.qs.ejecutar(a.id);

    if (!r?.success) {
      /* Una importación que se detuvo NO puede enseñar la pantalla de
         «terminada»: lo que entró, entró, pero queda trabajo, y mandar al
         usuario a la vista de resultado le haría creer que acabó.
         Se queda en la revisión, donde puede volver a pulsar. */
      await Swal.fire({
        icon: 'error', title: 'Se detuvo a medias',
        html: `Entraron <b>${r?.data?.procesadas ?? 0}</b> antes de parar.` +
              `<br><br>Lo que entró se queda. Puedes volver a intentarlo con el resto.`,
        confirmButtonText: 'Entendido',
      });
      this.vista.set('revision');
      return;
    }
    this.vista.set('listo');
  }

  async deshacer() {
    const a = this.qs.activa();
    if (!a) return;
    const chk = await this.qs.undoCheck(a.id);
    const d = chk?.data?.[0] ?? {};
    if (d.veredicto === 'NADA') {
      await Swal.fire({ icon: 'info', title: 'Esto ya no se puede deshacer',
        text: 'Los productos de esta carga ya tienen movimiento. Su historial no se borra.' });
      return;
    }
    const parcial = d.veredicto === 'EN_PARTE';
    const conf = await Swal.fire({
      icon: 'warning',
      title: parcial ? 'Se puede deshacer en parte' : '¿Deshacer la importación?',
      html: parcial
        ? `<b>${d.con_actividad}</b> productos ya se movieron y se quedan, con su historial intacto.<br>Los otros <b>${d.aplicadas - d.con_actividad}</b> se retiran.`
        : `Se retiran <b>${d.aplicadas}</b> productos y su existencia inicial.`,
      showCancelButton: true, confirmButtonText: 'Deshacer', cancelButtonText: 'Dejar como está',
    });
    if (!conf.isConfirmed) return;
    const r = await this.qs.undo(a.id);
    const x = r?.data?.[0] ?? {};
    await Swal.fire({ icon: 'success', title: 'Hecho',
      html: `Retirados <b>${x.revertidas ?? 0}</b>.${x.conservadas ? ` Se conservaron <b>${x.conservadas}</b> con movimiento.` : ''}` });
    this.vista.set('revision');
  }

  async descartar() {
    const a = this.qs.activa();
    if (!a) return;
    const conf = await Swal.fire({
      icon: 'question', title: '¿Tirar esta carga?',
      text: 'No se importa nada. Queda en el historial por si quieres mirarla.',
      showCancelButton: true, confirmButtonText: 'Tirarla',
    });
    if (conf.isConfirmed) { await this.qs.descartar(a.id); this.vista.set('vacio'); }
  }

  async descargarPlantilla() {
    const r = await this.qs.plantilla();
    if (r?.success) {
      await Swal.fire({ icon: 'success', title: 'Plantilla lista',
        html: `Se guardó como <b>${r.data.nombre}</b> en tus Descargas.`, timer: 2600 });
    } else {
      await Swal.fire({ icon: 'error', title: 'No se pudo generar', text: r?.error ?? '' });
    }
  }

  // ==================================================================
  //  CAPTURA DE LIBRETA
  // ==================================================================
  async empezarCaptura(lector = false) {
    const r = await this.qs.cargaManual(lector);
    if (!r?.success) {
      await Swal.fire({ icon: 'error', title: 'No pude abrir la captura', text: r?.error ?? '' });
      return;
    }
    const batch = r.data[0] ?? r.data;
    await this.qs.listar();
    await this.qs.abrir(batch.id);
    this.capturados.set(this.qs.filas());
    this.vista.set('captura');
    queueMicrotask(() => document.getElementById('qs-nombre')?.focus());
  }

  /**
   * Enter guarda y deja la siguiente lista.
   *
   * Sin modal y sin celebracion: quien esta copiando una libreta quiere
   * ritmo, y cualquier cosa que haya que cerrar lo rompe.
   */
  async guardarCaptura() {
    const a = this.qs.activa();
    const nombre = this.capturaNombre().trim();
    if (!a || !nombre) return;

    const r = await this.qs.capturar(a.id, {
      nombre,
      precio: this.capturaPrecio(),
      existencia: this.capturaStock(),
      codigo: this.capturaCodigo(),
    });
    if (!r?.success) {
      await Swal.fire({ icon: 'error', title: 'No se guardó', text: r?.error ?? '' });
      return;
    }

    this.capturaNombre.set(''); this.capturaPrecio.set(''); this.capturaStock.set(''); this.capturaCodigo.set('');
    await this.qs.abrir(a.id);
    this.capturados.set(this.qs.filas());
    this.ultimoId.set(this.qs.filas().slice(-1)[0]?.id ?? null);
    document.getElementById('qs-nombre')?.focus();
  }

  alTeclearCaptura(e: KeyboardEvent) {
    if (e.key === 'Enter') { e.preventDefault(); void this.guardarCaptura(); }
    if (e.key === 'Escape') { this.capturaNombre.set(''); this.capturaPrecio.set(''); this.capturaStock.set(''); this.capturaCodigo.set(''); }
  }

  cerrarTip() { this.tipVisto.set(true); }

  /** Lo capturado, lo último arriba: es lo que la persona acaba de escribir. */
  readonly capturadosAlReves = computed(() => [...this.capturados()].reverse());

  volverAInicio() { void this.router.navigateByUrl('/dashboard/inicio'); }

  porCarga = (_: number, c: Carga) => c.id;
  porFila = (_: number, f: FilaCarga) => f.id;
  porGrupo = (_: number, g: any) => g.codigo;
  porColumna = (_: number, c: any) => c.indice;
  porHoja = (_: number, h: any) => h.nombre;
  porCampo = (_: number, c: any) => c.campo;
}
