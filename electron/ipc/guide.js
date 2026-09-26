/**
 * WYBIX GUIDE: ¿PUEDE CORRER UNA DEMO AUTOMATICA AQUI?
 *
 * La guia ENSENA en cualquier instalacion: señala, explica y espera a que la
 * persona lo haga. Lo que solo puede hacer en una demostracion es ACTUAR:
 * escribir en un formulario, guardar un producto, cobrar. Eso ensuciaria el
 * catalogo y las ventas de un negocio real.
 *
 * La respuesta sale de aqui, del proceso principal, y no del renderer: ocultar
 * un boton no es una guarda. Son TRES condiciones, independientes, y hacen
 * falta las tres:
 *
 *   1. Este proceso es el de demostraciones: lo arranco el gestor, que es lo
 *      unico que declara el espacio `demo` en la licencia. El gestor no viaja
 *      en el instalador publico: ahi esto es siempre «no».
 *   2. La base conectada lleva `is_demo` en `database_metadata`. Lo escribe la
 *      semilla de una demo y el producto normal jamas.
 *   3. Su `demo_instance_id` -y su nombre- coinciden con los que ESTE gestor
 *      anoto al crearla. No basta con ser UNA demo: tiene que ser la suya.
 *
 * Y no se responde una vez para todo el recorrido: el renderer pide permiso
 * antes de CADA paso que escribe (`guide:autorizar`), asi que cambiar de base
 * a mitad de una demo la detiene en el siguiente paso.
 */

