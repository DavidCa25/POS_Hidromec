/**
 * Ilustraciones de productos sin foto (shared/ilustraciones.ts).
 *
 *   npm run test:ilustraciones
 *
 *  1. El catálogo tiene al menos 400 formas, sin ids repetidos.
 *  2. Cada palabra clave de cada forma lleva a esa forma (o a su envase).
 *  3. Nombres reales de menús y catálogos, por giro, caen en su dibujo.
 *  4. Envase contra preparado: medida o comercio → envase; restaurante → preparado.
 *  5. Una clave compartida entre producto y servicio la decide el giro.
 *  6. Sin pista: categoría, luego giro y preset de servicios.
 *  7. Determinista: mismo producto, misma forma y color; otro id, otro color.
 *  8. Todo dibujo es válido: números finitos dentro del lienzo y colores.
 *  9. Rápido: 2,000 productos en menos de un segundo.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formaDe, ilustracionDe, CATALOGO, FORMAS, normalizar, esEmpaquetado } from '../../shared/ilustraciones.ts';

const SERVICIOS = new Set(['belleza y barberia', 'taller automotriz', 'reparacion de electronicos', 'mantenimiento', 'salud', 'educacion y deporte', 'otros servicios']);
const empaqueDe = new Map(CATALOGO.filter(f => f.empaque).map(f => [f.id, f.empaque]));

test('el catálogo tiene al menos 400 formas y sin repetir', () => {
  assert.ok(FORMAS.length >= 400, `hay ${FORMAS.length}`);
  assert.equal(new Set(FORMAS).size, FORMAS.length);
  const familias = new Set(CATALOGO.map(f => f.familia));
  for (const f of ['bebidas', 'comida', 'frutas y verduras', 'panaderia y postres', 'abarrotes', 'limpieza', 'cuidado personal', 'farmacia', 'papeleria', 'ferreteria', 'electronica', 'mascotas', 'belleza y barberia', 'taller automotriz', 'mantenimiento', 'salud']) {
    assert.ok(familias.has(f), `falta la familia ${f}`);
  }
});

test('cada palabra clave lleva a su forma', () => {
  const malos = [];
  /* Las formas genéricas (servicio, platillo, mantenimiento…) ceden ante lo específico: «visita técnica» no tiene que ser «mantenimiento». */
  for (const f of CATALOGO.filter(x => !x.generica)) for (const c of f.claves) {
    const r = formaDe({ nombre: c, giro: SERVICIOS.has(f.familia) ? 'SERVICES' : null });
    if (r !== f.id && r !== f.empaque && empaqueDe.get(r) !== f.id) malos.push(`${c}: ${f.id} → ${r}`);
  }
  assert.deepEqual(malos, []);
});

/* Nombres como vienen en menús y catálogos reales (Rappi, Walmart, menús de
   cafeterías y taquerías, listas de servicios de barberías y talleres). */
