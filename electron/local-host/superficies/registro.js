/**
 * REGISTRO DE PANTALLAS OPERATIVAS.
 *
 * Una superficie es una interfaz para UNA funcion, no Wybix con menus
 * ocultos. Cada modulo registra las suyas aqui, con todo lo que las define:
 *
 *   tipo           PREPARATION, WAITER, STAFF_DAY, TECHNICIAN, INVENTORY_FLOOR,
 *                  CUSTOMER_STATUS. Los define Wybix (no hay tipos a medida).
 *   familia        ESTACION (la pantalla es un lugar: Cocina), TRABAJADOR
 *                  (alguien entra con QR/PIN) o PUBLICA (la ve el cliente).
 *   disponible     que capacidad del negocio la hace existir. Sin ella no se
 *                  ofrece ni se puede emparejar.
 *   identidad      NINGUNA | TRABAJADOR, y que persona puede usarla
 *                  (paquetes de permisos, si hace falta ser profesional).
 *   estado         lo que la pantalla puede VER. El servidor arma solo esos
 *                  campos: no se «ocultan en el frontend», no se envian.
 *   consultas      lecturas acotadas (buscar un producto, abrir una cuenta).
 *   acciones       lo que puede HACER, cada una con su modo sin conexion:
 *                    OFFLINE_SAFE      se puede encolar (idempotente)
 *                    ONLINE_REQUIRED   solo con conexion
 *                  Lo que no esta aqui no existe: cobrar no esta en ninguna.
 *   fuentes        de que tablas le interesan los cambios en tiempo real.
 *   evento         traduce un cambio de la base a un evento semantico
 *                  (PREPARATION_TICKET_CREATED, CLIENT_ARRIVED...) y dice si
 *                  suena. Nada de detalles de componentes de pantalla.
 *
 * Nadie mas decide «si es hospitality, KDS»: se pregunta al registro.
 */
const TIPOS = ['PREPARATION', 'WAITER', 'STAFF_DAY', 'TECHNICIAN', 'INVENTORY_FLOOR', 'CUSTOMER_STATUS'];
const FAMILIAS = ['ESTACION', 'TRABAJADOR', 'PUBLICA'];
const MODOS = ['OFFLINE_SAFE', 'OFFLINE_READONLY', 'ONLINE_REQUIRED'];

function crearRegistro() {
  const defs = new Map();

  function registrar(def) {
    if (!TIPOS.includes(def.tipo)) throw new Error(`Superficie desconocida: ${def.tipo}`);
    if (!FAMILIAS.includes(def.familia)) throw new Error(`${def.tipo}: familia no valida`);
    if (typeof def.disponible !== 'function' || typeof def.estado !== 'function') throw new Error(`${def.tipo}: falta disponible/estado`);
    if (def.familia === 'TRABAJADOR' && def.identidad !== 'TRABAJADOR') throw new Error(`${def.tipo}: una superficie de trabajador pide identidad`);
    for (const [nombre, a] of Object.entries(def.acciones || {})) {
      if (!/^[A-Z_]+$/.test(nombre)) throw new Error(`${def.tipo}: accion mal nombrada ${nombre}`);
      if (!MODOS.includes(a.modo)) throw new Error(`${def.tipo}.${nombre}: modo sin conexion no declarado`);
      if (typeof a.ejecutar !== 'function') throw new Error(`${def.tipo}.${nombre}: falta ejecutar`);
    }
    if (def.familia === 'PUBLICA' && Object.keys(def.acciones || {}).length) {
      throw new Error(`${def.tipo}: una superficie publica no tiene acciones`);
    }
    defs.set(def.tipo, Object.freeze({ acciones: {}, consultas: {}, fuentes: [], sesion: {}, ...def }));
  }

  const obtener = (tipo) => defs.get(tipo) || null;
  const todas = () => [...defs.values()];
  /** Las que este negocio puede usar HOY. */
  const disponibles = (caps) => todas().filter(d => d.disponible(caps));

  /** Lo que la pantalla (y la administracion) necesita saber de una superficie. */
  function publica(d) {
    return {
      tipo: d.tipo,
      familia: d.familia,
      nombre: d.nombre,
      descripcion: d.descripcion,
      icono: d.icono,
      identidad: d.identidad,
      sonido: d.sonido || null,
      requiereEstacion: !!d.requiereEstacion,
      acciones: Object.entries(d.acciones || {}).map(([nombre, a]) => ({ nombre, modo: a.modo })),
      consultas: Object.keys(d.consultas || {}),
    };
  }

  return { registrar, obtener, todas, disponibles, publica, TIPOS };
}

module.exports = { crearRegistro, TIPOS, MODOS };
