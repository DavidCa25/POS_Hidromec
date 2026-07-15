/* Catalogos semilla por giro para el onboarding.
   Productos base SIN precio (el precio varia por region; el comercio
   lo ajusta despues). Solo nombre y categoria; marca opcional.
   Se importan con el mismo motor (sp_import_products). Ampliables. */

export interface SeedProducto {
  part_number: string;
  name: string;
  category_name: string;
  brand_name?: string | null;
}

export interface GiroCatalogo {
  id: string;
  nombre: string;
  icono: string;      // Bootstrap Icons
  productos: SeedProducto[];
}

export const CATALOGOS_GIRO: GiroCatalogo[] = [
  {
    id: 'abarrotes',
    nombre: 'Abarrotes',
    icono: 'bi-basket',
    productos: [
      { part_number: 'ABA-001', name: 'Refresco cola 600ml', category_name: 'Bebidas' },
      { part_number: 'ABA-002', name: 'Agua purificada 1L', category_name: 'Bebidas' },
      { part_number: 'ABA-003', name: 'Jugo 1L', category_name: 'Bebidas' },
      { part_number: 'ABA-004', name: 'Papas fritas 45g', category_name: 'Botanas' },
      { part_number: 'ABA-005', name: 'Galletas 170g', category_name: 'Botanas' },
      { part_number: 'ABA-006', name: 'Frijol 1kg', category_name: 'Abarrotes' },
      { part_number: 'ABA-007', name: 'Arroz 1kg', category_name: 'Abarrotes' },
      { part_number: 'ABA-008', name: 'Azucar 1kg', category_name: 'Abarrotes' },
      { part_number: 'ABA-009', name: 'Sal 1kg', category_name: 'Abarrotes' },
      { part_number: 'ABA-010', name: 'Aceite comestible 1L', category_name: 'Abarrotes' },
      { part_number: 'ABA-011', name: 'Leche 1L', category_name: 'Lacteos' },
      { part_number: 'ABA-012', name: 'Huevo 1kg', category_name: 'Lacteos' },
      { part_number: 'ABA-013', name: 'Jabon de bano', category_name: 'Limpieza' },
      { part_number: 'ABA-014', name: 'Detergente 1kg', category_name: 'Limpieza' },
      { part_number: 'ABA-015', name: 'Papel higienico 4 rollos', category_name: 'Limpieza' }
    ]
  },
  {
    id: 'ferreteria',
    nombre: 'Ferreteria',
    icono: 'bi-tools',
    productos: [
      { part_number: 'FER-001', name: 'Tornillo 1/4 x 1', category_name: 'Tornilleria' },
      { part_number: 'FER-002', name: 'Clavo 2 pulgadas 1kg', category_name: 'Tornilleria' },
      { part_number: 'FER-003', name: 'Taquete #8', category_name: 'Tornilleria' },
      { part_number: 'FER-004', name: 'Martillo de una', category_name: 'Herramienta' },
      { part_number: 'FER-005', name: 'Desarmador plano', category_name: 'Herramienta' },
      { part_number: 'FER-006', name: 'Pinza de electricista', category_name: 'Herramienta' },
      { part_number: 'FER-007', name: 'Flexometro 5m', category_name: 'Herramienta' },
      { part_number: 'FER-008', name: 'Cinta de aislar', category_name: 'Electrico' },
      { part_number: 'FER-009', name: 'Foco LED 9W', category_name: 'Electrico' },
      { part_number: 'FER-010', name: 'Contacto duplex', category_name: 'Electrico' },
      { part_number: 'FER-011', name: 'Cable calibre 12 (metro)', category_name: 'Electrico' },
      { part_number: 'FER-012', name: 'Cinta teflon', category_name: 'Plomeria' },
      { part_number: 'FER-013', name: 'Llave angular', category_name: 'Plomeria' },
      { part_number: 'FER-014', name: 'Pintura vinilica 1L', category_name: 'Pinturas' },
      { part_number: 'FER-015', name: 'Brocha 3 pulgadas', category_name: 'Pinturas' }
    ]
  },
  {
    id: 'refaccionaria',
    nombre: 'Refaccionaria',
    icono: 'bi-gear-wide-connected',
    productos: [
      { part_number: 'REF-001', name: 'Aceite 20W50 1L', category_name: 'Lubricantes' },
      { part_number: 'REF-002', name: 'Aceite 10W40 1L', category_name: 'Lubricantes' },
      { part_number: 'REF-003', name: 'Aceite sintetico 5W30 1L', category_name: 'Lubricantes' },
      { part_number: 'REF-004', name: 'Anticongelante 1L', category_name: 'Lubricantes' },
      { part_number: 'REF-005', name: 'Filtro de aceite', category_name: 'Filtros' },
      { part_number: 'REF-006', name: 'Filtro de aire', category_name: 'Filtros' },
      { part_number: 'REF-007', name: 'Filtro de gasolina', category_name: 'Filtros' },
      { part_number: 'REF-008', name: 'Balatas delanteras (juego)', category_name: 'Frenos' },
      { part_number: 'REF-009', name: 'Liquido de frenos DOT3', category_name: 'Frenos' },
      { part_number: 'REF-010', name: 'Bateria 12V', category_name: 'Baterias' },
      { part_number: 'REF-011', name: 'Banda de distribucion', category_name: 'Bandas' },
      { part_number: 'REF-012', name: 'Bujia', category_name: 'Encendido' },
      { part_number: 'REF-013', name: 'Limpiador de inyectores', category_name: 'Aditivos' },
      { part_number: 'REF-014', name: 'Foco de halogeno H4', category_name: 'Electrico' },
      { part_number: 'REF-015', name: 'Limpiaparabrisas', category_name: 'Accesorios' }
    ]
  },
  {
    id: 'farmacias',
    nombre: 'Farmacias',
    icono: 'bi-capsule',
    productos: [
      { part_number: 'FAR-001', name: 'Paracetamol 500mg (caja)', category_name: 'Analgesicos' },
      { part_number: 'FAR-002', name: 'Ibuprofeno 400mg (caja)', category_name: 'Analgesicos' },
      { part_number: 'FAR-003', name: 'Acido acetilsalicilico (caja)', category_name: 'Analgesicos' },
      { part_number: 'FAR-004', name: 'Antigripal (caja)', category_name: 'Antigripales' },
      { part_number: 'FAR-005', name: 'Sal de uvas (sobre)', category_name: 'Digestivo' },
      { part_number: 'FAR-006', name: 'Suero oral 625ml', category_name: 'Digestivo' },
      { part_number: 'FAR-007', name: 'Alcohol 250ml', category_name: 'Primeros auxilios' },
      { part_number: 'FAR-008', name: 'Gasas esteriles (paquete)', category_name: 'Primeros auxilios' },
      { part_number: 'FAR-009', name: 'Curitas (caja)', category_name: 'Primeros auxilios' },
      { part_number: 'FAR-010', name: 'Termometro digital', category_name: 'Cuidado personal' },
      { part_number: 'FAR-011', name: 'Jabon antibacterial', category_name: 'Cuidado personal' },
      { part_number: 'FAR-012', name: 'Cubrebocas (paquete)', category_name: 'Cuidado personal' },
      { part_number: 'FAR-013', name: 'Vitamina C (caja)', category_name: 'Vitaminas' }
    ]
  }
];