const CASOS = [
  /* comercio */
  ['RETAIL', 'Refresco cola 600 ml', 'refresco_cola'], ['RETAIL', 'Coca Cola 2 L', 'refresco_cola'], ['RETAIL', 'Agua natural 1 L', 'agua_botella'],
  ['RETAIL', 'Garrafón 20 L', 'garrafon'], ['RETAIL', 'Atún en agua 140 g', 'atun'], ['RETAIL', 'Papas fritas sal 45 g', 'papas_bolsa'],
  ['RETAIL', 'Arroz 1 kg', 'arroz_costal'], ['RETAIL', 'Frijol negro 900 g', 'frijol'], ['RETAIL', 'Azúcar estándar 1 kg', 'azucar'],
  ['RETAIL', 'Café soluble 100 g', 'cafe_soluble'], ['RETAIL', 'Leche entera 1 L', 'leche'], ['RETAIL', 'Leche deslactosada 1 L', 'leche_deslactosada'],
  ['RETAIL', 'Jugo de naranja 1 L', 'jugo_carton'], ['RETAIL', 'Huevo blanco 12 pzas', 'huevo_carton'], ['RETAIL', 'Pan de caja blanco 680 g', 'pan_caja'],
  ['RETAIL', 'Tortillas de harina 10 pzas', 'tortillas_paquete'], ['RETAIL', 'Chocolate con leche 40 g', 'chocolate_barra'], ['RETAIL', 'Cloro 1 L', 'cloro'],
  ['RETAIL', 'Papel higiénico 4 rollos', 'papel_higienico'], ['RETAIL', 'Pasta dental 100 ml', 'pasta_dental'], ['RETAIL', 'Jabón de tocador 150 g', 'jabon_tocador'],
  ['RETAIL', 'Queso panela 400 g', 'queso'], ['RETAIL', 'Queso Oaxaca 250 g', 'queso_oaxaca'], ['RETAIL', 'Jamón de pavo 250 g', 'jamon'],
  ['RETAIL', 'Salchicha de pavo 500 g', 'salchicha'], ['RETAIL', 'Mayonesa 390 g', 'mayonesa'], ['RETAIL', 'Salsa Valentina 370 ml', 'salsa_picante'],
  ['RETAIL', 'Aceite vegetal 1 L', 'aceite'], ['RETAIL', 'Vinagre blanco 3.7 L', 'vinagre'], ['RETAIL', 'Sopa instantánea Maruchan', 'sopa_instantanea'],
  ['RETAIL', 'Galletas Marías 170 g', 'galletas_paquete'], ['RETAIL', 'Mazapán De la Rosa', 'mazapan'], ['RETAIL', 'Gomitas enchiladas 100 g', 'gomitas'],
  ['RETAIL', 'Detergente en polvo 1 kg', 'detergente_polvo'], ['RETAIL', 'Suavizante 850 ml', 'suavizante'], ['RETAIL', 'Insecticida en aerosol', 'aerosol'],
  ['RETAIL', 'Shampoo 400 ml', 'shampoo'], ['RETAIL', 'Desodorante en barra', 'desodorante'], ['RETAIL', 'Pañales etapa 3', 'panales'],
  ['RETAIL', 'Paracetamol 500 mg 10 tabletas', 'pastillas'], ['RETAIL', 'Jarabe para la tos 120 ml', 'jarabe'], ['RETAIL', 'Cubrebocas KN95', 'cubrebocas'],
  ['RETAIL', 'Suero oral sabor coco', 'suero_oral'], ['RETAIL', 'Cuaderno profesional 100 hojas', 'cuaderno'], ['RETAIL', 'Lápiz del 2', 'lapiz'],
  ['RETAIL', 'Pluma azul punto mediano', 'pluma'], ['RETAIL', 'Calculadora científica', 'calculadora'], ['RETAIL', 'Martillo de uña', 'martillo'],
  ['RETAIL', 'Foco LED 9W', 'foco'], ['RETAIL', 'Pilas AA 4 pzas', 'pilas'], ['RETAIL', 'Cinta de aislar negra', 'cinta_aislar'],
  ['RETAIL', 'Cargador rápido tipo C', 'cargador'], ['RETAIL', 'Audífonos bluetooth', 'audifonos_bt'], ['RETAIL', 'Recarga Telcel $100', 'recarga'],
  ['RETAIL', 'Croquetas para perro 2 kg', 'croquetas_perro'], ['RETAIL', 'Arena para gato 4 kg', 'arena_gato'], ['RETAIL', 'Bolsa de hielo 5 kg', 'hielo'],
  ['RETAIL', 'Cerveza lata 355 ml', 'cerveza_lata'], ['RETAIL', 'Caguama', 'cerveza_botella'], ['RETAIL', 'Tequila reposado 750 ml', 'botella_tequila'],
  ['RETAIL', 'Celular Android', 'celular_producto'], ['RETAIL', 'Pintura vinílica 4 L', 'pintura'], ['RETAIL', 'Chapa de puerta', 'candado'],
  /* restaurantes y cafeterías */
  ['HOSPITALITY', 'Café americano', 'cafe_americano'], ['HOSPITALITY', 'Capuchino grande', 'capuchino'], ['HOSPITALITY', 'Latte de vainilla', 'latte'],
  ['HOSPITALITY', 'Espresso doble', 'espresso'], ['HOSPITALITY', 'Chocolate caliente', 'chocolate_caliente'], ['HOSPITALITY', 'Té chai latte', 'chai'],
  ['HOSPITALITY', 'Café de olla', 'cafe_de_olla'], ['HOSPITALITY', 'Atole de vainilla', 'atole'], ['HOSPITALITY', 'Frappé de moka', 'frappe_moka'],
  ['HOSPITALITY', 'Frappé de galleta', 'frappe_galleta'], ['HOSPITALITY', 'Frappé Rompope', 'frappe_rompope'], ['HOSPITALITY', 'Frappé de caramelo 16 oz', 'frappe_caramelo'],
  ['HOSPITALITY', 'Frappés', 'frappe_moka'], ['HOSPITALITY', 'Matcha latte', 'matcha'], ['HOSPITALITY', 'Bubble tea de taro', 'bubble_taro'],
  ['HOSPITALITY', 'Malteada de fresa', 'malteada_fresa'], ['HOSPITALITY', 'Smoothie verde', 'smoothie_verde'], ['HOSPITALITY', 'Mangonada', 'smoothie_mango'],
  ['HOSPITALITY', 'Jugo verde', 'jugo_verde'], ['HOSPITALITY', 'Agua de jamaica', 'agua_jamaica'], ['HOSPITALITY', 'Agua de horchata', 'agua_horchata'],
  ['HOSPITALITY', 'Limonada mineral', 'limonada'], ['HOSPITALITY', 'Refresco', 'refresco_vaso'], ['HOSPITALITY', 'Michelada', 'michelada'],
  ['HOSPITALITY', 'Cerveza de barril', 'cerveza'], ['HOSPITALITY', 'Margarita de fresa', 'margarita_fresa'], ['HOSPITALITY', 'Mojito', 'mojito'],
  ['HOSPITALITY', 'Piña colada', 'pina_colada'], ['HOSPITALITY', 'Copa de vino tinto', 'vino_tinto'], ['HOSPITALITY', 'Mezcal joven', 'mezcal'],
  ['HOSPITALITY', 'Concha de chocolate', 'concha_chocolate'], ['HOSPITALITY', 'Rol de canela natural', 'rol_canela'], ['HOSPITALITY', 'Cuerno', 'cuerno'],
  ['HOSPITALITY', 'Dona glaseada', 'dona'], ['HOSPITALITY', 'Dona de chocolate', 'dona_chocolate'], ['HOSPITALITY', 'Empanada de piña', 'empanada'],
  ['HOSPITALITY', 'Pan de muerto', 'pan_muerto'], ['HOSPITALITY', 'Rosca de reyes', 'rosca'], ['HOSPITALITY', 'Churros con chocolate', 'churro'],
  ['HOSPITALITY', 'Rebanada de pastel de chocolate', 'pastel_chocolate'], ['HOSPITALITY', 'Pastel de tres leches', 'tres_leches'], ['HOSPITALITY', 'Cheesecake de frutos rojos', 'cheesecake'],
  ['HOSPITALITY', 'Pay de limón', 'pay_limon'], ['HOSPITALITY', 'Flan napolitano', 'flan'], ['HOSPITALITY', 'Hot cakes con miel', 'hotcakes'],
  ['HOSPITALITY', 'Crepa de nutella', 'crepa'], ['HOSPITALITY', 'Helado de chocolate', 'helado_chocolate'], ['HOSPITALITY', 'Paleta de hielo', 'paleta_hielo'],
  ['HOSPITALITY', 'Tacos al pastor', 'taco_pastor'], ['HOSPITALITY', 'Tacos de birria con consomé', 'taco_birria'], ['HOSPITALITY', 'Taco de pescado', 'taco_pescado'],
  ['HOSPITALITY', 'Tacos de suadero', 'taco_carnitas'], ['HOSPITALITY', 'Flautas de pollo', 'tacos_dorados'], ['HOSPITALITY', 'Quesadilla de flor', 'quesadilla'],
  ['HOSPITALITY', 'Burrito percherón', 'burrito'], ['HOSPITALITY', 'Enchiladas suizas', 'enchiladas_verdes'], ['HOSPITALITY', 'Chilaquiles rojos con huevo', 'chilaquiles_rojos'],
  ['HOSPITALITY', 'Pozole rojo', 'pozole'], ['HOSPITALITY', 'Caldo de mariscos', 'caldo'], ['HOSPITALITY', 'Sopa de tortilla', 'sopa'],
  ['HOSPITALITY', 'Tamal verde', 'tamal'], ['HOSPITALITY', 'Elote preparado', 'elote'], ['HOSPITALITY', 'Esquites', 'esquites'],
  ['HOSPITALITY', 'Tostada de ceviche', 'tostada_ceviche'], ['HOSPITALITY', 'Chile relleno', 'chile_relleno'], ['HOSPITALITY', 'Torta ahogada', 'torta'],
  ['HOSPITALITY', 'Club sándwich', 'sandwich'], ['HOSPITALITY', 'Hamburguesa doble', 'hamburguesa_doble'], ['HOSPITALITY', 'Hot dog', 'hotdog'],
  ['HOSPITALITY', 'Pizza hawaiana', 'pizza_hawaiana'], ['HOSPITALITY', 'Pizza familiar', 'pizza_entera'], ['HOSPITALITY', 'Alitas BBQ', 'alitas'],
  ['HOSPITALITY', 'Boneless buffalo', 'boneless'], ['HOSPITALITY', 'Arrachera', 'carne'], ['HOSPITALITY', 'Mojarra frita', 'pescado'],
  ['HOSPITALITY', 'Camarones a la diabla', 'camarones'], ['HOSPITALITY', 'Coctel de camarón', 'coctel_camaron'], ['HOSPITALITY', 'Aguachile verde', 'aguachile'],
  ['HOSPITALITY', 'Sushi California roll', 'sushi'], ['HOSPITALITY', 'Ramen', 'ramen'], ['HOSPITALITY', 'Espagueti a la boloñesa', 'pasta_plato'],
  ['HOSPITALITY', 'Ensalada César', 'ensalada'], ['HOSPITALITY', 'Huevos rancheros', 'huevos'], ['HOSPITALITY', 'Molletes', 'molletes'],
  ['HOSPITALITY', 'Papas a la francesa', 'papas_francesa'], ['HOSPITALITY', 'Nachos con queso', 'nachos'], ['HOSPITALITY', 'Guacamole', 'guacamole'],
  ['HOSPITALITY', 'Especialidad de la casa', 'platillo'],
  /* servicios */
  ['SERVICES', 'Corte de cabello caballero', 'corte_cabello'], ['SERVICES', 'Corte y barba', 'barba'], ['SERVICES', 'Fade', 'corte_cabello'],
  ['SERVICES', 'Afeitado con toalla caliente', 'barba'], ['SERVICES', 'Tinte', 'tinte_servicio'], ['SERVICES', 'Balayage', 'tinte_servicio'],
  ['SERVICES', 'Keratina', 'alaciado'], ['SERVICES', 'Uñas acrílicas', 'unas'], ['SERVICES', 'Gelish', 'unas'], ['SERVICES', 'Pedicure', 'unas'],
  ['SERVICES', 'Extensión de pestañas', 'pestanas'], ['SERVICES', 'Diseño de cejas', 'cejas'], ['SERVICES', 'Depilación con cera', 'depilacion'],
  ['SERVICES', 'Limpieza facial', 'facial'], ['SERVICES', 'Maquillaje de novia', 'maquillaje_servicio'], ['SERVICES', 'Masaje relajante', 'masaje'],
  ['SERVICES', 'Afinación mayor', 'afinacion'], ['SERVICES', 'Cambio de aceite', 'cambio_aceite'], ['SERVICES', 'Balatas delanteras', 'frenos'],
  ['SERVICES', 'Ponchadura', 'llantas'], ['SERVICES', 'Alineación y balanceo', 'alineacion'], ['SERVICES', 'Lavado de auto completo', 'lavado_auto'],
  ['SERVICES', 'Hojalatería y pintura', 'hojalateria'], ['SERVICES', 'Escaneo', 'escaneo'], ['SERVICES', 'Cambio de batería', 'bateria_auto'],
  ['SERVICES', 'Cambio de pantalla', 'reparacion_celular'], ['SERVICES', 'Celular', 'reparacion_celular'], ['SERVICES', 'Formateo de laptop', 'reparacion_laptop'],
  ['SERVICES', 'Reparación de consola', 'reparacion_tv'], ['SERVICES', 'Recarga de cartuchos', 'reparacion_impresora'], ['SERVICES', 'Instalación de cámaras', 'soporte_tecnico'],
  ['SERVICES', 'Destape de drenaje', 'plomeria'], ['SERVICES', 'Instalación eléctrica', 'electricidad'], ['SERVICES', 'Mantenimiento de minisplit', 'clima'],
  ['SERVICES', 'Reparación de lavadora', 'lavadora_servicio'], ['SERVICES', 'Limpieza de casa', 'limpieza_servicio'], ['SERVICES', 'Fumigación', 'fumigacion'],
  ['SERVICES', 'Pintura', 'pintura_servicio'], ['SERVICES', 'Duplicado de llaves', 'cerrajeria'], ['SERVICES', 'Poda de árboles', 'jardineria'],
  ['SERVICES', 'Consulta general', 'consulta'], ['SERVICES', 'Limpieza dental', 'dental'], ['SERVICES', 'Análisis clínicos', 'laboratorio'],
  ['SERVICES', 'Fisioterapia', 'fisioterapia'], ['SERVICES', 'Consulta de nutrición', 'nutricion'], ['SERVICES', 'Examen de la vista', 'optica'],
  ['SERVICES', 'Baño canino', 'veterinaria'], ['SERVICES', 'Vacuna antirrábica', 'veterinaria'], ['SERVICES', 'Aplicación de inyecciones', 'enfermeria'],
  ['SERVICES', 'Clases de inglés', 'idiomas'], ['SERVICES', 'Clases de guitarra', 'musica'], ['SERVICES', 'Clases de salsa', 'baile'],
  ['SERVICES', 'Mensualidad gimnasio', 'gimnasio'], ['SERVICES', 'Clase de yoga', 'yoga'], ['SERVICES', 'Renta de cancha', 'deporte'],
  ['SERVICES', 'Lavado por kilo', 'lavanderia'], ['SERVICES', 'Bastilla de pantalón', 'costura'], ['SERVICES', 'Sesión de fotos', 'fotografia'],
  ['SERVICES', 'Copias a color', 'impresion'], ['SERVICES', 'Envío nacional', 'envios'], ['SERVICES', 'Renta por hora', 'renta'],
  ['SERVICES', 'Habitación doble', 'hospedaje'], ['SERVICES', 'Tatuaje', 'tatuaje'], ['SERVICES', 'Cambio de pila de reloj', 'relojeria'],
];

