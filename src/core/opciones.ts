import { ModifierGroup, ModifierOption } from './menu-catalog.service';
import { SelectedOption } from './models';

/**
 * La regla de "qué opciones lleva una línea", en un solo sitio.
 *
 * EL FALLO QUE LO ORIGINA
 * -----------------------
 * En QA, Retail no podía vender el Caramel Macchiato (id 5) ni el Taro Latte
 * (id 7): *"no tiene receta configurada"*. La receta existía, pero solo la de
 * la variante (`variant_option_id = 1`, tamaño Chico). `sp_register_sale`
 * resuelve la receta contra las opciones de rol SIZE que trae la línea, y
 * Retail añadía SIEMPRE sin opciones:
 *
 *     this.cart.addProduct(CatalogService.toLineSource(p), 1);   // venta.ts:626
 *
 * Así que no es que Retail *perdiera* el `variant_option_id`: **nunca lo
 * determinaba**. Touch sí lo hacía, con su hoja de opciones.
 *
 * POR QUÉ UN MÓDULO Y NO UN ARREGLO EN LA PANTALLA
 * ------------------------------------------------
 * Porque la regla ya existía escrita en Touch —auto-seleccionar el grupo de
 * una sola opción, exigir los obligatorios— y copiarla en Retail habría dado
 * dos versiones de lo mismo, que es como se llega a que dos pantallas vendan
 * distinto. Aquí está la regla; las pantallas la consultan.
 *
 * Esto NO calcula la receta efectiva: de eso sigue encargándose SQL, que es la
 * única fuente de verdad para el inventario. Aquí solo se decide qué opciones
 * viajan en la línea.
 */

/** Lo que falta por elegir en un grupo, y cuántas opciones admite. */
export interface GrupoPendiente {
  grupo: ModifierGroup;
  minimo: number;
  /** true si el grupo se puede resolver solo (una única opción posible). */
  automatico: boolean;
}

/**
 * Opciones activas de un grupo, que son las únicas elegibles.
 *
 * `sp_get_menu_catalog` ya devuelve solo las activas, así que el tipo no lleva
 * `active`. El filtro se queda igualmente para los grupos que vengan de la
 * pantalla de administración, donde sí viajan las inactivas: una opción
 * desactivada no puede ser la que se auto-seleccione.
 */
export function opcionesElegibles(g: ModifierGroup): ModifierOption[] {
  return (g.options || []).filter(o => (o as { active?: boolean }).active !== false);
}

/** Cuántas opciones exige un grupo como mínimo. */
export function minimoDe(g: ModifierGroup): number {
  return g.required ? Math.max(1, g.min_select || 0) : (g.min_select || 0);
}

/**
 * Los grupos que hay que resolver antes de poder vender, con la misma regla
 * que ya aplicaba Touch.
 *
 * `automatico` marca los que no hace falta preguntar: un grupo obligatorio,
 * de selección única y con UNA sola opción activa no es una decisión, es un
 * dato. Preguntarlo sería pedirle al cajero que confirme lo obvio en cada
 * venta; no resolverlo es lo que dejaba a Retail sin variante.
 */
export function gruposPendientes(grupos: ModifierGroup[]): GrupoPendiente[] {
  return (grupos || [])
    .filter(g => (g as { active?: boolean }).active !== false)
    .map(g => {
      const minimo = minimoDe(g);
      const elegibles = opcionesElegibles(g);
      return {
        grupo: g,
        minimo,
        automatico: minimo > 0 && (g.max_select ?? 1) === 1 && elegibles.length === 1,
      };
    })
    .filter(p => p.minimo > 0);
}

/** Los grupos que SÍ hay que preguntarle a alguien. */
export function gruposQuePreguntar(grupos: ModifierGroup[]): GrupoPendiente[] {
  return gruposPendientes(grupos).filter(p => !p.automatico);
}

/**
 * TODO lo que hay que enseñar para configurar el producto: lo obligatorio y
 * lo opcional, en su orden, en una sola lista.
 *
 * POR QUE ESTA AQUI Y NO EN CADA PANTALLA
 * ---------------------------------------
 * Touch enseñaba todos los grupos del producto; Retail tenia su propia regla
 * privada -`gruposOpcionales`- y ademas encadenaba un modal por cada grupo
 * obligatorio antes de llegar a ella. Eran dos motores para la misma
 * pregunta, y en cuanto un producto tuvo tres grupos dejaron de coincidir.
 *
 * Lo unico que NO aparece es lo que ya esta decidido: un grupo obligatorio,
 * de eleccion unica y con una sola opcion activa no es una decision, es un
 * dato, y lo resuelve `seleccionAutomatica`.
 */
