/**
 * PIN PERSONAL DE USUARIO EN LA CAJA.
 *
 * NO ES UN SEGUNDO SISTEMA DE PIN
 * -------------------------------
 * Local Host ya guarda un PIN por persona en `trabajadores_acceso` (scrypt con
 * sal propia, 5 fallos = bloqueo de 5 minutos). Aquí se usa la MISMA fila y
 * las MISMAS funciones (`local-host/credenciales.js`): una persona tiene un
 * solo PIN, que sirve igual para entrar a una Pantalla Operativa que para
 * autorizar un corte en caja. Dos PIN por persona serían dos cosas que
 * olvidar y dos cosas que robar.
 *
 * QUÉ GARANTIZA
 * -------------
 *   - pertenece a un usuario concreto (`user_id`);
 *   - nunca se guarda en claro ni se escribe en un log;
 *   - los intentos fallidos cuentan y bloquean, en la base, para todas las
 *     cajas y pantallas a la vez (no hay forma de saltarse el bloqueo
 *     cambiando de equipo).
 *
 * Este módulo no decide QUIÉN puede autorizar qué: solo responde «¿este PIN es
 * de este usuario?». La decisión de permisos vive en quien lo llama.
 */
const { pinValido, hashPin, pinCoincide } = require('../local-host/credenciales');

const FALLOS_MAX = 5;
const BLOQUEO_MIN = 5;

function crearPin({ sql, pool }) {
  const req = async () => (await pool()).request();

  /** Fila de acceso de un usuario (o null). */
  async function leer(userId) {
    const r = await (await req()).input('u', sql.Int, Number(userId) || 0).query(`
      SELECT a.id, a.pin_hash, a.pin_sal, a.pin_fallos, a.bloqueado_hasta, a.revocado_en,
             u.active, u.rol, u.usuario
        FROM dbo.trabajadores_acceso a
        JOIN dbo.users u ON u.id = a.user_id
       WHERE a.user_id = @u;`);
    return r.recordset?.[0] || null;
  }

  async function tienePin(userId) {
    const f = await leer(userId);
    return !!(f && f.pin_hash && !f.revocado_en);
  }

  /** Fija (o cambia) el PIN de un usuario. Reinicia fallos y bloqueo. */
  async function fijar(userId, pin, porUsuario) {
    const malo = pinValido(pin);
    if (malo) return { ok: false, error: malo };
    const { hash, sal } = hashPin(pin);
    await (await req())
      .input('u', sql.Int, Number(userId))
      .input('h', sql.VarChar(128), hash)
      .input('s', sql.VarChar(64), sal)
      .input('por', sql.Int, porUsuario ?? null)
      .query(`
        SET NOCOUNT ON;
        IF NOT EXISTS (SELECT 1 FROM dbo.trabajadores_acceso WHERE user_id = @u)
            INSERT INTO dbo.trabajadores_acceso (user_id, creado_por) VALUES (@u, @por);
        UPDATE dbo.trabajadores_acceso
           SET pin_hash = @h, pin_sal = @s, pin_creado_en = SYSUTCDATETIME(),
               pin_fallos = 0, bloqueado_hasta = NULL,
               revocado_en = NULL, revocado_por = NULL
         WHERE user_id = @u;`);
    return { ok: true };
  }

  /**
   * ¿Es el PIN de este usuario? Cuenta el intento fallido y bloquea al quinto.
   * Respuesta uniforme ante usuario inexistente, sin PIN o PIN incorrecto: no
   * se le dice a quien prueba cuál de las tres pasó.
   */
  async function verificar(userId, pin) {
    const f = await leer(userId);
    if (!f || !f.pin_hash || f.revocado_en || !(f.active === true || f.active === 1)) {
      return { ok: false, error: 'PIN incorrecto.' };
    }
    if (f.bloqueado_hasta && new Date(f.bloqueado_hasta) > new Date()) {
      return { ok: false, bloqueado: true, error: 'Demasiados intentos. Espera unos minutos.' };
    }
    if (!pinCoincide(pin, f.pin_hash, f.pin_sal)) {
      const fallos = (f.pin_fallos || 0) + 1;
      await (await req()).input('id', sql.Int, f.id).input('f', sql.Int, fallos).input('min', sql.Int, BLOQUEO_MIN)
        .query(`UPDATE dbo.trabajadores_acceso
                   SET pin_fallos = CASE WHEN @f >= ${FALLOS_MAX} THEN 0 ELSE @f END,
                       bloqueado_hasta = CASE WHEN @f >= ${FALLOS_MAX} THEN DATEADD(MINUTE, @min, SYSUTCDATETIME()) ELSE bloqueado_hasta END
                 WHERE id = @id;`);
      return fallos >= FALLOS_MAX
        ? { ok: false, bloqueado: true, error: 'Demasiados intentos. Espera unos minutos.' }
        : { ok: false, error: 'PIN incorrecto.' };
    }
    await (await req()).input('id', sql.Int, f.id)
      .query('UPDATE dbo.trabajadores_acceso SET pin_fallos = 0, bloqueado_hasta = NULL WHERE id = @id;');
    return { ok: true, usuario: { id: Number(userId), usuario: f.usuario, rol: f.rol } };
  }

  return { tienePin, fijar, verificar };
}

module.exports = { crearPin, FALLOS_MAX, BLOQUEO_MIN };
