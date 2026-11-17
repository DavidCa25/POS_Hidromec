/**
 * CATÁLOGOS DE PRUEBA POR GIRO para el loop del intérprete: lo que tendría
 * una tienda de abarrotes, un café-panadería, un restaurante y un salón.
 * Las frases de electron/asistente/lenguaje/frases/*.txt nombran estos
 * productos y estas personas.
 */
const PRODUCTOS = {
  abarrotes: ['Coca Cola 600 ml', 'Coca Cola 2 L', 'Sabritas original', 'Doritos nacho', 'Leche Lala entera 1 L', 'Leche deslactosada',
    'Huevo blanco kilo', 'Tortillas kilo', 'Pan Bimbo grande', 'Azúcar 1 kg', 'Arroz 1 kg', 'Frijol negro 1 kg', 'Aceite 1 L',
    'Atún en agua', 'Jabón Zote', 'Papel higiénico 4 rollos', 'Cloro 1 L', 'Cerveza Corona 355', 'Cigarros Marlboro', 'Garrafón 20 L',
    'Galletas Marías', 'Maruchan', 'Jamón de pavo', 'Queso Oaxaca', 'Chiles en lata', 'Café soluble', 'Detergente 1 kg', 'Pañales chicos',
    'Agua 1 L', 'Refresco de naranja', 'Hielo bolsa', 'Pilas AA', 'Sal 1 kg', 'Harina', 'Mantequilla', 'Yogurt natural', 'Plátano',
    'Pan blanco', 'Salsa Valentina', 'Mayonesa'],
  cafe: ['Dona glaseada', 'Dona de chocolate', 'Dona rellena', 'Concha', 'Croissant', 'Pan de muerto', 'Latte chico', 'Latte grande',
    'Capuchino', 'Americano', 'Frappé de moka', 'Galleta de avena', 'Café en grano', 'Leche entera', 'Chocolate caliente', 'Té chai',
    'Pastel de chocolate', 'Bisquet', 'Cuernito'],
  restaurante: ['Chilaquiles verdes', 'Enchiladas suizas', 'Tacos al pastor', 'Hamburguesa sencilla', 'Orden de papas', 'Agua de jamaica',
    'Limonada', 'Sopa del día', 'Molletes', 'Huevos rancheros', 'Torta de milanesa', 'Pozole', 'Quesadilla'],
  salon: ['Corte de cabello', 'Corte de barba', 'Tinte', 'Mechas', 'Manicure', 'Pedicure', 'Planchado', 'Peinado', 'Tratamiento capilar',
    'Shampoo profesional', 'Cera para cabello', 'Uñas acrílicas', 'Depilación de ceja', 'Masaje relajante'],
};

export const CATALOGO = Object.values(PRODUCTOS).flat().map((nombre, i) => ({ id: 1000 + i, nombre }));

export const PERSONAS = [
  ...['Doña Mary', 'Don Pepe', 'Chela', 'Laura Gómez', 'Carlos Ruiz', 'Rosa Martínez', 'Toño', 'Ana Torres', 'Fer Sánchez', 'Mario Díaz',
      'Lupita Hernández', 'Juan Pérez'].map((nombre, i) => ({ id: 1 + i, nombre, tipo: 'cliente' })),
  ...['Bimbo', 'Coca Cola FEMSA', 'Lala', 'Sabritas', 'Distribuidora López', 'Abarrotes Mayoreo del Bajío', 'Cervecería Modelo',
      'Gas Express', 'Café Veracruz', 'Harinera Central', 'Belleza Pro'].map((nombre, i) => ({ id: 100 + i, nombre, tipo: 'proveedor' })),
  ...['Pedro', 'Karla', 'Luis', 'Sofía', 'Daniela'].map((nombre, i) => ({ id: 200 + i, nombre, tipo: 'profesional' })),
];

export const CONCEPTOS = ['Luz', 'Agua', 'Gas', 'Renta', 'Internet y teléfono', 'Sueldos', 'Gasolina y transporte', 'Limpieza',
  'Papelería', 'Mantenimiento', 'Publicidad', 'Impuestos y contador', 'Comida del personal', 'Empaque y desechables']
  .map((nombre, i) => ({ id: 1 + i, nombre }));

export const MODULOS = new Set(['hospitality', 'servicios', 'loyalty', 'asistencia']);