export function gruposAConfigurar(grupos: ModifierGroup[]): ModifierGroup[] {
  const automaticos = new Set(
    gruposPendientes(grupos).filter(p => p.automatico).map(p => p.grupo.id));
  return (grupos || [])
    .filter(g => (g as { active?: boolean }).active !== false)
    .filter(g => !automaticos.has(g.id))
    .filter(g => opcionesElegibles(g).length > 0);
}

/** Las opciones que se pueden dar por elegidas sin preguntar. */
export function seleccionAutomatica(grupos: ModifierGroup[]): SelectedOption[] {
  return gruposPendientes(grupos)
    .filter(p => p.automatico)
    .map(p => aSeleccionada(p.grupo, opcionesElegibles(p.grupo)[0]));
}

/** Convierte una opción del catálogo en la forma que viaja en la línea. */
export function aSeleccionada(g: ModifierGroup, o: ModifierOption): SelectedOption {
  return {
    groupId: g.id,
    optionId: o.id,
    groupName: g.name,
    optionName: o.name,
    priceDelta: Number(o.price_delta || 0),
    quantity: 1,
  };
}

/**
 * Qué le falta a una selección para estar completa.
 *
 * Es la misma comprobación que hacía `faltantes()` en Touch; vive aquí para
 * que Retail no tenga la suya propia.
 */
export function faltanPorElegir(
  grupos: ModifierGroup[],
  elegidasPorGrupo: Map<number, unknown[]>,
): ModifierGroup[] {
  return (grupos || [])
    .filter(g => (g as { active?: boolean }).active !== false)
    .filter(g => (elegidasPorGrupo.get(g.id) || []).length < minimoDe(g));
}


// ---------------------------------------------------------------------------
// LO QUE LA PANTALLA MUESTRA DE UNA SELECCION
// ---------------------------------------------------------------------------

/** Una línea de resumen: "Leche de almendra +$12", "Shot extra ×2 +$20". */
export interface ResumenOpcion {
  texto: string;
  delta: number;
}

/**
 * El precio que suman las opciones elegidas.
 *
 * Es el MISMO número que recalcula SQL antes de aceptar la venta
 * (`sp_register_sale`, bloque "precio de los modificadores"). Aquí se usa para
 * mostrarlo; allí para no fiarse de aquí. Si los dos no coinciden, la venta se
 * rechaza con un mensaje entendible en vez de cobrar una cosa y descontar otra.
 */
export function precioDeOpciones(opciones: SelectedOption[]): number {
  return (opciones || []).reduce(
    (a, o) => a + Number(o.priceDelta || 0) * Number(o.quantity || 1), 0);
}

/** El resumen legible de la selección, en el orden en que se eligió. */
export function resumenDeOpciones(opciones: SelectedOption[]): ResumenOpcion[] {
  return (opciones || []).map(o => {
    const n = Number(o.quantity || 1);
    const delta = Number(o.priceDelta || 0) * n;
    const veces = n > 1 ? ` ×${n}` : '';
    const precio = delta ? `  +$${delta.toFixed(2)}` : '';
    return { texto: `${o.optionName}${veces}${precio}`, delta };
  });
}

/** ¿Este grupo admite elegir la misma opción varias veces? */
export function admiteCantidad(g: ModifierGroup): boolean {
  // Solo tiene sentido en lo que SUMA consumo: dos shots son dos shots, pero
  // "dos veces sin azúcar" o "dos tamaños" no significan nada.
  return (g.options || []).some(o => o.effect === 'ADD');
}

/**
 * El tope de un grupo, en UNIDADES.
 *
 * QUE SIGNIFICA `max_select`
 * --------------------------
 * Cuenta unidades elegidas, no nombres distintos. Con `max_select = 3`:
 *
 *     Espresso x2 + Azucar x1  = 3 unidades   VALIDO
 *     Espresso x2 + Azucar x1 + Canela x1 = 4 unidades   NO
 *
 * Contar nombres dejaba entrar "Espresso x3 + Azucar x3 + Canela x3", nueve
 * shots en un vaso, porque cada opcion se topaba por separado contra el mismo
 * maximo. El grupo dice cuanto cabe en total; la cantidad de cada opcion es
 * como se reparte ese total.
 *
 * Un valor ausente o menor que 1 se lee como 1: un grupo sin tope declarado es
 * de eleccion unica, que es lo que hacia antes.
 */
export function topeDeGrupo(g: ModifierGroup): number {
  const m = Number(g.max_select ?? 1);
  return Number.isFinite(m) && m > 1 ? Math.floor(m) : 1;
}

/** El máximo razonable de repeticiones de una opción dentro de su grupo. */
export function maximoCantidad(g: ModifierGroup): number {
  return topeDeGrupo(g);
}