test('nombres reales caen en su dibujo, en los tres giros', () => {
  const malos = CASOS.filter(([g, n, f]) => formaDe({ nombre: n, giro: g }) !== f).map(([g, n, f]) => `${g} · ${n}: ${formaDe({ nombre: n, giro: g })} ≠ ${f}`);
  assert.deepEqual(malos, []);
  assert.ok(CASOS.length >= 200, `${CASOS.length} casos`);
});

test('envase contra preparado', () => {
  assert.equal(formaDe({ nombre: 'Refresco', giro: 'HOSPITALITY' }), 'refresco_vaso');
  assert.equal(formaDe({ nombre: 'Refresco', giro: 'RETAIL' }), 'refresco_cola');
  assert.equal(formaDe({ nombre: 'Refresco 600 ml', giro: 'HOSPITALITY' }), 'refresco_cola');
  assert.equal(formaDe({ nombre: 'Papas a la francesa', giro: 'HOSPITALITY' }), 'papas_francesa');
  assert.equal(formaDe({ nombre: 'Papas 45 g', giro: 'HOSPITALITY' }), 'papas_bolsa');
  assert.equal(formaDe({ nombre: 'Café', giro: 'HOSPITALITY' }), 'cafe_americano');
  assert.equal(formaDe({ nombre: 'Café 200 g', giro: 'HOSPITALITY' }), 'cafe_soluble');
  assert.ok(esEmpaquetado(normalizar('Agua 1.5 L')) && !esEmpaquetado(normalizar('Agua de jamaica grande')));
});

