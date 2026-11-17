/**
 * FRASES DE PRUEBA DEL INTÉRPRETE — escritas como las escribe la gente en un
 * mostrador, NO como las plantillas del corpus. El clasificador nunca las ve
 * al entrenar: miden si generaliza.
 *
 * Cada caso: [texto, intent esperado, datos esperados]. En los datos:
 *   cantidad  número
 *   producto  nombre exacto del catálogo de prueba, o '?' si debe preguntar
 *   precio    número
 *   fecha     'hoy' | 'manana' | 'pasado'
 *   motivo    CADUCADO | SE_CAYO | MAL_HECHO | DEGUSTACION
 *   destino   ruta
 *   nombre    nombre del producto nuevo
 */
export const CATALOGO = [
  'Dona glaseada', 'Dona de chocolate', 'Dona rellena de cajeta', 'Concha', 'Latte chico', 'Latte grande', 'Capuchino',
  'Americano', 'Leche entera', 'Leche deslactosada', 'Café en grano', 'Harina', 'Azúcar', 'Coca Cola 600 ml', 'Sabritas',
  'Garrafón 20 L', 'Pan de muerto', 'Galleta de avena', 'Agua natural', 'Frappé de moka', 'Croissant',
].map((nombre, i) => ({ id: i + 1, nombre }));

export const CATEGORIAS = [{ id: 1, nombre: 'Bebidas' }, { id: 2, nombre: 'Panadería' }, { id: 3, nombre: 'Abarrotes' }];

