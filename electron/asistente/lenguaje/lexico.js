'use strict';
/**
 * EL LÉXICO: lo que hace que Wybix entienda palabras que nunca vio en una
 * frase de entrenamiento. Es la parte «semántica» del intérprete, escrita a
 * mano en vez de aprendida por una red: cada palabra apunta a un CONCEPTO,
 * y el clasificador ve el concepto además de la palabra.
 *
 *   «cuánta feria hay» y «cuánto efectivo hay» comparten #DINERO
 *   «cancélala», «cancelo», «cancelación» comparten la raíz «cancel»
 *
 * Así, una frase con «morralla» se parece a las frases de «cambio» y de
 * «efectivo» aunque «morralla» no esté en ninguna.
 *
 * Agregar jerga nueva es agregar la palabra a su concepto. Si es de una
 * región o de un giro, aquí también.
 */

const { raiz } = require('./normalizar');

const CONCEPTOS = {
  DINERO: 'dinero feria lana varo varos efectivo billetes billete morralla monedas cash plata pesos baro',
  CAJA: 'caja cajon cajas registradora fondo arqueo',
  CAMBIO: 'cambio morralla sencillo monedas',
  VENDER: 'vender vendi vendimos vendido vendida vendio venden vende venta ventas vendiendo sale salen salio jala despacho despache cobrado facturado entrado entro',
  COMPRAR: 'comprar compre compramos compro compra compras comprado surtir surtieron surte resurtir pedir pido pedido pedidos encargar encargo abastecer mayoreo mercado central super',
  ACABAR: 'acaba acabo acabaron acabando agota agotado agotados agoto agotaron termino terminando terminado falta faltan faltando ceros cero nada',
  QUEDAR: 'queda quedan quedo quede hay tengo tenemos existencia existencias stock inventario disponible',
  PRECIO: 'precio precios cuesta cuestan vale valen cobro cobras cobramos damos das sale costo',
  CAMBIAR: 'cambia cambiale cambiar modifica modificar actualiza actualizar pon ponle poner sube subele baja bajale aumenta rebaja ajusta',
  GANAR: 'gano gane ganamos ganado ganancia ganancias utilidad utilidades margen deja rentable rentabilidad redituable beneficio',
  GASTO: 'gasto gastos gaste gastado gastaron gastamos egreso egresos recibo recibos servicio servicios luz agua gas renta internet sueldos nomina raya',
  DEBER: 'debe deben debo debes adeudo adeudos fiado fiados fie fio credito saldo vencido vencida atrasado cuenta cuentas',
  PAGAR: 'paga pagar pague pagale pagamos pagaron pago pagos abono abonos abona abonar abonale abonaron liquida liquidar liquido liquidale deposite deposito transferi transferencia',
  CLIENTE: 'cliente clientes comprador compradores marchante marchantes consumidor gente señora senora señor senor vecina vecino',
  PROVEEDOR: 'proveedor proveedores distribuidor distribuidora repartidor camion agente',
  PERSONAL: 'cajero cajeros empleado empleados trabajador trabajadores personal mesero meseros chalan chalanes vendedor vendedora muchacho muchacha nuevo',
  HORA: 'hora horas horario horarios pico tarde manana noche mediodia temprano',
  CITA: 'cita citas agenda agendar agendale aparta apartale reserva reservale turno lugar espacio hueco disponible',
  CANCELAR: 'cancela cancelar cancelo cancelala cancelacion anula anular quita quitala borra borrala elimina',
  MOVER: 'mueve muevela muevelo mover recorre recorrela pasa pasala reprograma reprogramar pospon cambiala',
  MESA: 'mesa mesas salon comensales cuenta cuentas',
  COCINA: 'cocina comanda comandas orden ordenes barra platillo platillos preparando preparar listo lista',
  RECETA: 'receta recetas ingredientes ingrediente lleva contiene formula hecho preparacion prepara',
  PRODUCIR: 'producir produccion produce producido hornear horneo hornean horno tanda tandas preparar hacer hacemos hicieron cocinar',
  MERMA: 'merma mermas tirar tira tiramos tiraron basura cayo cayeron cayo rompio rompieron reventaron quebraron quemaron caduco caducaron vencieron pudrieron echaron perder mojaron aplasto derramo desperdicio',
  DEVOLVER: 'devolucion devolver devolvieron devuelve regresar regresa regresaron reembolso reembolsa',
  FACTURA: 'factura facturas facturar facturame facturale timbrar timbra timbrado cfdi',
  AYUDA: 'ayuda ayudame ayudas puedes sabes entiendes comandos funcionas usarte sirves robot',
  ENSENAR: 'como donde pasos ensename explicame tutorial',
  SALUDO: 'hola buenos buenas buen dia tardes noches onda tal hey gracias adios bye vemos',
  ABRIR: 'abre abrir abreme llevame lleva ve ir entra pasame mandame regresame muestrame pantalla modulo',
  SISTEMA: 'sistema respaldo respaldos nube licencia impresora internet disco computadora sincroniza sincronizando actualizado conectado',
  PROBLEMA: 'problema problemas mal falla fallando urgente pendiente pendientes alerta alertas aviso avisos revisar raro',
  CUMPLE: 'cumple cumpleanos cumplen cumpleaneros felicitar felicito',
  PUNTOS: 'puntos monedero sellos premio recompensa acumulado visitas',
  ASISTENCIA: 'vino vinieron llego llegaron falto faltaron checo checaron asistencia retardo retardos descanso entrada',
  COMPARAR: 'compara comparar contra comparado diferencia antes pasada pasado anterior bajaron subieron baje subi creciendo crecer peor mejor',
  MAS: 'mas top estrella popular mejor mejores favorito pedido',
  MENOS: 'menos parado parada estancado muerto rezagado empolvando rota rotacion sobra',
  ALTA: 'alta agrega agregar crea crear registra registrar nuevo nueva',
  TRASPASO: 'traspaso traspasa traspasos transfiere sucursal sucursales tienda',
  CORTE: 'corte cortes cortar cierre cerrar cierra entregar turno',
  PEDIDO_LINEA: 'linea internet whatsapp pedidos llevar domicilio',
  PROPINA: 'propina propinas tips',
  MEMBRESIA: 'membresia membresias mensualidad mensualidades renovar socio socios vence vencen',
  TALLER: 'taller reparacion reparaciones equipo equipos carro carros refaccion autorizar',
  DATOS: 'datos info informacion telefono numero correo contacto whatsapp rfc ficha codigo clave',
  MOVIMIENTO: 'movimientos kardex historial entradas salidas paso movio',
  VALOR: 'valor vale valdria invertido capital mercancia',
};

