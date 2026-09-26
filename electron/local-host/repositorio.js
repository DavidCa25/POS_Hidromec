/**
 * LO QUE EL LOCAL HOST GUARDA EN LA BASE.
 *
 * Consultas parametrizadas, sin texto de fuera concatenado. Las tablas son de
 * la migracion 0044. Las comandas se leen y avanzan con kds-dominio.js (los
 * procedimientos de siempre), no aqui.
 */
const { hash, MINUTOS_EMPAREJAR } = require('./credenciales');

const SEGUNDOS_ARRIENDO = 90;

function crear({ poolPromise, sql }) {
  const pool = () => (typeof poolPromise === 'function' ? poolPromise() : poolPromise);

  /**
   * UN HOST POR BASE. Se toma o se renueva el arriendo; si lo tiene OTRO
   * equipo y no ha caducado, se devuelve quien. Atomico: dos cajas que
   * arrancan a la vez no pueden quedarse las dos con el.
   */
  async function tomarArriendo({ machineId, machineName, direccion, puerto }) {
    const r = await (await pool()).request()
      .input('m', sql.NVarChar(64), machineId)
      .input('n', sql.NVarChar(120), machineName || null)
      .input('d', sql.NVarChar(200), direccion || null)
      .input('p', sql.Int, puerto || null)
      .input('s', sql.Int, SEGUNDOS_ARRIENDO)
      .query(`
        SET NOCOUNT ON;
        SET XACT_ABORT ON;
        BEGIN TRAN;
        DECLARE @ahora DATETIME2(0) = SYSUTCDATETIME();
        IF NOT EXISTS (SELECT 1 FROM dbo.local_host_lease WITH (UPDLOCK, HOLDLOCK) WHERE id = 1)
            INSERT INTO dbo.local_host_lease (id, machine_id, machine_name, direccion, puerto, lease_until)
            VALUES (1, @m, @n, @d, @p, DATEADD(SECOND, @s, @ahora));
        ELSE
            UPDATE dbo.local_host_lease
               SET machine_id = @m, machine_name = @n, direccion = @d, puerto = @p,
                   claimed_at = CASE WHEN machine_id = @m THEN claimed_at ELSE @ahora END,
                   heartbeat_at = @ahora, lease_until = DATEADD(SECOND, @s, @ahora)
             WHERE id = 1 AND (machine_id = @m OR lease_until < @ahora);
        COMMIT;
        SELECT machine_id, machine_name, direccion, puerto, lease_until,
               CASE WHEN machine_id = @m THEN 1 ELSE 0 END AS mio
          FROM dbo.local_host_lease WHERE id = 1;`);
    const f = r.recordset?.[0];
    return { mio: !!f?.mio, dueno: f ? { machineId: f.machine_id, nombre: f.machine_name, direccion: f.direccion, puerto: f.puerto, hasta: f.lease_until } : null };
  }

  async function soltarArriendo(machineId) {
    await (await pool()).request().input('m', sql.NVarChar(64), machineId)
      .query('UPDATE dbo.local_host_lease SET lease_until = SYSUTCDATETIME() WHERE id = 1 AND machine_id = @m;');
  }

  async function quienEsHost() {
    const r = await (await pool()).request().query(
      'SELECT machine_id, machine_name, direccion, puerto, lease_until, CASE WHEN lease_until > SYSUTCDATETIME() THEN 1 ELSE 0 END AS vigente FROM dbo.local_host_lease WHERE id = 1;');
    const f = r.recordset?.[0];
    return f ? { machineId: f.machine_id, nombre: f.machine_name, direccion: f.direccion, puerto: f.puerto, vigente: !!f.vigente } : null;
  }

  // ------------------------------------------------------------ emparejar
  async function crearEmparejamiento({ token, superficie = 'PREPARATION', stationId, todas, nombre, config = null, userId }) {
    await (await pool()).request()
      .input('h', sql.Char(64), hash(token))
      .input('sup', sql.NVarChar(30), superficie)
      .input('st', sql.Int, stationId || null)
      .input('t', sql.Bit, todas ? 1 : 0)
      .input('n', sql.NVarChar(80), String(nombre).slice(0, 80))
      .input('cfg', sql.NVarChar(2000), config ? JSON.stringify(config).slice(0, 2000) : null)
      .input('u', sql.Int, userId || null)
      .input('min', sql.Int, MINUTOS_EMPAREJAR)
      .query(`INSERT INTO dbo.dispositivos_emparejamientos (token_hash, alcance, superficie, station_id, todas, nombre, config, creado_por, expira_en)
              VALUES (@h, 'SUPERFICIE', @sup, @st, @t, @n, @cfg, @u, DATEADD(MINUTE, @min, SYSUTCDATETIME()));`);
  }

  /**
   * Canjea el token por un dispositivo nuevo, UNA vez. El UPDATE marca el
   * token usado solo si estaba sin usar y vigente: dos tablets que escanean el
   * mismo QR a la vez no pueden quedarse las dos.
   */
  async function canjear({ token, credencial, agente, ip }) {
    const r = await (await pool()).request()
      .input('h', sql.Char(64), hash(token))
      .input('c', sql.Char(64), hash(credencial))
      .input('a', sql.NVarChar(200), String(agente || '').slice(0, 200) || null)
      .input('ip', sql.NVarChar(64), String(ip || '').slice(0, 64) || null)
      .query(`
        SET NOCOUNT ON;
        SET XACT_ABORT ON;
        BEGIN TRAN;
        DECLARE @e TABLE (id INT, station_id INT, todas BIT, nombre NVARCHAR(80), creado_por INT, superficie NVARCHAR(30), config NVARCHAR(2000));
        UPDATE dbo.dispositivos_emparejamientos
           SET usado_en = SYSUTCDATETIME()
        OUTPUT inserted.id, inserted.station_id, inserted.todas, inserted.nombre, inserted.creado_por, inserted.superficie, inserted.config INTO @e
         WHERE token_hash = @h AND usado_en IS NULL AND expira_en > SYSUTCDATETIME();
        DECLARE @dev UNIQUEIDENTIFIER = NEWID();
        IF EXISTS (SELECT 1 FROM @e)
        BEGIN
            INSERT INTO dbo.dispositivos_locales (id, nombre, alcance, superficie, config, station_id, todas, credencial_hash, emparejado_por, ultima_ip, agente, ultimo_contacto)
            SELECT @dev, nombre, 'SUPERFICIE', superficie, config, station_id, todas, @c, creado_por, @ip, @a, SYSUTCDATETIME() FROM @e;
            UPDATE x SET dispositivo_id = @dev FROM dbo.dispositivos_emparejamientos x JOIN @e e ON e.id = x.id;
        END
        COMMIT;
        SELECT d.id, d.nombre, d.station_id, d.todas, d.superficie, d.config, s.nombre AS estacion
          FROM dbo.dispositivos_locales d LEFT JOIN dbo.prep_stations s ON s.id = d.station_id
         WHERE d.id = @dev AND EXISTS (SELECT 1 FROM @e);
        SELECT CASE WHEN EXISTS (SELECT 1 FROM dbo.dispositivos_emparejamientos WHERE token_hash = @h AND usado_en IS NOT NULL) THEN 'USADO'
                    WHEN EXISTS (SELECT 1 FROM dbo.dispositivos_emparejamientos WHERE token_hash = @h AND expira_en <= SYSUTCDATETIME()) THEN 'CADUCO'
                    WHEN EXISTS (SELECT 1 FROM dbo.dispositivos_emparejamientos WHERE token_hash = @h) THEN 'OK'
                    ELSE 'NO_EXISTE' END AS motivo;`);
    const dev = r.recordsets?.[0]?.[0];
    if (dev) return { ok: true, dispositivo: fila(dev) };
    return { ok: false, motivo: r.recordsets?.[1]?.[0]?.motivo || 'NO_EXISTE' };
  }

  // -------------------------------------------------------- dispositivos
  /** El dispositivo de una credencial, si existe y NO esta revocado. */
  async function porCredencial(credencial) {
    const r = await (await pool()).request().input('c', sql.Char(64), hash(credencial)).query(`
      SELECT d.id, d.nombre, d.alcance, d.superficie, d.config, d.station_id, d.todas, d.revocado_en, s.nombre AS estacion, s.activa AS estacion_activa
        FROM dbo.dispositivos_locales d LEFT JOIN dbo.prep_stations s ON s.id = d.station_id
       WHERE d.credencial_hash = @c;`);
    const f = r.recordset?.[0];
    if (!f || f.revocado_en) return null;
    return fila(f);
  }

  async function tocar(id, ip) {
    await (await pool()).request().input('id', sql.UniqueIdentifier, id).input('ip', sql.NVarChar(64), String(ip || '').slice(0, 64) || null)
      .query('UPDATE dbo.dispositivos_locales SET ultimo_contacto = SYSUTCDATETIME(), ultima_ip = ISNULL(@ip, ultima_ip) WHERE id = @id;');
  }

  async function listarDispositivos() {
    const r = await (await pool()).request().query(`
      SELECT d.id, d.nombre, d.alcance, d.superficie, d.config, d.station_id, d.todas, s.nombre AS estacion,
             d.emparejado_en, d.ultimo_contacto, d.ultima_ip, d.revocado_en, d.funcion_cambiada_en
        FROM dbo.dispositivos_locales d LEFT JOIN dbo.prep_stations s ON s.id = d.station_id
       ORDER BY CASE WHEN d.revocado_en IS NULL THEN 0 ELSE 1 END, d.nombre;`);
    return r.recordset || [];
  }

  async function revocar(id, userId) {
    const r = await (await pool()).request().input('id', sql.UniqueIdentifier, id).input('u', sql.Int, userId || null)
      .query('UPDATE dbo.dispositivos_locales SET revocado_en = SYSUTCDATETIME(), revocado_por = @u WHERE id = @id AND revocado_en IS NULL; SELECT @@ROWCOUNT AS n;');
    return (r.recordset?.[0]?.n ?? 0) > 0;
  }

  /**
   * Cambiar la FUNCION de un dispositivo (Mi jornada -> Mesero). La
   * credencial no cambia: es el mismo aparato. Quien lo autoriza se guarda.
   */
  async function cambiarFuncion({ id, superficie, stationId = null, todas = false, config = null, userId = null }) {
    const r = await (await pool()).request()
      .input('id', sql.UniqueIdentifier, id)
      .input('sup', sql.NVarChar(30), superficie)
      .input('st', sql.Int, stationId || null)
      .input('t', sql.Bit, todas ? 1 : 0)
      .input('cfg', sql.NVarChar(2000), config ? JSON.stringify(config).slice(0, 2000) : null)
      .input('u', sql.Int, userId)
      .query(`UPDATE dbo.dispositivos_locales
                 SET superficie = @sup, station_id = @st, todas = @t, config = @cfg,
                     funcion_cambiada_en = SYSUTCDATETIME(), funcion_cambiada_por = @u
               WHERE id = @id AND revocado_en IS NULL;
              SELECT @@ROWCOUNT AS n;`);
    return (r.recordset?.[0]?.n ?? 0) > 0;
  }

  async function renombrar(id, nombre) {
    const r = await (await pool()).request()
      .input('id', sql.UniqueIdentifier, id).input('n', sql.NVarChar(80), String(nombre).trim().slice(0, 80))
      .query('UPDATE dbo.dispositivos_locales SET nombre = @n WHERE id = @id AND revocado_en IS NULL; SELECT @@ROWCOUNT AS n;');
    return (r.recordset?.[0]?.n ?? 0) > 0;
  }

  // ---------------------------------------------------------- cambios
  /** Lo que cambio en comandas desde la version dada. La base es la verdad. */
  async function cambiosDesde(version) {
    const r = await (await pool()).request().input('v', sql.BigInt, version || 0).query(`
      SELECT id, station_id, estado, CONVERT(BIGINT, version) AS version
        FROM dbo.comandas
       WHERE version > CONVERT(ROWVERSION, CONVERT(BINARY(8), @v))
       ORDER BY version;`);
    return r.recordset || [];
  }

  /** Desde donde empieza a mirar el Host: lo anterior no «suena». */
  async function versionActual() {
    const r = await (await pool()).request().query(
      'SELECT CONVERT(BIGINT, ISNULL(MAX(version), 0)) AS v, ISNULL(MAX(id), 0) AS idMax FROM dbo.comandas;');
    return { version: Number(r.recordset?.[0]?.v ?? 0), idMax: Number(r.recordset?.[0]?.idMax ?? 0) };
  }

  async function estaciones() {
    const r = await (await pool()).request().query('SELECT id, nombre, salida FROM dbo.prep_stations WHERE activa = 1 ORDER BY orden, nombre;');
    return r.recordset || [];
  }

  return {
    tomarArriendo, soltarArriendo, quienEsHost,
    crearEmparejamiento, canjear, porCredencial, tocar, listarDispositivos, revocar, cambiarFuncion, renombrar,
    cambiosDesde, versionActual, estaciones, SEGUNDOS_ARRIENDO,
  };
}

/** Un dispositivo, como lo usa el resto del Host. */
function fila(f) {
  let config = null;
  try { config = f.config ? JSON.parse(f.config) : null; } catch { config = null; }
  return {
    id: String(f.id).toLowerCase(),
    nombre: f.nombre,
    superficie: f.superficie || 'PREPARATION',
    config: config || {},
    stationId: f.station_id ?? null,
    todas: !!f.todas,
    estacion: f.estacion ?? null,
  };
}

module.exports = { crear, fila };
