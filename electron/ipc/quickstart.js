/**
 * IPC de QuickStart: las cargas.
 *
 * Mismo criterio que `ipc/servicios.js`: aqui no hay reglas de negocio que
 * decidan si un producto entra o no. Lo que si vive aqui es la TUBERIA —leer,
 * proponer mapeo, normalizar, validar, planificar— porque tiene que correr
 * fuera del renderer: analizar diez mil filas en el hilo de la interfaz deja
 * la ventana congelada, y lo primero que hace el usuario es cerrarla.
 *
 * LA REGLA QUE ORDENA TODO ESTE ARCHIVO
 * -------------------------------------
 * Nada de lo que hay aqui escribe en `products` ni en `inventory_movements`,
 * salvo `quickstart:ejecutar`. Leer un archivo, resolver un grupo de
 * problemas o cambiar el mapeo tocan el almacen intermedio y nada mas. El
 * catalogo se toca cuando alguien confirma, y en ese momento lo hace SQL.
 */
const path = require('node:path');
const sesion = require('../seguridad/sesion');
const lector = require('../quickstart/lector');
const alias = require('../quickstart/alias');
const planificador = require('../quickstart/plan');
const plantillas = require('../quickstart/plantillas');
const semantica = require('../quickstart/semantica');

/** Cuantas filas se mandan a SQL por viaje al guardar el staging. */
const LOTE_GUARDADO = 500;

/** Cuantas filas ejecuta cada transaccion. Ver la nota de medicion abajo. */
const LOTE_EJECUCION = 300;

/**
 * LO QUE VE EL CLIENTE CUANDO ALGO FALLA.
 *
 * Nunca un TypeError, nunca un `undefined`, nunca una pila de llamadas. El
 * detalle tecnico va a la bitacora del proceso principal, que es donde sirve
 * para algo; la persona que acaba de comprar un punto de venta recibe una
 * frase que puede usar.
 */
function alHumano(e, contexto) {
  console.error('[QUICKSTART] ' + contexto + ':', String((e && e.stack) || (e && e.message) || e));

  const m = String((e && e.message) || '');
  if (/solo puedo leer archivos/i.test(m)) {
    return 'Solo puedo leer archivos de Excel (.xlsx) y CSV. Prueba a guardarlo en uno de esos formatos.';
  }
  if (/zip|end of central directory|corrupt|invalid signature/i.test(m)) {
    return 'Este archivo no parece un Excel valido. Abrelo, vuelve a guardarlo y prueba de nuevo.';
  }
  if (/ENOENT|no such file/i.test(m)) {
    return 'No encontre el archivo. Puede que se haya movido mientras lo leia.';
  }
  if (/password|encrypted/i.test(m)) {
    return 'El archivo esta protegido con contrasena. Quitasela y vuelve a intentarlo.';
  }
  return 'No pude leer este archivo. Revisa que sea un Excel o un CSV valido e intentalo de nuevo.';
}

/**
 * QUE HOJA ES LA BUENA.
 *
 * Un catalogo de proveedor casi nunca viene solo: trae la hoja de datos y
 * ademas notas, instrucciones o la pestana que alguien dejo a medias. Tomar
 * la primera en silencio acierta la mitad de las veces, y ofrecerlas todas
 * por igual obliga a la persona a adivinar cual es cual.
 *
 * Cada encabezado que Wybix reconoce vale mucho mas que una fila: una hoja
 * de notas tiene filas y ningun encabezado reconocible.
 */
function puntuarHoja(hoja) {
  const reconocidos = alias.proponer(hoja.encabezados).columnas
    .filter(function (c) { return c.campo && (c.confianza === 'exacto' || c.confianza === 'probable'); })
    .length;
  return {
    nombre: hoja.nombre,
    filas: hoja.filas.length,
    columnas: hoja.encabezados.length,
    reconocidos: reconocidos,
    /* Dos campos reconocidos ya distinguen una tabla de un texto suelto. */
    esDatos: reconocidos >= 2,
    punto: reconocidos * 100 + Math.min(hoja.filas.length, 50),
  };
}

const num = (v) => (v === null || v === undefined || v === '' || isNaN(Number(v))) ? null : Number(v);
const txt = (v) => (v === null || v === undefined) ? null : (String(v).trim() || null);