export const CASOS = [
  // ------------------------------------------------------------ merma
  ['registra merma de 6 donas glaseadas', 'merma.registrar', { cantidad: 6, producto: 'Dona glaseada' }],
  ['se cayeron 3 conchas', 'merma.registrar', { cantidad: 3, producto: 'Concha', motivo: 'SE_CAYO' }],
  ['tiramos 4 donas de chocolate caducadas', 'merma.registrar', { cantidad: 4, producto: 'Dona de chocolate', motivo: 'CADUCADO' }],
  ['merma 2 croissant', 'merma.registrar', { cantidad: 2, producto: 'Croissant' }],
  ['se me cayo una dona glaseada', 'merma.registrar', { cantidad: 1, producto: 'Dona glaseada', motivo: 'SE_CAYO' }],
  ['oye wybix se echaron a perder seis conchas', 'merma.registrar', { cantidad: 6, producto: 'Concha', motivo: 'CADUCADO' }],
  ['media docena de donas de chocolate a la basura', 'merma.registrar', { cantidad: 6, producto: 'Dona de chocolate' }],
  ['se quemaron 8 conchas en el horno', 'merma.registrar', { cantidad: 8, producto: 'Concha', motivo: 'MAL_HECHO' }],
  ['dar de baja 5 pan de muerto por caducidad', 'merma.registrar', { cantidad: 5, producto: 'Pan de muerto', motivo: 'CADUCADO' }],
  ['regalamos 2 croissants de degustacion', 'merma.registrar', { cantidad: 2, producto: 'Croissant', motivo: 'DEGUSTACION' }],
  ['registra merma de 6 donas', 'merma.registrar', { cantidad: 6, producto: '?' }],
  ['merma', 'merma.registrar', {}],
  ['anota que se rompieron 2 galletas de avena', 'merma.registrar', { cantidad: 2, producto: 'Galleta de avena', motivo: 'SE_CAYO' }],
  ['hay que tirar 10 donas rellenas de cajeta', 'merma.registrar', { cantidad: 10, producto: 'Dona rellena de cajeta' }],
  ['caducaron 3 coca colas', 'merma.registrar', { cantidad: 3, producto: 'Coca Cola 600 ml', motivo: 'CADUCADO' }],
  ['pon merma de 12 conchas', 'merma.registrar', { cantidad: 12, producto: 'Concha' }],
  ['descuenta 3 sabritas que se abrieron', 'merma.registrar', { cantidad: 3, producto: 'Sabritas' }],
  ['salieron mal 4 donas glaseadas', 'merma.registrar', { cantidad: 4, producto: 'Dona glaseada', motivo: 'MAL_HECHO' }],
  ['quiero registrar una merma', 'merma.registrar', {}],
  ['se nos cayo la charola, fueron 7 donas de chocolate', 'merma.registrar', { cantidad: 7, producto: 'Dona de chocolate', motivo: 'SE_CAYO' }],

  // -------------------------------------------------- producción
  ['que me falta comprar para producir 150 donas glaseadas manana', 'produccion.faltantes', { cantidad: 150, producto: 'Dona glaseada', fecha: 'manana' }],
  ['me alcanza para hacer 80 conchas?', 'produccion.faltantes', { cantidad: 80, producto: 'Concha' }],
  ['que necesito para 200 donas de chocolate', 'produccion.faltantes', { cantidad: 200, producto: 'Dona de chocolate' }],
  ['tengo suficiente harina para 100 conchas', 'produccion.faltantes', { cantidad: 100, producto: 'Concha' }],
  ['alcanza para cincuenta pan de muerto', 'produccion.faltantes', { cantidad: 50, producto: 'Pan de muerto' }],
  ['si quiero hacer 300 donas glaseadas el sabado que me falta', 'produccion.faltantes', { cantidad: 300, producto: 'Dona glaseada' }],
  ['puedo hacer 60 croissants hoy', 'produccion.faltantes', { cantidad: 60, producto: 'Croissant', fecha: 'hoy' }],
  ['planea 120 donas glaseadas para manana', 'produccion.planear', { cantidad: 120, producto: 'Dona glaseada', fecha: 'manana' }],
  ['vamos a hornear 60 conchas hoy', 'produccion.planear', { cantidad: 60, producto: 'Concha', fecha: 'hoy' }],
  ['programa una tanda de 48 donas de chocolate', 'produccion.planear', { cantidad: 48, producto: 'Dona de chocolate' }],
  ['manana vamos a hacer 100 pan de muerto', 'produccion.planear', { cantidad: 100, producto: 'Pan de muerto', fecha: 'manana' }],
  ['pon a producir 30 croissants', 'produccion.planear', { cantidad: 30, producto: 'Croissant' }],
  ['quiero producir 200 donas glaseadas pasado manana', 'produccion.planear', { cantidad: 200, producto: 'Dona glaseada', fecha: 'pasado' }],
  ['nueva tanda de 24 conchas', 'produccion.planear', { cantidad: 24, producto: 'Concha' }],

  // ------------------------------------------------------- precios
  ['cambia el precio del latte grande a 65', 'producto.precio', { producto: 'Latte grande', precio: 65 }],
  ['sube la concha a $14', 'producto.precio', { producto: 'Concha', precio: 14 }],
  ['ahora el capuchino cuesta 55 pesos', 'producto.precio', { producto: 'Capuchino', precio: 55 }],
  ['pon el americano en 38', 'producto.precio', { producto: 'Americano', precio: 38 }],
  ['bajale a la coca cola a 20', 'producto.precio', { producto: 'Coca Cola 600 ml', precio: 20 }],
  ['el frappe de moka va a costar $72', 'producto.precio', { producto: 'Frappé de moka', precio: 72 }],
  ['dona glaseada a $18', 'producto.precio', { producto: 'Dona glaseada', precio: 18 }],
  ['nuevo precio latte chico 45', 'producto.precio', { producto: 'Latte chico', precio: 45 }],
  ['quiero cambiar el precio del latte', 'producto.precio', { producto: '?' }],
  ['ponle 25 pesos al agua natural', 'producto.precio', { producto: 'Agua natural', precio: 25 }],
  ['subele 2 pesos a la concha', 'producto.precio', { producto: 'Concha', delta: 2 }],
  ['bajale 5 pesos al capuchino', 'producto.precio', { producto: 'Capuchino', delta: -5 }],

  // --------------------------------------------------- crear producto
  ['crea producto pay de queso a $45', 'producto.crear', { nombre: 'Pay de queso', precio: 45 }],
  ['dar de alta agua de jamaica en 25 pesos', 'producto.crear', { nombre: 'Agua de jamaica', precio: 25 }],
  ['nuevo producto torta de jamon 55', 'producto.crear', { nombre: 'Torta de jamon', precio: 55 }],
  ['agrega al catalogo cafe de olla a 30', 'producto.crear', { nombre: 'Cafe de olla', precio: 30 }],
  ['quiero vender chilaquiles a $85', 'producto.crear', { nombre: 'Chilaquiles', precio: 85 }],
  ['crear un producto nuevo', 'producto.crear', {}],

  // ---------------------------------------------------- consultas
  ['como voy hoy', 'consulta.hoy', {}],
  ['cuanto llevamos vendido', 'consulta.hoy', {}],
  ['cuanto vendimos ayer', 'consulta.hoy', {}],
  ['como van las ventas de la semana', 'consulta.hoy', {}],
  ['cuantos tickets llevo', 'consulta.hoy', {}],
  ['resumen del dia porfa', 'consulta.hoy', {}],
  ['cuantas donas glaseadas quedan', 'consulta.existencia', { producto: 'Dona glaseada' }],
  ['hay leche deslactosada?', 'consulta.existencia', { producto: 'Leche deslactosada' }],
  ['cuanto cafe en grano tenemos', 'consulta.existencia', { producto: 'Café en grano' }],
  ['todavia quedan conchas', 'consulta.existencia', { producto: 'Concha' }],
  ['existencia de harina', 'consulta.existencia', { producto: 'Harina' }],
  ['cuanta leche me queda', 'consulta.existencia', { producto: '?' }],
  ['que me falta comprar', 'consulta.comprar', {}],
  ['que se esta acabando', 'consulta.comprar', {}],
  ['arma la lista de compras', 'consulta.comprar', {}],
  ['que le tengo que pedir al proveedor', 'consulta.comprar', {}],
  ['que productos estan por terminarse', 'consulta.comprar', {}],
  ['que pendientes tengo', 'consulta.pendientes', {}],
  ['hay algo mal en mi negocio', 'consulta.pendientes', {}],
  ['que me recomiendas revisar', 'consulta.pendientes', {}],
  ['como ves el negocio', 'consulta.pendientes', {}],
  ['cuanto le gano al latte grande', 'consulta.ganancia', { producto: 'Latte grande' }],
  ['que margen tiene la dona glaseada', 'consulta.ganancia', { producto: 'Dona glaseada' }],
  ['es rentable el frappe de moka', 'consulta.ganancia', { producto: 'Frappé de moka' }],
  ['cuanto me cuesta hacer un capuchino', 'consulta.ganancia', { producto: 'Capuchino' }],

  // ------------------------------------------------- navegación
  ['abre inventario', 'ir_a', { destino: '/dashboard/inventario' }],
  ['llevame a compras', 'ir_a', { destino: '/dashboard/compras' }],
  ['quiero ver los clientes', 'ir_a', { destino: '/dashboard/clientes' }],
  ['abre produccion', 'ir_a', { destino: '/dashboard/produccion' }],
  ['ir al cierre del dia', 'ir_a', { destino: '/dashboard/cierre-dia' }],
  ['muestrame los gastos', 'ir_a', { destino: '/dashboard/egresos' }],

  // ------------------------------------------------- conversación
  ['hola', 'saludo', {}],
  ['buenos dias wybix', 'saludo', {}],
  ['gracias', 'saludo', {}],
  ['que puedes hacer', 'ayuda', {}],
  ['como te uso', 'ayuda', {}],
  ['ayuda', 'ayuda', {}],
  // ------------------------------------------- segunda ronda: tienda y coloquial
  ['se reventaron 2 coca colas', 'merma.registrar', { cantidad: 2, producto: 'Coca Cola 600 ml', motivo: 'SE_CAYO' }],
  ['se rompio un garrafon', 'merma.registrar', { cantidad: 1, producto: 'Garrafón 20 L', motivo: 'SE_CAYO' }],
  ['merma de 3 sabritas caducadas', 'merma.registrar', { cantidad: 3, producto: 'Sabritas', motivo: 'CADUCADO' }],
  ['hubo que tirar 4 aguas naturales', 'merma.registrar', { cantidad: 4, producto: 'Agua natural' }],
  ['registrame una merma de 2 frappes de moka', 'merma.registrar', { cantidad: 2, producto: 'Frappé de moka' }],
  ['echale merma a 5 conchas', 'merma.registrar', { cantidad: 5, producto: 'Concha' }],
  ['que tal vamos hoy', 'consulta.hoy', {}],
  ['dime cuanto llevo', 'consulta.hoy', {}],
  ['cuanto vendi la semana pasada', 'consulta.hoy', {}],
  ['cuanto dinero ha entrado hoy', 'consulta.hoy', {}],
  ['como cerramos ayer', 'consulta.hoy', {}],
  ['cuantas cocas me quedan', 'consulta.existencia', { producto: 'Coca Cola 600 ml' }],
  ['tengo garrafones', 'consulta.existencia', { producto: 'Garrafón 20 L' }],
  ['cuantas sabritas hay', 'consulta.existencia', { producto: 'Sabritas' }],
  ['me queda azucar', 'consulta.existencia', { producto: 'Azúcar' }],
  ['pasame a inventario', 'ir_a', { destino: '/dashboard/inventario' }],
  ['quiero ver las ventas', 'ir_a', { destino: '/dashboard/venta' }],
  ['abre proveedores', 'ir_a', { destino: '/dashboard/proveedores' }],
  ['precio de la coca a 22', 'producto.precio', { producto: 'Coca Cola 600 ml', precio: 22 }],
  ['la coca ahora en 22 pesos', 'producto.precio', { producto: 'Coca Cola 600 ml', precio: 22 }],
  ['cambiar el precio de sabritas a $19', 'producto.precio', { producto: 'Sabritas', precio: 19 }],
  ['sube el garrafon a 45', 'producto.precio', { producto: 'Garrafón 20 L', precio: 45 }],
  ['aumentale 3 pesos al capuchino', 'producto.precio', { producto: 'Capuchino', delta: 3 }],
  ['cuanto le gano a la coca', 'consulta.ganancia', { producto: 'Coca Cola 600 ml' }],
  ['que tanto me deja el garrafon', 'consulta.ganancia', { producto: 'Garrafón 20 L' }],
  ['que se me esta terminando', 'consulta.comprar', {}],
  ['que pido al proveedor', 'consulta.comprar', {}],
  ['necesito surtir algo', 'consulta.comprar', {}],
  ['algun problema', 'consulta.pendientes', {}],
  ['dame un resumen de pendientes', 'consulta.pendientes', {}],
  ['planea 50 conchas', 'produccion.planear', { cantidad: 50, producto: 'Concha' }],
  ['hoy hay que hacer 90 donas glaseadas', 'produccion.planear', { cantidad: 90, producto: 'Dona glaseada', fecha: 'hoy' }],
  ['me alcanzan los ingredientes para 40 croissants', 'produccion.faltantes', { cantidad: 40, producto: 'Croissant' }],
  ['que ocupo para hacer 70 conchas', 'produccion.faltantes', { cantidad: 70, producto: 'Concha' }],
  ['da de alta galletas de nuez a 15 pesos', 'producto.crear', { nombre: 'Galletas de nuez', precio: 15 }],
  ['quiero agregar un producto nuevo: tamal de rajas a $25', 'producto.crear', { nombre: 'Tamal de rajas', precio: 25 }],
  ['buenas', 'saludo', {}],
  ['muchas gracias wybix', 'saludo', {}],
  ['no se que hacer, ayudame', 'ayuda', {}],
  // ------------------------------------------- tercera ronda: lo más difícil
  ['merma de dos docenas de conchas', 'merma.registrar', { cantidad: 24, producto: 'Concha' }],
  ['planea cien donas glaseadas para el viernes', 'produccion.planear', { cantidad: 100, producto: 'Dona glaseada' }],
  ['que me falta para hacer doscientas conchas', 'produccion.faltantes', { cantidad: 200, producto: 'Concha' }],
  ['se cayeron 3 dnoas glaseadas', 'merma.registrar', { cantidad: 3, producto: 'Dona glaseada', motivo: 'SE_CAYO' }],
  ['cuantos capuchinso me quedan', 'consulta.existencia', { producto: 'Capuchino' }],
  ['precio del late grande a 62', 'producto.precio', { producto: 'Latte grande', precio: 62 }],
  ['cocas a 21', 'producto.precio', { producto: 'Coca Cola 600 ml', precio: 21 }],
  ['6 conchas merma', 'merma.registrar', { cantidad: 6, producto: 'Concha' }],
  ['conchas cuantas hay', 'consulta.existencia', { producto: 'Concha' }],
  ['ventas hoy', 'consulta.hoy', {}],
  ['inventario', 'ir_a', { destino: '/dashboard/inventario' }],
  ['compras', 'ir_a', { destino: '/dashboard/compras' }],
  ['lista del super', 'consulta.comprar', {}],
  ['que hay que reponer', 'consulta.comprar', {}],
  ['ganancia del capuchino', 'consulta.ganancia', { producto: 'Capuchino' }],
  ['tanda de 36 croissants manana', 'produccion.planear', { cantidad: 36, producto: 'Croissant', fecha: 'manana' }],
  ['3 frappes de moka se tiraron', 'merma.registrar', { cantidad: 3, producto: 'Frappé de moka' }],
  ['que debo atender', 'consulta.pendientes', {}],
  ['oye que onda', 'saludo', {}],
  // ------------------------------------------- análisis (analitica/)
  ['cuantas conchas voy a vender manana', 'analisis.pronostico', { producto: 'Concha', fecha: 'manana' }],
  ['cuanto voy a vender hoy', 'analisis.pronostico', { fecha: 'hoy' }],
  ['cuantos croissants horneo para manana', 'analisis.pronostico', { producto: 'Croissant', fecha: 'manana' }],
  ['cuando se me acaba la leche entera', 'analisis.agotar', { producto: 'Leche entera' }],
  ['para cuantos dias me alcanza el azucar', 'analisis.agotar', { producto: 'Azúcar' }],
  ['si subo la concha a 14 cuanto gano', 'analisis.simular', { producto: 'Concha', precio: 14 }],
  ['y si le subo 2 pesos al latte grande', 'analisis.simular', { producto: 'Latte grande', delta: 2 }],
  ['me conviene bajar el capuchino a 45', 'analisis.simular', { producto: 'Capuchino', precio: 45 }],
  ['por que vendi menos esta semana', 'venta.comparar', {}],
  ['por que bajo la venta de concha', 'venta.comparar', { producto: 'Concha' }],
  ['cuanto vendi los sabados despues de las 6', 'consulta.hoy', {}],
  ['cuanto vendi en octubre', 'consulta.hoy', {}],
  ['que se vende mas en la manana', 'venta.top', {}],
  ['a que hora vendo mas los domingos', 'venta.horas', {}],
];

/** Lo que NO debe entenderse como ninguna orden (debe responder «no te entendí»). */
/* Frases de otro tema: Wybix no debe actuar con ellas (seguridad < 0.45 → pregunta o dice que no entendió). */
export const RUIDO = ['asdf qwer', 'el perro de mi vecino', 'xyz 123 abc', 'jajaja', 'mmm', 'mi gato se llama pancho', 'que bonito dia',
  'la pelicula de anoche', 'quien gano el partido', 'cuentame un chiste', 'el clima de mañana', 'me duele la cabeza',
  'tengo sueño', 'que hora es en japon', 'mi abuela cumple ochenta y cinco', 'cual es la capital de francia'];
