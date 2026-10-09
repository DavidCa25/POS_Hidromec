/**
 * LOS GIROS DE COMERCIO Y DE ALIMENTOS, PARA LA PLANTILLA.
 *
 * Servicios ya tenía los suyos (`servicios/presets.json`). Comercio y alimentos
 * solo distinguían la familia, así que una refaccionaria y una farmacia
 * bajaban la misma plantilla con Coca-Cola y Sabritas, y una taquería la de
 * café americano y croissant.
 *
 * Cada giro aporta sus EJEMPLOS (hoja «Ejemplos») y sus CATEGORÍAS sugeridas.
 * Las columnas no cambian por giro: las decide la familia, porque son las que
 * el importador sabe leer.
 *
 * Los ejemplos van por campo, no por posición: si mañana cambia el orden de las
 * columnas, siguen cayendo donde deben.
 */
/* Los ids de comercio son los mismos de `setup-inicial/catalogos-giro.ts`:
   el giro que se elige al dar de alta el negocio es el que se guarda. */
const GIROS = {
  RETAIL: [
    { id: 'abarrotes', nombre: 'Abarrotes', categorias: ['Bebidas', 'Botanas', 'Abarrotes', 'Lácteos', 'Limpieza'],
      ejemplos: [
        { nombre: 'Coca-Cola 600 ml', price: 18, stock: 24, part_number: 'ABA-001', bar_code: '7501055300013', cost: 13.5, category_name: 'Bebidas', brand_name: 'Coca-Cola', base_uom: 'pza', sellable: 'Sí' },
        { nombre: 'Frijoles refritos Isadora 430 g', price: 24, stock: 12, part_number: 'ABA-035', bar_code: '', cost: 17.8, category_name: 'Abarrotes', brand_name: 'Isadora', base_uom: 'pza', sellable: 'Sí' },
      ] },
    { id: 'ferreteria', nombre: 'Ferretería', categorias: ['Herramienta', 'Tornillería', 'Eléctrico', 'Plomería', 'Pintura'],
      ejemplos: [
        { nombre: 'Martillo de uña 16 oz', price: 189, stock: 6, part_number: 'FER-MAR16', bar_code: '', cost: 112, category_name: 'Herramienta', brand_name: 'Truper', base_uom: 'pza', sellable: 'Sí' },
        { nombre: 'Tornillo para madera 1 1/2"', price: 1.5, stock: 800, part_number: 'TOR-112', bar_code: '', cost: 0.6, category_name: 'Tornillería', brand_name: 'Fiero', base_uom: 'pza', sellable: 'Sí' },
      ] },
    { id: 'refaccionaria', nombre: 'Refaccionaria', categorias: ['Filtros', 'Aceites', 'Frenos', 'Eléctrico', 'Suspensión'],
      ejemplos: [
        { nombre: 'Filtro de aceite Fram PH6017A', price: 129, stock: 18, part_number: 'PH6017A', bar_code: '009100601706', cost: 62.5, category_name: 'Filtros', brand_name: 'Fram', base_uom: 'pza', sellable: 'Sí' },
        { nombre: 'Aceite 5W-30 sintético 946 ml', price: 215, stock: 24, part_number: 'ACE-5W30', bar_code: '', cost: 148, category_name: 'Aceites', brand_name: 'Mobil', base_uom: 'pza', sellable: 'Sí' },
      ] },
    { id: 'farmacias', nombre: 'Farmacia', categorias: ['Analgésicos', 'Antigripales', 'Curación', 'Higiene', 'Vitaminas'],
      ejemplos: [
        { nombre: 'Paracetamol 500 mg 10 tabletas', price: 32, stock: 40, part_number: 'FAR-PAR500', bar_code: '7501008490016', cost: 14, category_name: 'Analgésicos', brand_name: 'Genérico', base_uom: 'pza', sellable: 'Sí' },
        { nombre: 'Gasa estéril 10 x 10 cm', price: 18, stock: 60, part_number: 'CUR-GASA10', bar_code: '', cost: 7.5, category_name: 'Curación', brand_name: 'Le Roy', base_uom: 'pza', sellable: 'Sí' },
      ] },
    { id: 'papeleria', nombre: 'Papelería', categorias: ['Cuadernos', 'Escritura', 'Arte', 'Oficina', 'Copias'],
      ejemplos: [
        { nombre: 'Cuaderno profesional raya 100 hojas', price: 45, stock: 30, part_number: 'PAP-CPR100', bar_code: '7501245100018', cost: 27, category_name: 'Cuadernos', brand_name: 'Scribe', base_uom: 'pza', sellable: 'Sí' },
        { nombre: 'Pluma punto mediano azul', price: 8, stock: 120, part_number: 'ESC-PLAZ', bar_code: '', cost: 3.2, category_name: 'Escritura', brand_name: 'Bic', base_uom: 'pza', sellable: 'Sí' },
      ] },
  ],
  HOSPITALITY: [
    { id: 'cafeteria', nombre: 'Cafetería', categorias: ['Cafés', 'Bebidas frías', 'Panadería', 'Desayunos'],
      ejemplos: [
        { nombre: 'Café americano 12 oz', price: 45, part_number: 'CAF-12', bar_code: '', cost: 14, category_name: 'Cafés', sellable: 'Sí' },
        { nombre: 'Croissant de mantequilla', price: 38, part_number: 'PAN-CRO', bar_code: '', cost: 16, category_name: 'Panadería', sellable: 'Sí' },
      ] },
    { id: 'panaderia', nombre: 'Panadería y donas', categorias: ['Donas', 'Pan dulce', 'Pasteles', 'Bebidas'],
      ejemplos: [
        { nombre: 'Dona glaseada', price: 25, part_number: 'DON-GLA', bar_code: '', cost: 8, category_name: 'Donas', sellable: 'Sí' },
        { nombre: 'Caja de 6 donas surtidas', price: 135, part_number: 'DON-CAJ6', bar_code: '', cost: 48, category_name: 'Donas', sellable: 'Sí' },
      ] },
    { id: 'restaurante', nombre: 'Restaurante', categorias: ['Entradas', 'Platos fuertes', 'Postres', 'Bebidas'],
      ejemplos: [
        { nombre: 'Enchiladas suizas', price: 145, part_number: 'PF-ENSU', bar_code: '', cost: 52, category_name: 'Platos fuertes', sellable: 'Sí' },
        { nombre: 'Agua de jamaica 500 ml', price: 35, part_number: 'BEB-JAM', bar_code: '', cost: 6, category_name: 'Bebidas', sellable: 'Sí' },
      ] },
    { id: 'taqueria', nombre: 'Taquería', categorias: ['Tacos', 'Órdenes', 'Bebidas', 'Extras'],
      ejemplos: [
        { nombre: 'Taco al pastor', price: 22, part_number: 'TAC-PAS', bar_code: '', cost: 8, category_name: 'Tacos', sellable: 'Sí' },
        { nombre: 'Orden de 5 tacos de bistec', price: 110, part_number: 'ORD-BIS5', bar_code: '', cost: 42, category_name: 'Órdenes', sellable: 'Sí' },
      ] },
    { id: 'bar', nombre: 'Bar', categorias: ['Cervezas', 'Cocteles', 'Destilados', 'Botanas'],
      ejemplos: [
        { nombre: 'Cerveza clara 355 ml', price: 55, part_number: 'CER-CLA', bar_code: '', cost: 21, category_name: 'Cervezas', sellable: 'Sí' },
        { nombre: 'Margarita clásica', price: 120, part_number: 'COC-MAR', bar_code: '', cost: 34, category_name: 'Cocteles', sellable: 'Sí' },
      ] },
  ],
};

/** Los giros de una familia, para la pantalla (sin ejemplos). */
function lista(perfil) {
  return (GIROS[perfil] || []).map(({ id, nombre }) => ({ id, nombre }));
}

/** El giro guardado, si es de esta familia. */
function buscar(perfil, id) {
  return (GIROS[perfil] || []).find((g) => g.id === id) || null;
}

/** Todos los ids válidos, para validar lo que llega de la pantalla. */
const IDS = new Set(Object.values(GIROS).flat().map((g) => g.id));

module.exports = { GIROS, lista, buscar, IDS };