/** Una opción ya elegida, con la cantidad que lleva. */
export interface Elegida {
  optionId: number;
  quantity?: number;
}

/** Cuántas UNIDADES hay elegidas ya en un grupo. */
export function unidadesElegidas(elegidas: readonly Elegida[] | undefined): number {
  return (elegidas || []).reduce((a, e) => a + Math.max(1, Number(e.quantity ?? 1)), 0);
}

/** Lo que todavía cabe en el grupo. Nunca negativo. */
export function unidadesLibres(g: ModifierGroup, elegidas: readonly Elegida[] | undefined): number {
  return Math.max(0, topeDeGrupo(g) - unidadesElegidas(elegidas));
}

/**
 * Si cabe una unidad mas de `optionId` en el grupo.
 *
 * Es la MISMA pregunta para las dos pantallas: Touch al pulsar el `+` y Retail
 * al subir el contador. Tenerla escrita dos veces es como se llega a que una
 * caja acepte cuatro shots y la otra tres.
 */
export function cabeOtra(
  g: ModifierGroup,
  elegidas: readonly Elegida[] | undefined,
  optionId: number,
): boolean {
  const tope = topeDeGrupo(g);
  // Un grupo de eleccion unica no acumula: elegir sustituye, y de eso se
  // encarga quien llama. Aqui solo se responde que NO cabe una segunda.
  if (tope <= 1) return !(elegidas || []).some(e => e.optionId === optionId);
  return unidadesLibres(g, elegidas) > 0;
}


// ---------------------------------------------------------------------------
// CONFIGURAR UNA OPCION: QUE HACE FALTA SEGUN SU EFECTO
// ---------------------------------------------------------------------------

/** La forma mínima de una opción mientras se edita en Hospitality. */
export interface OpcionEditable {
  name: string;
  effect: 'NONE' | 'ADD' | 'REMOVE' | 'SUBSTITUTE' | 'SCALE';
  ingredientProductId: number | null;
  replacesProductId: number | null;
  qtyBase: number | null;
  qtyFactor: number | null;
}

/**
 * Qué le falta a una opción para poder guardarse.
 *
 * La base de datos ya lo impide con `CK_modifier_options_effect`, pero un
 * CHECK rechaza la fila con un mensaje de SQL Server que no le dice nada a
 * quien está configurando el menú: no nombra el campo ni la opción. Esta es la
 * misma regla, escrita para una persona y comprobada ANTES de guardar.
 *
 * Es la misma lista de condiciones del CHECK, a propósito: si una cambia, la
 * otra tiene que cambiar con ella, y tenerlas enfrentadas en una prueba es lo
 * que garantiza que no se separen.
 */
export function problemasDeOpcion(o: OpcionEditable): string[] {
  const malos: string[] = [];
  if (!String(o.name || '').trim()) malos.push('Falta el nombre.');

  switch (o.effect) {
    case 'ADD':
      // Un extra que no añade nada cobraría sin descontar: exactamente la
      // discrepancia entre precio e inventario que hay que evitar.
      if (!o.ingredientProductId) malos.push('Un extra necesita el ingrediente que agrega.');
      if (!(Number(o.qtyBase) > 0)) malos.push('Un extra necesita una cantidad mayor que cero.');
      break;
    case 'SUBSTITUTE':
      if (!o.ingredientProductId) malos.push('Una sustitución necesita el ingrediente que entra.');
      if (!o.replacesProductId) malos.push('Una sustitución necesita el ingrediente que reemplaza.');
      if (o.ingredientProductId && o.ingredientProductId === o.replacesProductId) {
        malos.push('El ingrediente que entra y el que sale no pueden ser el mismo.');
      }
      break;
    case 'REMOVE':
      if (!o.replacesProductId) malos.push('Un “sin…” necesita el ingrediente que quita.');
      break;
    case 'SCALE':
      if (!(Number(o.qtyFactor) > 0)) malos.push('Un tamaño por factor necesita un factor mayor que cero.');
      break;
    case 'NONE':
    default:
      break;
  }
  return malos;
}

/** ¿Se puede guardar tal y como está? */
export function opcionValida(o: OpcionEditable): boolean {
  return problemasDeOpcion(o).length === 0;
}

/**
 * ¿Este producto necesita que alguien elija algo antes de entrar al carrito?
 *
 * Se responde con los grupos ya cargados; no consulta nada. Un producto sin
 * grupos, o cuyos grupos se resuelven solos, entra de un toque.
 */
export function exigeElegir(grupos: ModifierGroup[]): boolean {
  return gruposQuePreguntar(grupos).length > 0;
}