test('una clave compartida la decide el giro', () => {
  for (const [nombre, producto, servicio] of [['Celular', 'celular_producto', 'reparacion_celular'], ['Pintura', 'pintura', 'pintura_servicio'], ['Chapa', 'candado', 'cerrajeria'], ['Suero', 'isotonica', 'enfermeria'], ['Pila de reloj', 'pilas', 'relojeria']]) {
    assert.equal(formaDe({ nombre, giro: 'RETAIL' }), producto, nombre);
    assert.equal(formaDe({ nombre, giro: 'SERVICES' }), servicio, nombre);
    assert.equal(formaDe({ nombre, inventario: 'NONE' }), servicio, `${nombre} sin inventario`);
  }
});

test('sin pista: categoría, luego giro y preset', () => {
  assert.equal(formaDe({ nombre: 'Especial de la casa', categoria: 'Cafés calientes' }), 'cafe_americano');
  assert.equal(formaDe({ nombre: 'Combo 3', categoria: 'Postres' }) !== 'caja_generica', true);
  assert.equal(formaDe({ nombre: 'XJ-200', giro: 'HOSPITALITY' }), 'platillo');
  assert.equal(formaDe({ nombre: 'XJ-200', giro: 'RETAIL' }), 'caja_generica');
  assert.equal(formaDe({ nombre: 'XJ-200' }), 'caja_generica');
  assert.equal(formaDe({ nombre: 'XJ-200', giro: 'SERVICES' }), 'servicio');
  assert.equal(formaDe({ nombre: 'XJ-200', giro: 'SERVICES', preset: 'TALLER_AUTOMOTRIZ' }), 'afinacion');
  assert.equal(formaDe({ nombre: 'XJ-200', giro: 'SERVICES', preset: 'BELLEZA' }), 'corte_cabello');
  assert.equal(formaDe({ nombre: 'XJ-200', giro: 'SERVICES', preset: 'REPARACION_ELECTRONICA' }), 'reparacion_celular');
  assert.equal(formaDe({ nombre: 'XJ-200', giro: 'SERVICES', preset: 'MANTENIMIENTO' }), 'mantenimiento');
  assert.equal(formaDe({ nombre: '' }), 'caja_generica');
});