function registrar({ ipcMain, poolPromise, app, demo, licencia }) {
  const pool = typeof poolPromise === 'function' ? poolPromise : () => poolPromise;

  /* El registro del gestor solo existe si el gestor existe. */
  const registro = (() => {
    if (!demo) return null;
    try { return require('../demo/registro'); } catch { return null; }
  })();

  async function contexto() {
    const r = { autopilot: false, motivo: '', demo: false, perfil: null, preset: null };
    let meta = {};
    let base = null;
    try {
      const p = await pool();
      const q = await p.request().query(
        "SELECT clave, valor FROM dbo.database_metadata " +
        "WHERE clave IN ('is_demo','demo_profile','demo_preset','demo_instance_id');");
      for (const f of q.recordset || []) meta[f.clave] = f.valor;
      base = (await p.request().query('SELECT DB_NAME() AS base;')).recordset?.[0]?.base ?? null;
    } catch {
      /* Sin tabla o sin conexion no es una demo. Nunca lanza: es contexto. */
    }
    r.demo = String(meta.is_demo).toLowerCase() === 'true';
    r.perfil = meta.demo_profile || null;
    r.preset = meta.demo_preset || null;

    const procesoDemo = !!demo && !!registro && typeof licencia?.esDemo === 'function' && licencia.esDemo();
    if (!procesoDemo) {
      r.motivo = 'La demostración automática solo corre en una demo abierta desde el gestor de demostraciones.';
      return r;
    }
    if (!r.demo) { r.motivo = 'Esta base no está marcada como demostración.'; return r; }

    const anotada = r.perfil ? registro.leerTodo(app)[r.perfil] : null;
    const instancia = String(meta.demo_instance_id || '').toLowerCase();
    if (!anotada || !instancia || String(anotada.instancia || '').toLowerCase() !== instancia) {
      r.motivo = 'Esta base no es la demostración que creó este gestor.';
      return r;
    }
    if (anotada.base && base && String(anotada.base).toLowerCase() !== String(base).toLowerCase()) {
      r.motivo = 'La base conectada no es la de esta demostración.';
      return r;
    }
    r.autopilot = true;
    return r;
  }

  ipcMain.handle('guide:contexto', async () => {
    const c = await contexto();
    return { success: true, data: c };
  });

  /* Antes de cada paso que escribe. Sin cache: se vuelve a comprobar todo. */
  ipcMain.handle('guide:autorizar', async (_e, p = {}) => {
    const c = await contexto();
    if (!c.autopilot) return { success: false, error: c.motivo, paso: p?.paso ?? null };
    return { success: true, data: { perfil: c.perfil, preset: c.preset } };
  });

  /*
   * LAS PRECONDICIONES DE UNA DEMO, AQUI Y NO EN EL RENDERER.
   *
   * Una demo automatica tiene que poder correr una vez, cinco o veinte sobre
   * la misma base sin que el negocio se llene de «Producto Demo (2)» ni de
   * comandas de la vuelta anterior. Lo que no tiene canal propio -archivar el
   * producto de la vuelta pasada, cerrar lo que una vuelta cortada dejo abierto-
   * se hace aqui, con la MISMA guarda que `guide:autorizar`: fuera de una demo
   * segura esto no toca nada. El SQL es fijo: no entra texto del renderer.
   *
   * Lo que si tiene canal (estaciones, mesas, turno) lo sigue haciendo el
   * renderer por su canal, con sus reglas.
   */
  const PREPARAR = {
    'demo.retail': `
      SET NOCOUNT ON;
      IF NOT EXISTS (SELECT 1 FROM dbo.CAT_brands WHERE namee = N'General')
          INSERT INTO dbo.CAT_brands (namee) VALUES (N'General');
      IF NOT EXISTS (SELECT 1 FROM dbo.CAT_categories WHERE namee = N'General')
          INSERT INTO dbo.CAT_categories (namee) VALUES (N'General');
      /* El producto de la vuelta anterior se ARCHIVA, no se borra: puede tener
         ventas. Libera su codigo y deja de estar a la venta. */
      UPDATE dbo.products
         SET part_number = CONCAT(N'DEMO-GUIA-CAFE~', id), active = 0
       WHERE part_number = N'DEMO-GUIA-CAFE';
      SELECT (SELECT id FROM dbo.CAT_brands WHERE namee = N'General') AS marcaId,
             (SELECT id FROM dbo.CAT_categories WHERE namee = N'General') AS categoriaId,
             (SELECT ISNULL(MAX(id), 0) FROM dbo.sales) AS ventaBase;`,
    'demo.hospitality': `
      SET NOCOUNT ON;
      IF NOT EXISTS (SELECT 1 FROM dbo.CAT_brands WHERE namee = N'General')
          INSERT INTO dbo.CAT_brands (namee) VALUES (N'General');
      IF NOT EXISTS (SELECT 1 FROM dbo.CAT_categories WHERE namee = N'Bebidas')
          INSERT INTO dbo.CAT_categories (namee) VALUES (N'Bebidas');
      /* Lo que una vuelta cortada dejo en la cocina: se entrega, para que la
         barra empiece limpia y la demo encuentre SU comanda. */
      UPDATE dbo.comandas
         SET estado = 'ENTREGADA',
             empezada_en = ISNULL(empezada_en, SYSDATETIME()),
             lista_en = ISNULL(lista_en, SYSDATETIME()),
             entregada_en = SYSDATETIME()
       WHERE estado IN ('NUEVA', 'PREPARANDO', 'LISTA');
      /* Y la cuenta que quedo abierta en la Mesa 1 sin cobrarse: se cancela. */
      UPDATE c SET estado = 'CANCELADA', cerrada_en = SYSDATETIME()
        FROM dbo.hosp_cuentas c
        JOIN dbo.salon_mesas m ON m.id = c.mesa_id
       WHERE m.nombre = N'1' AND c.estado IN ('ABIERTA', 'POR_COBRAR') AND c.sale_id IS NULL;
      SELECT (SELECT id FROM dbo.CAT_brands WHERE namee = N'General') AS marcaId,
             (SELECT id FROM dbo.CAT_categories WHERE namee = N'Bebidas') AS categoriaId,
             (SELECT ISNULL(MAX(id), 0) FROM dbo.comandas) AS comandaBase;`,
    'demo.services.workshop': `
      SET NOCOUNT ON;
      /* Ordenes que una vuelta cortada dejo a medias con el cliente de la
         demo: se cancelan para que la lista empiece limpia. */
      UPDATE o SET status = 'CANCELADA'
        FROM dbo.service_orders o
        JOIN dbo.customers c ON c.id = o.customer_id
       WHERE c.customerName = N'David Demo' AND o.status IN ('BORRADOR', 'ABIERTA', 'EN_PROCESO', 'TERMINADA')
         AND o.sale_id IS NULL;
      SELECT (SELECT TOP 1 id FROM dbo.customers WHERE customerName = N'David Demo') AS clienteId,
             (SELECT TOP 1 id FROM dbo.customer_assets WHERE identifier = N'ABC-123') AS activoId,
             (SELECT TOP 1 id FROM dbo.products WHERE part_number = N'SRV-ACE') AS servicioId,
             (SELECT ISNULL(MAX(id), 0) FROM dbo.service_orders) AS ordenBase;`,
    'demo.services.beauty': `
      SET NOCOUNT ON;
      /* Las citas y ordenes de la clienta de la demo que una vuelta cortada
         dejo pendientes: se cancelan. Solo las suyas. */
      DECLARE @cli INT = (SELECT TOP 1 id FROM dbo.customers WHERE customerName = N'Mariana López');
      UPDATE dbo.appointments SET status = 'CANCELADA'
       WHERE customer_id = @cli AND status IN ('AGENDADA', 'CONFIRMADA') AND service_order_id IS NULL;
      UPDATE dbo.service_orders SET status = 'CANCELADA'
       WHERE customer_id = @cli AND status IN ('BORRADOR', 'ABIERTA', 'EN_PROCESO', 'TERMINADA') AND sale_id IS NULL;
      SELECT @cli AS clienteId,
             (SELECT TOP 1 id FROM dbo.products WHERE part_number = N'SRV-COR') AS servicioId,
             (SELECT TOP 1 id FROM dbo.professionals WHERE full_name = N'Ana Torres') AS profesionalId,
             (SELECT ISNULL(MAX(id), 0) FROM dbo.appointments) AS citaBase,
             (SELECT ISNULL(MAX(id), 0) FROM dbo.service_orders) AS ordenBase;`,
  };

  ipcMain.handle('guide:preparar', async (_e, p = {}) => {
    const c = await contexto();
    if (!c.autopilot) return { success: false, error: c.motivo };
    const sqlText = PREPARAR[String(p?.escenario || '')];
    if (!sqlText) return { success: true, data: {} };
    try {
      const pl = await pool();
      const r = await pl.request().query(sqlText);
      return { success: true, data: (r.recordset && r.recordset[0]) || {} };
    } catch (e) {
      console.error('[GUIDE] preparar', p?.escenario, e.message);
      return { success: false, error: 'No se pudo preparar la demostración.', detalle: e.message };
    }
  });
}

module.exports = { registrar };