async function ejecutar(pool, nombre, construir) {
  try {
    const req = pool.request();
    if (construir) construir(req);
    const r = await req.execute(nombre);
    return { success: true, data: r.recordset ?? [], sets: r.recordsets ?? [] };
  } catch (e) {
    console.error('[QUICKSTART] ' + nombre + ':', String((e && e.stack) || e));
    /* Un mensaje de SQL Server no es para el cliente. La bitacora lo tiene. */
    return { success: false, error: 'No se pudo completar la operacion. Vuelve a intentarlo.' };
  }
}

function registrar({ ipcMain, sql, poolPromise, app, contexto }) {
  const pool = () => poolPromise;

  /* ------------------------------------------------------------ contexto
     El giro y las capacidades del negocio, que deciden el vocabulario y que
     campos tienen sentido. Sale de donde ya vive, no de una copia. */
  async function negocio() {
    try {
      const p = await pool();
      const r = await p.request().execute('sp_get_services_config');
      const fila = r.recordset?.[0] ?? {};
      const preset = fila.preset || null;
      /* POR SU NOMBRE REAL, Y POR EL PROCEDIMIENTO.
         Esto consultaba `clave`/`activo`, que no existen -las columnas son
         `module_key`/`enabled`-, asi que reventaba siempre y el `catch` de
         abajo devolvia «ni hospitality ni servicios» para TODO negocio. Una
         cafeteria cargaba su hoja «Insumos» como productos vendibles porque
         QuickStart nunca llego a enterarse de que era una cafeteria. */
      const mods = await p.request().execute('sp_get_business_modules');
      const activos = new Set((mods.recordset || [])
        .filter(m => m.enabled === true || m.enabled === 1)
        .map(m => String(m.module_key)));
      const presets = require('../servicios/presets');
      const def = preset ? presets.buscar(preset) : null;

      /*
       * EL RESPALDO QUE EL RENDERER YA TENIA Y ESTE LADO NO.
       *
       * En una base nueva el registro de modulos nace VACIO: la siembra de
       * 0028 exige que `business_config` ya exista, y las migraciones corren
       * antes de que nadie de de alta el negocio. Demo Hospitality quedaba
       * con `business_profile = 'HOSPITALITY'` y cero filas en
       * `business_modules`.
       *
       * `CapabilityService` lo salva leyendo el perfil cuando el registro
       * viene vacio; aqui no habia nada equivalente, asi que QuickStart
       * preguntaba «¿es hospitality?» y le decian que no. La hoja «Insumos»
       * entraba como productos vendibles y pedia precio para doce.
       *
       * 0039 arregla el dato -y `sp_setup_inicial` ya siembra el registro-,
       * pero esto se queda: una caja que todavia no haya migrado tiene que
       * dar la MISMA respuesta que la pantalla que el usuario esta viendo.
       * Solo puede añadir: nunca apaga un modulo que el registro declare.
       */
      const perfil = String(contexto?.businessProfile?.() || 'RETAIL').toUpperCase();

      return {
        preset,
        servicios: activos.has('servicios'),
        hospitality: activos.has('hospitality') || perfil === 'HOSPITALITY',
        businessProfile: perfil,
        material: def?.material || null,
      };
    } catch {
      return { preset: null, servicios: false, hospitality: false, businessProfile: 'RETAIL', material: null };
    }
  }

  /** Las unidades que existen: sin esto una unidad inventada revienta el FK. */
  async function unidades() {
    try {
      const p = await pool();
      const r = await p.request().query('SELECT code, name FROM dbo.uoms ORDER BY sort_order, code');
      return r.recordset || [];
    } catch { return []; }
  }

  /** El catalogo, minimo, para buscar duplicados sin una consulta por fila. */
  async function catalogo() {
    try {
      const p = await pool();
      const r = await p.request().query(
        'SELECT id, part_number, nombre, price, cost, bar_code FROM dbo.products WHERE active = 1');
      return r.recordset || [];
    } catch { return []; }
  }

  /** Guarda las filas planificadas en el almacen intermedio, por lotes. */
  async function guardarFilas(batchId, filas) {
    const p = await pool();
    for (let i = 0; i < filas.length; i += LOTE_GUARDADO) {
      const trozo = filas.slice(i, i + LOTE_GUARDADO);
      const tvp = new sql.Table('dbo.ImportRowType');
      tvp.columns.add('fila', sql.Int, { nullable: true });
      tvp.columns.add('crudo_json', sql.NVarChar(sql.MAX), { nullable: true });
      tvp.columns.add('tipo', sql.NVarChar(12), { nullable: true });
      tvp.columns.add('part_number', sql.NVarChar(100), { nullable: true });
      tvp.columns.add('nombre', sql.NVarChar(200), { nullable: true });
      tvp.columns.add('price', sql.Decimal(10, 2), { nullable: true });
      tvp.columns.add('cost', sql.Decimal(14, 4), { nullable: true });
      tvp.columns.add('stock', sql.Decimal(12, 2), { nullable: true });
      tvp.columns.add('bar_code', sql.NVarChar(60), { nullable: true });
      tvp.columns.add('category_name', sql.NVarChar(150), { nullable: true });
      tvp.columns.add('brand_name', sql.NVarChar(150), { nullable: true });
      tvp.columns.add('base_uom', sql.NVarChar(10), { nullable: true });
      tvp.columns.add('clave_prod_serv', sql.NVarChar(8), { nullable: true });
      tvp.columns.add('clave_unidad', sql.NVarChar(5), { nullable: true });
      tvp.columns.add('tasa_iva', sql.Decimal(5, 4), { nullable: true });
      tvp.columns.add('duration_minutes', sql.Int, { nullable: true });
      tvp.columns.add('schedulable', sql.Bit, { nullable: true });
      tvp.columns.add('default_commission_pct', sql.Decimal(5, 2), { nullable: true });
      tvp.columns.add('accion', sql.NVarChar(12), { nullable: true });
      tvp.columns.add('match_product_id', sql.Int, { nullable: true });
      tvp.columns.add('match_motivo', sql.NVarChar(20), { nullable: true });
      tvp.columns.add('problemas_json', sql.NVarChar(sql.MAX), { nullable: true });
      /* LAS DOS COLUMNAS QUE CORRIGEN LA SEMANTICA.
         Viajan desde `semantica.js` hasta `products` sin que ninguna capa
         intermedia vuelva a decidirlas: es lo que impide que un ingrediente
         acabe vendible otra vez. */
      tvp.columns.add('inventory_mode', sql.NVarChar(10), { nullable: true });
      tvp.columns.add('sellable', sql.Bit, { nullable: true });

      for (const f of trozo) {
        tvp.rows.add(
          f.fila ?? null,
          f.crudo ? JSON.stringify(f.crudo).slice(0, 4000) : null,
          f.tipo || 'PRODUCTO',
          txt(f.part_number), txt(f.nombre),
          num(f.price), num(f.cost), num(f.stock),
          txt(f.bar_code), txt(f.category_name), txt(f.brand_name),
          txt(f.base_uom), txt(f.clave_prod_serv), txt(f.clave_unidad), num(f.tasa_iva),
          num(f.duration_minutes),
          /* BIT en un TVP quiere un booleano de verdad: msnodesqlv8 rechaza
             el 1/0 con «A boolean was expected». */
          f.schedulable === null || f.schedulable === undefined ? null : !!f.schedulable,
          num(f.default_commission_pct),
          f.accion || 'PENDIENTE',
          num(f.match_product_id), txt(f.match_motivo),
          JSON.stringify(f.problemas || []),
          txt(f.inventory_mode),
          f.sellable === null || f.sellable === undefined ? null : !!f.sellable);
      }

      await p.request()
        .input('batch_id', sql.Int, batchId)
        .input('Rows', tvp)
        .execute('sp_import_rows_add');
    }
  }

  // =====================================================================
  //  EL RIEL
  // =====================================================================
  ipcMain.handle('quickstart:cargas', async (_e, p = {}) =>
    ejecutar(await pool(), 'sp_import_batch_list', (r) => r
      .input('incluir_historial', sql.Bit, p.historial === false ? 0 : 1)
      .input('tope', sql.Int, num(p.tope) ?? 40)));

  ipcMain.handle('quickstart:carga', async (_e, p = {}) =>
    ejecutar(await pool(), 'sp_import_batch_summary', (r) => r
      .input('batch_id', sql.Int, num(p.batchId))));

  ipcMain.handle('quickstart:filas', async (_e, p = {}) =>
    ejecutar(await pool(), 'sp_import_rows_get', (r) => r
      .input('batch_id', sql.Int, num(p.batchId))
      .input('filtro', sql.NVarChar(20), txt(p.filtro))
      .input('desde', sql.Int, num(p.desde) ?? 0)
      .input('tope', sql.Int, num(p.tope) ?? 200)));

  ipcMain.handle('quickstart:contexto', async () => ({
    success: true,
    data: { ...(await negocio()), uoms: await unidades() },
  }));

  // =====================================================================
  //  ANALIZAR: de un archivo o un pegado a una carga con filas
  // =====================================================================

  /** Lo comun a archivo y pegado: proponer mapeo, planificar y guardar. */
  async function crearCarga({ origen, etiqueta, hoja, metadata, userId, mappingForzado, hojasDelLibro, rutaOrigen, tipoForzado }) {
    const ctx = await negocio();
    const uoms = new Set((await unidades()).map(u => String(u.code).toLowerCase()));
    const cat = await catalogo();

    const propuesta = alias.proponer(hoja.encabezados);

    /* ¿Conozco ya este formato? La huella son los encabezados normalizados
       y ordenados: el mismo proveedor el mes que viene se reconoce aunque
       cambie el orden de las columnas. */
    let perfil = null;
    if (!mappingForzado) {
      const r = await ejecutar(await pool(), 'sp_import_mapping_find',
        (q) => q.input('huella', sql.NVarChar(200), propuesta.huella));
      perfil = r.data?.[0] || null;
    }

    let mapping = mappingForzado
      || (perfil ? JSON.parse(perfil.mapping_json) : propuesta.columnas);


    /* QUE TRAE ESTA HOJA. Lo decide `semantica.js` y nadie mas: si esto se
       resolviera aqui, acabaria habiendo un `if (hoja === 'Insumos')` en
       cada capa que necesitara saberlo. */
    const tipoHoja = tipoForzado || semantica.tipoDeHoja(hoja.nombre, hoja.encabezados, ctx);

    const p = await pool();
    const creada = await ejecutar(p, 'sp_import_batch_create', (q) => q
      .input('origen', sql.NVarChar(12), origen)
      .input('etiqueta', sql.NVarChar(200), etiqueta)
      .input('preset', sql.NVarChar(40), ctx.preset)
      .input('business_profile', sql.NVarChar(20), ctx.businessProfile)
      .input('user_id', sql.Int, num(userId))
      .input('metadata_json', sql.NVarChar(sql.MAX), JSON.stringify({
        hoja: hoja.nombre, columnas: hoja.encabezados.length,
        filaEncabezado: hoja.filaEncabezado, plantilla: metadata || null,
        huella: propuesta.huella, perfil: perfil?.nombre || null,
        /* Las demas hojas del libro. Es la diferencia entre «me equivoque de
           hoja, empiezo otra vez» y «me equivoque de hoja, la cambio». */
        hojas: hojasDelLibro || null,
        /* La ruta del archivo. Es lo que permite decir «tambien encontre
           Menu, ¿lo cargo?» sin volver al selector de archivos. */
        ruta: rutaOrigen || null,
        tipo: tipoHoja,
      })));
    if (!creada.success) return creada;

    const batch = creada.data[0];


    const filas = planificador.planificar(hoja.filas, mapping, cat, {
      uoms,
      tipoPorDefecto: tipoHoja,
      negocio: ctx,
      servicios: ctx.servicios,
    });

    await guardarFilas(batch.id, filas);

    await p.request()
      .input('batch_id', sql.Int, batch.id)
      .input('mapping_json', sql.NVarChar(sql.MAX), JSON.stringify(mapping))
      .execute('sp_import_batch_set_mapping');

    await p.request().input('batch_id', sql.Int, batch.id).execute('sp_import_batch_touch');

    return {
      success: true,
      data: {
        batchId: batch.id,
        propuesta,
        perfil: perfil ? { nombre: perfil.nombre, veces: perfil.veces_usado } : null,
        total: filas.length,
        hoja: hoja.nombre,
        hojas: hojasDelLibro || null,
        tipo: tipoHoja,
        etiquetaTipo: semantica.pluralDe(tipoHoja, ctx),
      },
    };
  }

  ipcMain.handle('quickstart:analizar-archivo', sesion.proteger('quickstart:analizar-archivo',
    async (_e, p = {}) => {
      try {
        const ruta = String(p?.ruta || '');
        if (!ruta) return { success: false, error: 'No llegó ninguna ruta.' };
        const leido = await lector.leerArchivo(ruta);
        const hojas = leido.hojas.filter(h => h.filas.length);
        if (!hojas.length) {
          return { success: false, error: 'Este archivo no tiene ninguna fila con datos.' };
        }

        /* Se ordenan por lo que se PARECEN a una tabla de productos, no por
           el orden en que estan en el libro: asi una hoja de notas deja de
           competir con la de inventario. */
        const puntuadas = hojas.map(puntuarHoja).sort((a, b) => b.punto - a.punto);
        const conDatos = puntuadas.filter(h => h.esDatos);

        /* Varias hojas con datos: se avisa y se deja elegir. Tomar la
           primera en silencio era lo de antes, y con «Precios 2024» al
           lado de «Listado» acertaba la mitad de las veces. */
        /* Solo se pregunta cuando de verdad hay duda: DOS hojas que parecen
           datos. Una hoja de notas al lado de una de productos no es una
           duda, es una hoja de notas. */
        if (!p.hoja && conDatos.length > 1) {
          return { success: true, data: { necesitaHoja: true, hojas: puntuadas, sugerida: puntuadas[0].nombre } };
        }

        const elegida = p.hoja || ((conDatos[0] && conDatos[0].nombre) || puntuadas[0].nombre);
        const hoja = hojas.find(h => h.nombre === elegida) || hojas[0];
        return crearCarga({
          origen: leido.metadata ? 'PLANTILLA' : 'ARCHIVO',
          /* Con varias hojas de datos, la etiqueta lleva cual es: si no, el
             riel muestra dos cargas del mismo nombre y no se distinguen. */
          etiqueta: conDatos.length > 1
            ? `${path.basename(ruta)} · ${hoja.nombre}`
            : path.basename(ruta),
          hoja, metadata: leido.metadata, userId: p.userId,
          mappingForzado: p.mapping,
          hojasDelLibro: puntuadas,
          rutaOrigen: ruta,
          tipoForzado: p.tipo || null,
        });
      } catch (e) {
        return { success: false, error: alHumano(e, 'quickstart') };
      }
    }));

  ipcMain.handle('quickstart:analizar-pegado', sesion.proteger('quickstart:analizar-pegado',
    async (_e, p = {}) => {
      try {
        const texto = String(p?.texto || '');
        if (!texto.trim()) return { success: false, error: 'No pegaste nada.' };
        const leido = lector.leerPegado(texto);
        const hoja = leido.hojas[0];
        if (!hoja?.filas.length) return { success: false, error: 'No encontré filas en lo que pegaste.' };
        return crearCarga({
          origen: 'PEGADO', etiqueta: `Pegado · ${hoja.filas.length} renglones`,
          hoja, metadata: null, userId: p.userId, mappingForzado: p.mapping,
        });
      } catch (e) {
        return { success: false, error: alHumano(e, 'quickstart') };
      }
    }));

  /** Vuelve a planificar con OTRO mapeo, sin volver a leer el archivo. */
  /**
   * Otra hoja del MISMO archivo, sin volver al selector.
   *
   * En QA hubo que subir el mismo XLSX dos veces para cargar «Insumos» y
   * despues «Menu». El archivo ya se conoce: su ruta viaja en la metadata
   * de la carga anterior.
   *
   * Sigue habiendo UNA carga por hoja —son cosas distintas, con tipos
   * distintos y revisiones distintas— pero el ORIGEN se reutiliza.
   */
  ipcMain.handle('quickstart:otra-hoja', sesion.proteger('quickstart:otra-hoja',
    async (_e, p = {}) => {
      try {
        const pool0 = await pool();
        const r = await pool0.request()
          .input('batch_id', sql.Int, num(p.batchId))
          .query('SELECT metadata_json FROM dbo.import_batches WHERE id = @batch_id');
        const meta = JSON.parse(r.recordset?.[0]?.metadata_json || '{}');
        if (!meta.ruta) {
          return { success: false, error: 'Esta carga no vino de un archivo.' };
        }
        const fsx = require('node:fs');
        if (!fsx.existsSync(meta.ruta)) {
          return { success: false, error: 'El archivo ya no está donde estaba. Vuelve a elegirlo.' };
        }

        const leido = await lector.leerArchivo(meta.ruta);
        const hojas = leido.hojas.filter(h => h.filas.length);
        const hoja = hojas.find(h => h.nombre === p.hoja);
        if (!hoja) return { success: false, error: 'Esa hoja ya no está en el archivo.' };

        const puntuadas = hojas.map(puntuarHoja).sort((a, b) => b.punto - a.punto);
        return crearCarga({
          origen: leido.metadata ? 'PLANTILLA' : 'ARCHIVO',
          etiqueta: `${path.basename(meta.ruta)} · ${hoja.nombre}`,
          hoja, metadata: leido.metadata, userId: p.userId,
          hojasDelLibro: puntuadas, rutaOrigen: meta.ruta, tipoForzado: p.tipo || null,
        });
      } catch (e) {
        return { success: false, error: alHumano(e, 'otra-hoja') };
      }
    }));

  ipcMain.handle('quickstart:remapear', sesion.proteger('quickstart:remapear',
    async (_e, p = {}) => {
      try {
        const batchId = num(p.batchId);
        const mapping = p.mapping;
        if (!batchId || !Array.isArray(mapping)) return { success: false, error: 'Falta el mapeo.' };

        const pool0 = await pool();
        const crudas = await pool0.request()
          .input('batch_id', sql.Int, batchId)
          .query('SELECT fila, crudo_json FROM dbo.import_rows WHERE batch_id = @batch_id ORDER BY fila');

        const ctx = await negocio();
        const uoms = new Set((await unidades()).map(u => String(u.code).toLowerCase()));
        const cat = await catalogo();

        /* Se replanifica con el MISMO tipo de hoja y el MISMO negocio con que
           se analizo. Sin ellos, una hoja «Menú» de una cafeteria volvia como
           PRODUCTO/DIRECT al confirmar el mapeo, y el POS la veia agotada. */
        const lote = await pool0.request()
          .input('batch_id', sql.Int, batchId)
          .query('SELECT metadata_json FROM dbo.import_batches WHERE id = @batch_id');
        const meta = JSON.parse(lote.recordset?.[0]?.metadata_json || '{}');
        const tipoHoja = meta.tipo || semantica.tipoDeHoja(meta.hoja || '', [], ctx);

        const filas = planificador.planificar(
          (crudas.recordset || []).map(r => ({ fila: r.fila, celdas: JSON.parse(r.crudo_json || '[]') })),
          mapping, cat, { uoms, tipoPorDefecto: tipoHoja, negocio: ctx, servicios: ctx.servicios });

        await pool0.request().input('batch_id', sql.Int, batchId).execute('sp_import_rows_clear');
        await guardarFilas(batchId, filas);
        await pool0.request()
          .input('batch_id', sql.Int, batchId)
          .input('mapping_json', sql.NVarChar(sql.MAX), JSON.stringify(mapping))
          .execute('sp_import_batch_set_mapping');
        await pool0.request().input('batch_id', sql.Int, batchId).execute('sp_import_batch_touch');

        return { success: true, data: { total: filas.length } };
      } catch (e) {
        return { success: false, error: alHumano(e, 'quickstart') };
      }
    }));

  // =====================================================================
  //  CAPTURA A MANO (libreta y lector de codigos)
  // =====================================================================

  /** Abre —o reutiliza— la carga manual abierta de esta persona. */
  ipcMain.handle('quickstart:carga-manual', sesion.proteger('quickstart:carga-manual',
    async (_e, p = {}) => {
      const ctx = await negocio();
      const pool0 = await pool();
      const abierta = await pool0.request()
        .input('user_id', sql.Int, num(p.userId))
        .query(`SELECT TOP 1 * FROM dbo.import_batches
                 WHERE origen IN ('MANUAL','LECTOR') AND estado NOT IN ('IMPORTADA','DESCARTADA')
                   AND (@user_id IS NULL OR user_id = @user_id)
                 ORDER BY created_at DESC`);
      if (abierta.recordset?.length) return { success: true, data: abierta.recordset[0] };

      return ejecutar(pool0, 'sp_import_batch_create', (q) => q
        .input('origen', sql.NVarChar(12), p.lector ? 'LECTOR' : 'MANUAL')
        .input('etiqueta', sql.NVarChar(200), p.lector ? 'Capturado con lector' : 'Escritos a mano')
        .input('preset', sql.NVarChar(40), ctx.preset)
        .input('business_profile', sql.NVarChar(20), ctx.businessProfile)
        .input('user_id', sql.Int, num(p.userId))
        .input('metadata_json', sql.NVarChar(sql.MAX), null));
    }));

  /**
   * Añade UN producto escrito a mano.
   *
   * Se guarda en cuanto se pulsa Enter, no al final: veinte productos de una
   * libreta son veinte minutos de trabajo de alguien, y perderlos porque se
   * fue la luz no es aceptable.
   */
  ipcMain.handle('quickstart:capturar', sesion.proteger('quickstart:capturar',
    async (_e, p = {}) => {
      try {
        const batchId = num(p.batchId);
        if (!batchId) return { success: false, error: 'Falta la carga.' };

        const ctx = await negocio();
        const uoms = new Set((await unidades()).map(u => String(u.code).toLowerCase()));
        const cat = await catalogo();

        const entrada = {
          fila: num(p.fila) ?? 0,
          celdas: [p.nombre, p.precio, p.existencia, p.codigo, p.barras, p.costo, p.categoria],
        };
        const mapping = [
          { indice: 0, campo: 'nombre' }, { indice: 1, campo: 'price' },
          { indice: 2, campo: 'stock' }, { indice: 3, campo: 'part_number' },
          { indice: 4, campo: 'bar_code' }, { indice: 5, campo: 'cost' },
          { indice: 6, campo: 'category_name' },
        ];
        const [fila] = planificador.planificar([entrada], mapping, cat, {
          uoms, tipoPorDefecto: p.tipo || 'PRODUCTO', servicios: ctx.servicios,
        });

        const pool0 = await pool();
        const siguiente = await pool0.request()
          .input('batch_id', sql.Int, batchId)
          .query('SELECT ISNULL(MAX(fila), 0) + 1 AS n FROM dbo.import_rows WHERE batch_id = @batch_id');
        fila.fila = siguiente.recordset[0].n;

        await guardarFilas(batchId, [fila]);
        await pool0.request().input('batch_id', sql.Int, batchId).execute('sp_import_batch_touch');

        return { success: true, data: { fila: fila.fila, accion: fila.accion, problemas: fila.problemas } };
      } catch (e) {
        return { success: false, error: alHumano(e, 'quickstart') };
      }
    }));

  // =====================================================================
  //  RESOLVER, CONFIRMAR, DESHACER
  // =====================================================================
  ipcMain.handle('quickstart:resolver-grupo', sesion.proteger('quickstart:resolver-grupo',
    async (_e, p = {}) => ejecutar(await pool(), 'sp_import_resolve_group', (r) => r
      .input('batch_id', sql.Int, num(p.batchId))
      .input('codigo', sql.NVarChar(40), txt(p.codigo))
      .input('resolucion', sql.NVarChar(20), txt(p.resolucion))
      .input('valor', sql.NVarChar(200), txt(p.valor)))));

  ipcMain.handle('quickstart:resolver-fila', sesion.proteger('quickstart:resolver-fila',
    async (_e, p = {}) => ejecutar(await pool(), 'sp_import_resolve_row', (r) => r
      .input('row_id', sql.Int, num(p.rowId))
      .input('resolucion', sql.NVarChar(20), txt(p.resolucion))
      .input('campo', sql.NVarChar(40), txt(p.campo))
      .input('valor', sql.NVarChar(200), txt(p.valor)))));

  /**
   * CONFIRMAR. Lo unico que toca el catalogo.
   *
   * Va por lotes y en bucle: cada lote es su propia transaccion, asi que uno
   * que falle no se lleva a los anteriores. Se informa del avance para que
   * la barra sea real y no un adorno.
   */
  ipcMain.handle('quickstart:ejecutar', sesion.proteger('quickstart:ejecutar',
    async (evento, p = {}) => {
      const batchId = num(p.batchId);
      if (!batchId) return { success: false, error: 'Falta la carga.' };

      const pool0 = await pool();
      const total = { procesadas: 0, creadas: 0, actualizadas: 0, movimientos: 0 };
      let vueltas = 0;

      /* CUANTAS FILAS VAN A ENTRAR DE VERDAD, medido AHORA.
         En QA se vio «Entrando... 12 de 10»: el avance se comparaba contra
         el total de FILAS DE LA CARGA, que incluye las ya aplicadas y las
         que no entran. Lo que hay que contar es lo que queda por aplicar. */
      const prev = await pool0.request()
        .input('batch_id', sql.Int, batchId)
        .query(`SELECT COUNT(*) AS n FROM dbo.import_rows
                 WHERE batch_id = @batch_id AND aplicada = 0 AND accion IN ('CREATE','UPDATE')`);
      const aPlanificar = Number(prev.recordset?.[0]?.n) || 0;

      try {
        for (;;) {
          const r = await pool0.request()
            .input('batch_id', sql.Int, batchId)
            .input('user_id', sql.Int, num(p.userId))
            .input('tope', sql.Int, num(p.lote) ?? LOTE_EJECUCION)
            .execute('sp_import_execute_chunk');
          const d = r.recordset?.[0] ?? { procesadas: 0 };
          if (!d.procesadas) break;

          total.procesadas += d.procesadas;
          total.creadas += d.creadas || 0;
          total.actualizadas += d.actualizadas || 0;
          total.movimientos += d.movimientos || 0;

          /* El avance no puede superar lo planificado. Si alguna vez lo
             hiciera, se prefiere enseñar el tope antes que un imposible. */
          const procesadas = Math.min(total.procesadas, aPlanificar);
          try {
            evento?.sender?.send('quickstart:avance',
              { batchId, ...total, procesadas, total: aPlanificar });
          } catch { /* ventana cerrada */ }

          /* Guarda de bucle infinito: si un lote dijera que proceso filas
             sin marcarlas, esto pararia en vez de girar para siempre. */
          if (++vueltas > 1000) break;
        }
        return { success: true, data: { ...total, planificadas: aPlanificar } };
      } catch (e) {
        /* Lo que ya entro, entro: se informa de cuanto y de por que paro. */
        return { success: false, error: alHumano(e, 'ejecutar'), data: total };
      }
    }));

  ipcMain.handle('quickstart:undo-check', sesion.proteger('quickstart:undo-check',
    async (_e, p = {}) => ejecutar(await pool(), 'sp_import_undo_check', (r) => r
      .input('batch_id', sql.Int, num(p.batchId)))));

  ipcMain.handle('quickstart:undo', sesion.proteger('quickstart:undo',
    async (_e, p = {}) => ejecutar(await pool(), 'sp_import_undo', (r) => r
      .input('batch_id', sql.Int, num(p.batchId))
      .input('user_id', sql.Int, num(p.userId)))));

  /**
   * Tirar una carga de captura SOLO si esta vacia.
   *
   * Se llama al salir de la captura. Con filas dentro no hace nada: esos
   * renglones son minutos de alguien copiando una libreta. Sin filas, la
   * borra, porque entrar y salir del lector cinco veces no puede dejar cinco
   * lineas de «0 renglones» en el historial.
   */
  ipcMain.handle('quickstart:soltar-si-vacia', sesion.proteger('quickstart:soltar-si-vacia',
    async (_e, p = {}) => ejecutar(await pool(), 'sp_import_batch_drop_if_empty', (r) => r
      .input('batch_id', sql.Int, num(p.batchId)))));

  ipcMain.handle('quickstart:descartar', sesion.proteger('quickstart:descartar',
    async (_e, p = {}) => ejecutar(await pool(), 'sp_import_batch_discard', (r) => r
      .input('batch_id', sql.Int, num(p.batchId)))));

  // =====================================================================
  //  PERFILES Y PLANTILLA
  // =====================================================================
  ipcMain.handle('quickstart:guardar-perfil', sesion.proteger('quickstart:guardar-perfil',
    async (_e, p = {}) => ejecutar(await pool(), 'sp_import_mapping_save', (r) => r
      .input('nombre', sql.NVarChar(120), txt(p.nombre))
      .input('huella', sql.NVarChar(200), txt(p.huella))
      .input('mapping_json', sql.NVarChar(sql.MAX), JSON.stringify(p.mapping || []))
      .input('user_id', sql.Int, num(p.userId)))));

  /**
   * Leer una hoja y devolverla como objetos, SIN crear carga.
   *
   * Lo usa la pantalla de Migracion para clientes, proveedores y ventas.
   * Existe para que en Wybix quede UN solo lector de archivos ajenos: el
   * otro camino usaba `xlsx@0.18.5`, que arrastra CVE-2023-30533 al leer un
   * archivo manipulado. Migrar clientes no es el catalogo, pero el archivo
   * es igual de ajeno.
   */
  ipcMain.handle('quickstart:leer-hoja', sesion.proteger('quickstart:leer-hoja',
    async (_e, p = {}) => {
      try {
        const leido = await lector.leerArchivo(String(p?.ruta || ''));
        const hoja = leido.hojas.find(h => h.filas.length);
        if (!hoja) return { success: false, error: 'La hoja no tiene filas con datos.' };
        /* Como objetos {encabezado: valor}: es lo que espera quien llama. */
        const filas = hoja.filas.map(f => {
          const o = {};
          hoja.encabezados.forEach((cab, i) => { if (cab) o[cab] = f.celdas[i] ?? ''; });
          return o;
        });
        return { success: true, data: filas, encabezados: hoja.encabezados };
      } catch (e) {
        return { success: false, error: alHumano(e, 'quickstart') };
      }
    }));

  ipcMain.handle('quickstart:plantilla', sesion.proteger('quickstart:plantilla',
    async (_e, p = {}) => {
      try {
        const ctx = await negocio();
        const destino = p.destino || path.join(app.getPath('downloads'));
        const r = await plantillas.generar(destino, ctx, await unidades(),
          { appVersion: app.getVersion?.() || '' });
        return { success: true, data: r };
      } catch (e) {
        return { success: false, error: alHumano(e, 'quickstart') };
      }
    }));
}

module.exports = { registrar, LOTE_EJECUCION, LOTE_GUARDADO };