test('determinista: mismo producto, misma forma y color; otro id, otro color', () => {
  const a = ilustracionDe({ id: 41, nombre: 'Dona glaseada' });
  assert.deepEqual(a, ilustracionDe({ id: 41, nombre: 'Dona glaseada' }));
  const colores = new Set([1, 2, 3, 4, 5, 6, 7, 8].map(id => JSON.stringify(ilustracionDe({ id, nombre: 'Cereal 500 g' }).trazos)));
  assert.ok(colores.size >= 6, `solo ${colores.size} variantes de color en 8 productos`);
  assert.deepEqual(ilustracionDe({ nombre: 'Taco al pastor' }), ilustracionDe({ nombre: 'Taco al pastor' }));
});

test('todo dibujo es válido', () => {
  const malos = [];
  const num = v => typeof v === 'number' && Number.isFinite(v);
  for (const forma of FORMAS) {
    const il = ilustracionDe({ id: 7, nombre: forma });
    const f = CATALOGO.find(x => x.id === forma);
    const tr = [il.trazos[0], ...f.dibujo({ f: 'hsl(1 1% 1%)', o: 'hsl(1 1% 1%)', s: 'hsl(1 1% 1%)', c: '#fff', h: 1 })];
    if (tr.length < 3) malos.push(`${forma}: muy pocos trazos`);
    for (const z of tr) {
      const coords = z.t === 'r' ? [z.x, z.y, z.w, z.h] : z.t === 'c' ? [z.x, z.y, z.r] : z.t === 'e' ? [z.x, z.y, z.rx, z.ry] : [];
      if (coords.some(v => !num(v) || v < -40 || v > 240)) malos.push(`${forma}: coordenada fuera de lienzo ${JSON.stringify(z)}`);
      const color = z.t === 'l' ? z.s : z.f;
      if (typeof color !== 'string' || !color) malos.push(`${forma}: sin color`);
      if ((z.t === 'p' || z.t === 'l') && !/^M/i.test(z.d)) malos.push(`${forma}: path sin M`);
      if (z.t === 'l' && !num(z.w)) malos.push(`${forma}: grosor`);
    }
  }
  assert.deepEqual(malos, []);
});

test('rápido: 2,000 productos en menos de un segundo', () => {
  const nombres = CASOS.map(c => c[1]);
  const t0 = performance.now();
  for (let i = 0; i < 2000; i++) ilustracionDe({ id: i, nombre: nombres[i % nombres.length] });
  const ms = performance.now() - t0;
  assert.ok(ms < 1000, `${ms.toFixed(0)} ms`);
});