/** palabra (y su raíz y su lema) → [conceptos]. Se llena al final del archivo. */
const MAPA = new Map();

/* Pronombres pegados al verbo: «pagale», «cancelala», «agendame». */
const CLITICOS = /(selo|sela|selos|selas|le|la|lo|les|las|los|me|te|nos)$/;
/* Terminaciones de verbo y de palabra, de la más larga a la más corta. */
const SUFIJOS = ['aremos', 'eremos', 'iremos', 'ieron', 'aron', 'ando', 'iendo', 'ados', 'idos', 'adas', 'idas', 'amos', 'emos', 'imos',
  'aste', 'iste', 'aba', 'ian', 'ia', 'ado', 'ido', 'ada', 'ida', 'ara', 'era', 'ira', 'ar', 'er', 'ir', 'an', 'en', 'as', 'es', 'os',
  'cion', 'o', 'a', 'e'];

/**
 * Raíz «de verbo» para comparar conjugaciones: «cancelala» → «cancel»,
 * «vendimos» → «vend», «pagaron» → «pag». Deja al menos 3 letras.
 */
function lema(w) {
  if (w.length < 5 || /\d|^</.test(w)) return w;
  let s = w;
  if (s.length > 6 && CLITICOS.test(s)) {
    const sin = s.replace(CLITICOS, '');
    if (/(a|e|i)$/.test(sin) && sin.length >= 4) s = sin;
  }
  for (const suf of SUFIJOS) {
    if (s.endsWith(suf) && s.length - suf.length >= 3) { s = s.slice(0, -suf.length); break; }
  }
  return s;
}

/** Conceptos de una palabra (por la palabra, su raíz sin plural o su lema). */
function conceptos(w) {
  return MAPA.get(w) || MAPA.get(raiz(w)) || MAPA.get(lema(w)) || [];
}

for (const [c, palabras] of Object.entries(CONCEPTOS)) {
  for (const w of palabras.split(/\s+/)) {
    if (!w) continue;
    for (const k of new Set([w, raiz(w), lema(w)])) {
      const a = MAPA.get(k) || [];
      if (!a.includes(c)) a.push(c);
      MAPA.set(k, a);
    }
  }
}

/**
 * Palabras comunes del español que NO son dedazos aunque Wybix no las haya
 * visto en una frase: el corrector no las toca («poder» no es «poner»).
 */
const COMUNES = new Set(`poder puede pueden pudo venir viene vienen vino llegar llega salir sale salio entrar entra hacer hace hizo
  decir dice dijo saber sabe ver veo ves dar doy dio querer quiere quiero tener tiene tengo poner pone puso traer trae trajo
  llevar lleva llevo pasar pasa paso quedar queda quedo deber debe debo seguir sigue empezar empieza terminar termina
  necesitar necesito ocupar ocupo buscar busca encontrar encuentra pensar creo parece conviene convenir gustar gusta
  hablar hablo llamar llamo esperar espera abrir cierra cerrar volver vuelve regresar regresa mandar manda enviar envia
  ayer hoy manana tarde noche temprano ahora ahorita luego despues antes siempre nunca todavia tambien solo mucho poco
  bastante demasiado casi muy mas menos mejor peor mismo misma otro otra todos todas cada algun alguna ningun ninguna
  semana mes ano dia dias hora horas minutos rato vez veces primero ultimo ultima siguiente pasado pasada proximo
  bueno buena malo mala grande chico chica nuevo nueva viejo vieja caro cara barato barata lleno vacio frio caliente
  tienda negocio local cliente gente persona personas señor señora muchacho muchacha chavo chava jefe dueño patron
  dinero cosa cosas parte lado aqui alla ahi donde cuando como cuanto cuantos cuantas cual cuales quien quienes porque
  ranking lista total resumen promedio reporte cuenta cuentas numero numeros precio favor gracias ok bien mal igual`.split(/\s+/).filter(Boolean));

module.exports = { lema, conceptos, CONCEPTOS, COMUNES };
