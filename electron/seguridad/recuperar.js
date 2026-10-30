/**
 * CAMBIAR UNA CONTRASEÑA OLVIDADA, DESDE EL INICIO DE SESIÓN, CON EL PIN PROPIO.
 *
 * POR QUÉ EXISTE
 * --------------
 * Hasta ahora solo un administrador cambiaba una contraseña. Si el dueño no
 * está -de viaje, sin teléfono, un domingo-, quien olvidó la suya no puede
 * trabajar. Aquí la persona la cambia sola, sin nadie más.
 *
 * CÓMO SE EVITA QUE ALGUIEN CAMBIE LA DE OTRO
 * -------------------------------------------
 * Con su PIN personal: el mismo de Local Host y de las autorizaciones en caja
 * (`trabajadores_acceso`, scrypt con sal propia). Saber el usuario de otra
 * persona no basta; hace falta su PIN, que solo ella conoce. Y:
 *
 *   · el bloqueo es el del PIN: 5 fallos, 5 minutos, en la base, para todas
 *     las cajas a la vez. No se puede probar PIN tras PIN;
 *   · la respuesta es la misma si el usuario no existe, no tiene PIN o el PIN
 *     no es suyo: quien prueba no aprende cuál de las tres pasó;
 *   · quien no tiene PIN no puede usar esto: se lo asigna un administrador
 *     (Usuarios y permisos) o le cambia la contraseña;
 *   · queda en `security_events` (CONTRASENA_CON_PIN), para que el dueño vea
 *     que pasó y cuándo.
 *
 * No abre sesión: después de cambiarla, la persona entra como siempre.
 */
const MIN_CONTRASENA = 6;
const GENERICO = 'Usuario o PIN incorrectos.';

function crearRecuperacion({ sql, pool, pin, contrasenas }) {
  const req = async () => (await pool()).request();

  return async function recuperar({ usuario, pin: elPin, nueva } = {}) {
    const u = String(usuario ?? '').trim();
    const p = String(elPin ?? '').trim();
    const n = String(nueva ?? '');
    if (!u || !p) return { ok: false, error: 'Escribe tu usuario y tu PIN.' };
    if (n.length < MIN_CONTRASENA) return { ok: false, error: `La contraseña nueva debe tener al menos ${MIN_CONTRASENA} caracteres.` };
    if (n === p) return { ok: false, error: 'La contraseña no puede ser igual a tu PIN.' };

    const r = await (await req()).input('u', sql.NVarChar(50), u)
      .query('SELECT id FROM dbo.users WHERE usuario = @u AND active = 1;');
    const id = Number(r.recordset?.[0]?.id) || 0;
    /* Sin usuario se verifica igual (contra el id 0, que no existe): misma
       respuesta y casi el mismo tiempo que un PIN equivocado. */
    const v = await pin.verificar(id, p);
    if (!v.ok) return { ok: false, bloqueado: !!v.bloqueado, error: v.bloqueado ? v.error : GENERICO };

    await (await req()).input('id', sql.Int, id).input('hash', sql.NVarChar(255), contrasenas.hashear(n))
      .query('UPDATE dbo.users SET password_hash = @hash WHERE id = @id;');
    try {
      await (await req()).input('id', sql.Int, id)
        .query(`INSERT INTO dbo.security_events (datee, user_id, event_type, detail)
                VALUES (SYSDATETIME(), @id, N'CONTRASENA_CON_PIN', N'Cambió su contraseña con su PIN desde el inicio de sesión');`);
    } catch { /* la bitácora no frena el cambio: la contraseña ya quedó */ }
    return { ok: true };
  };
}

module.exports = { crearRecuperacion, MIN_CONTRASENA, GENERICO };
