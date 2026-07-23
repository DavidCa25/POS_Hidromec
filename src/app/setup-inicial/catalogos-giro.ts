/* Catalogos semilla por giro para el onboarding.
   Productos reales de marcas lideres en Mexico (best-sellers por giro),
   SIN precio (varia por region; el comercio lo ajusta despues).
   Se importan con el mismo motor (sp_import_products). 50+ por giro. */

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
      // Bebidas
      { part_number: 'ABA-001', name: 'Coca-Cola 600ml', category_name: 'Bebidas', brand_name: 'Coca-Cola' },
      { part_number: 'ABA-002', name: 'Coca-Cola 2.5L', category_name: 'Bebidas', brand_name: 'Coca-Cola' },
      { part_number: 'ABA-003', name: 'Coca-Cola Sin Azucar 600ml', category_name: 'Bebidas', brand_name: 'Coca-Cola' },
      { part_number: 'ABA-004', name: 'Sprite 600ml', category_name: 'Bebidas', brand_name: 'Sprite' },
      { part_number: 'ABA-005', name: 'Fanta Naranja 600ml', category_name: 'Bebidas', brand_name: 'Fanta' },
      { part_number: 'ABA-006', name: 'Agua Ciel 1L', category_name: 'Bebidas', brand_name: 'Ciel' },
      { part_number: 'ABA-007', name: 'Agua Ciel 600ml', category_name: 'Bebidas', brand_name: 'Ciel' },
      { part_number: 'ABA-008', name: 'Agua Bonafont 1L', category_name: 'Bebidas', brand_name: 'Bonafont' },
      { part_number: 'ABA-009', name: 'Jugo Jumex Mango 1L', category_name: 'Bebidas', brand_name: 'Jumex' },
      { part_number: 'ABA-010', name: 'Del Valle Durazno 1L', category_name: 'Bebidas', brand_name: 'Del Valle' },
      { part_number: 'ABA-011', name: 'Boing Mango 500ml', category_name: 'Bebidas', brand_name: 'Boing' },
      { part_number: 'ABA-012', name: 'Gatorade Cool Blue 600ml', category_name: 'Bebidas', brand_name: 'Gatorade' },
      // Botanas y dulces
      { part_number: 'ABA-013', name: 'Sabritas Original 45g', category_name: 'Botanas', brand_name: 'Sabritas' },
      { part_number: 'ABA-014', name: 'Doritos Nacho 62g', category_name: 'Botanas', brand_name: 'Doritos' },
      { part_number: 'ABA-015', name: 'Cheetos Torciditos 52g', category_name: 'Botanas', brand_name: 'Cheetos' },
      { part_number: 'ABA-016', name: 'Ruffles Queso 45g', category_name: 'Botanas', brand_name: 'Ruffles' },
      { part_number: 'ABA-017', name: 'Takis Fuego 62g', category_name: 'Botanas', brand_name: 'Takis' },
      { part_number: 'ABA-018', name: 'Galletas Emperador Chocolate', category_name: 'Botanas', brand_name: 'Gamesa' },
      { part_number: 'ABA-019', name: 'Galletas Marias Gamesa', category_name: 'Botanas', brand_name: 'Gamesa' },
      { part_number: 'ABA-020', name: 'Chocolate Carlos V', category_name: 'Dulces', brand_name: 'Nestle' },
      { part_number: 'ABA-021', name: 'Paleta Payaso', category_name: 'Dulces', brand_name: 'Ricolino' },
      { part_number: 'ABA-022', name: 'Chicles Trident Menta', category_name: 'Dulces', brand_name: 'Trident' },
      // Pan y lacteos
      { part_number: 'ABA-023', name: 'Pan Blanco Bimbo Grande', category_name: 'Panaderia', brand_name: 'Bimbo' },
      { part_number: 'ABA-024', name: 'Pan Blanco Wonder', category_name: 'Panaderia', brand_name: 'Wonder' },
      { part_number: 'ABA-025', name: 'Bimbollos 6 pzas', category_name: 'Panaderia', brand_name: 'Bimbo' },
      { part_number: 'ABA-026', name: 'Leche Lala Entera 1L', category_name: 'Lacteos', brand_name: 'Lala' },
      { part_number: 'ABA-027', name: 'Leche Alpura Entera 1L', category_name: 'Lacteos', brand_name: 'Alpura' },
      { part_number: 'ABA-028', name: 'Leche Lala Deslactosada 1L', category_name: 'Lacteos', brand_name: 'Lala' },
      { part_number: 'ABA-029', name: 'Huevo San Juan 18 pzas', category_name: 'Lacteos', brand_name: 'San Juan' },
      { part_number: 'ABA-030', name: 'Queso Panela FUD 400g', category_name: 'Lacteos', brand_name: 'FUD' },
      { part_number: 'ABA-031', name: 'Crema Lala 450ml', category_name: 'Lacteos', brand_name: 'Lala' },
      { part_number: 'ABA-032', name: 'Yogurt Danone Natural 1L', category_name: 'Lacteos', brand_name: 'Danone' },
      // Abarrotes basicos
      { part_number: 'ABA-033', name: 'Harina de Maiz Maseca 1kg', category_name: 'Abarrotes', brand_name: 'Maseca' },
      { part_number: 'ABA-034', name: 'Arroz Verde Valle 1kg', category_name: 'Abarrotes', brand_name: 'Verde Valle' },
      { part_number: 'ABA-035', name: 'Frijoles Refritos Isadora 430g', category_name: 'Abarrotes', brand_name: 'Isadora' },
      { part_number: 'ABA-036', name: 'Aceite 1-2-3 1L', category_name: 'Abarrotes', brand_name: '1-2-3' },
      { part_number: 'ABA-037', name: 'Azucar Zulka 1kg', category_name: 'Abarrotes', brand_name: 'Zulka' },
      { part_number: 'ABA-038', name: 'Sal La Fina 1kg', category_name: 'Abarrotes', brand_name: 'La Fina' },
      { part_number: 'ABA-039', name: 'Atun Dolores en agua 140g', category_name: 'Enlatados', brand_name: 'Dolores' },
      { part_number: 'ABA-040', name: 'Chiles Jalapenos La Costena 220g', category_name: 'Enlatados', brand_name: 'La Costena' },
      { part_number: 'ABA-041', name: 'Sopa Maruchan Camaron', category_name: 'Abarrotes', brand_name: 'Maruchan' },
      { part_number: 'ABA-042', name: 'Cafe Nescafe Clasico 200g', category_name: 'Abarrotes', brand_name: 'Nescafe' },
      { part_number: 'ABA-043', name: 'Pasta para Sopa La Moderna 200g', category_name: 'Abarrotes', brand_name: 'La Moderna' },
      // Limpieza e higiene
      { part_number: 'ABA-044', name: 'Papel Higienico Petalo 4 rollos', category_name: 'Limpieza', brand_name: 'Petalo' },
      { part_number: 'ABA-045', name: 'Detergente Ariel 1kg', category_name: 'Limpieza', brand_name: 'Ariel' },
      { part_number: 'ABA-046', name: 'Suavizante Suavitel 850ml', category_name: 'Limpieza', brand_name: 'Suavitel' },
      { part_number: 'ABA-047', name: 'Cloro Cloralex 950ml', category_name: 'Limpieza', brand_name: 'Cloralex' },
      { part_number: 'ABA-048', name: 'Limpiador Fabuloso 1L', category_name: 'Limpieza', brand_name: 'Fabuloso' },
      { part_number: 'ABA-049', name: 'Jabon Zote Rosa 400g', category_name: 'Limpieza', brand_name: 'Zote' },
      { part_number: 'ABA-050', name: 'Lavatrastes Salvo 500ml', category_name: 'Limpieza', brand_name: 'Salvo' },
      { part_number: 'ABA-051', name: 'Jabon de Tocador Palmolive', category_name: 'Higiene', brand_name: 'Palmolive' },
      { part_number: 'ABA-052', name: 'Shampoo Sedal 340ml', category_name: 'Higiene', brand_name: 'Sedal' },
      { part_number: 'ABA-053', name: 'Pasta Dental Colgate 100ml', category_name: 'Higiene', brand_name: 'Colgate' }
    ]
  },
  {
    id: 'ferreteria',
    nombre: 'Ferreteria',
    icono: 'bi-tools',
    productos: [
      // Tornilleria y fijacion
      { part_number: 'FER-001', name: 'Tornillo Pija 1" (100 pz)', category_name: 'Tornilleria', brand_name: 'Fiero' },
      { part_number: 'FER-002', name: 'Clavo 2.5" 1kg', category_name: 'Tornilleria', brand_name: 'Fiero' },
      { part_number: 'FER-003', name: 'Taquete Plastico #8 (100 pz)', category_name: 'Tornilleria', brand_name: 'Truper' },
      { part_number: 'FER-004', name: 'Tuerca Hexagonal 1/4"', category_name: 'Tornilleria', brand_name: 'Fiero' },
      { part_number: 'FER-005', name: 'Rondana Plana 1/4"', category_name: 'Tornilleria', brand_name: 'Fiero' },
      { part_number: 'FER-006', name: 'Pija para Tablaroca 1"', category_name: 'Tornilleria', brand_name: 'Fiero' },
      { part_number: 'FER-007', name: 'Armella Cerrada 3/16"', category_name: 'Tornilleria', brand_name: 'Hermex' },
      { part_number: 'FER-008', name: 'Cancamo con Rosca', category_name: 'Tornilleria', brand_name: 'Hermex' },
      // Herramienta
      { part_number: 'FER-009', name: 'Martillo de Una 16oz', category_name: 'Herramienta', brand_name: 'Truper' },
      { part_number: 'FER-010', name: 'Desarmador Plano 6"', category_name: 'Herramienta', brand_name: 'Truper' },
      { part_number: 'FER-011', name: 'Desarmador de Cruz 6"', category_name: 'Herramienta', brand_name: 'Truper' },
      { part_number: 'FER-012', name: 'Juego de Desarmadores 6 pzas', category_name: 'Herramienta', brand_name: 'Pretul' },
      { part_number: 'FER-013', name: 'Pinza de Electricista 8"', category_name: 'Herramienta', brand_name: 'Truper' },
      { part_number: 'FER-014', name: 'Pinza de Presion 10"', category_name: 'Herramienta', brand_name: 'Truper' },
      { part_number: 'FER-015', name: 'Flexometro 5m', category_name: 'Herramienta', brand_name: 'Truper' },
      { part_number: 'FER-016', name: 'Flexometro 8m', category_name: 'Herramienta', brand_name: 'Pretul' },
      { part_number: 'FER-017', name: 'Nivel de Aluminio 24"', category_name: 'Herramienta', brand_name: 'Truper' },
      { part_number: 'FER-018', name: 'Arco con Segueta', category_name: 'Herramienta', brand_name: 'Truper' },
      { part_number: 'FER-019', name: 'Llave Stilson 14"', category_name: 'Herramienta', brand_name: 'Truper' },
      { part_number: 'FER-020', name: 'Juego de Llaves Espanolas 8 pzas', category_name: 'Herramienta', brand_name: 'Truper' },
      { part_number: 'FER-021', name: 'Cinta Metrica 30m', category_name: 'Herramienta', brand_name: 'Truper' },
      { part_number: 'FER-022', name: 'Cutter Metalico', category_name: 'Herramienta', brand_name: 'Pretul' },
      { part_number: 'FER-023', name: 'Taladro Percutor 1/2"', category_name: 'Herramienta', brand_name: 'Truper' },
      { part_number: 'FER-024', name: 'Juego de Brocas 13 pzas', category_name: 'Herramienta', brand_name: 'Truper' },
      { part_number: 'FER-025', name: 'Guantes de Carnaza', category_name: 'Seguridad', brand_name: 'Truper' },
      { part_number: 'FER-026', name: 'Lentes de Seguridad', category_name: 'Seguridad', brand_name: 'Truper' },
      // Electrico
      { part_number: 'FER-027', name: 'Cinta de Aislar 3M', category_name: 'Electrico', brand_name: '3M' },
      { part_number: 'FER-028', name: 'Foco LED 9W', category_name: 'Electrico', brand_name: 'Tecnolite' },
      { part_number: 'FER-029', name: 'Foco LED 12W', category_name: 'Electrico', brand_name: 'Philips' },
      { part_number: 'FER-030', name: 'Contacto Duplex', category_name: 'Electrico', brand_name: 'Volteck' },
      { part_number: 'FER-031', name: 'Apagador Sencillo', category_name: 'Electrico', brand_name: 'Volteck' },
      { part_number: 'FER-032', name: 'Cable THW Cal 12 (metro)', category_name: 'Electrico', brand_name: 'IUSA' },
      { part_number: 'FER-033', name: 'Cable THW Cal 14 (metro)', category_name: 'Electrico', brand_name: 'IUSA' },
      { part_number: 'FER-034', name: 'Clavija de Hule', category_name: 'Electrico', brand_name: 'Volteck' },
      { part_number: 'FER-035', name: 'Extension Electrica 3m', category_name: 'Electrico', brand_name: 'Volteck' },
      { part_number: 'FER-036', name: 'Multicontacto 6 Tomas', category_name: 'Electrico', brand_name: 'Volteck' },
      // Plomeria
      { part_number: 'FER-037', name: 'Cinta Teflon 1/2"', category_name: 'Plomeria', brand_name: 'Foset' },
      { part_number: 'FER-038', name: 'Llave Angular 1/2"', category_name: 'Plomeria', brand_name: 'Foset' },
      { part_number: 'FER-039', name: 'Codo PVC 1/2"', category_name: 'Plomeria', brand_name: 'Foset' },
      { part_number: 'FER-040', name: 'Tubo PVC Hidraulico 1/2"', category_name: 'Plomeria', brand_name: 'Foset' },
      { part_number: 'FER-041', name: 'Pegamento para PVC 250ml', category_name: 'Plomeria', brand_name: 'Foset' },
      { part_number: 'FER-042', name: 'Flotador para Tinaco', category_name: 'Plomeria', brand_name: 'Foset' },
      { part_number: 'FER-043', name: 'Regadera Cromada', category_name: 'Plomeria', brand_name: 'Foset' },
      { part_number: 'FER-044', name: 'Manguera Reforzada 1/2" (metro)', category_name: 'Plomeria', brand_name: 'Truper' },
      // Pinturas y adhesivos
      { part_number: 'FER-045', name: 'Pintura Vinimex 1L', category_name: 'Pinturas', brand_name: 'Comex' },
      { part_number: 'FER-046', name: 'Pintura Vinimex 4L', category_name: 'Pinturas', brand_name: 'Comex' },
      { part_number: 'FER-047', name: 'Brocha 3"', category_name: 'Pinturas', brand_name: 'Pretul' },
      { part_number: 'FER-048', name: 'Rodillo con Extension', category_name: 'Pinturas', brand_name: 'Truper' },
      { part_number: 'FER-049', name: 'Thinner Estandar 1L', category_name: 'Pinturas', brand_name: 'Comex' },
      { part_number: 'FER-050', name: 'Pegamento Resistol 850 240ml', category_name: 'Adhesivos', brand_name: 'Resistol' },
      { part_number: 'FER-051', name: 'Silicon Transparente', category_name: 'Adhesivos', brand_name: 'Sika' },
      { part_number: 'FER-052', name: 'Lija para Pared #100', category_name: 'Pinturas', brand_name: 'Fandeli' }
    ]
  },
  {
    id: 'refaccionaria',
    nombre: 'Refaccionaria',
    icono: 'bi-gear-wide-connected',
    productos: [
      // Lubricantes
      { part_number: 'REF-001', name: 'Aceite Quaker State 20W50 1L', category_name: 'Lubricantes', brand_name: 'Quaker State' },
      { part_number: 'REF-002', name: 'Aceite Mobil Super 10W40 1L', category_name: 'Lubricantes', brand_name: 'Mobil' },
      { part_number: 'REF-003', name: 'Aceite Castrol GTX 15W40 1L', category_name: 'Lubricantes', brand_name: 'Castrol' },
      { part_number: 'REF-004', name: 'Aceite Sintetico Mobil 1 5W30 1L', category_name: 'Lubricantes', brand_name: 'Mobil' },
      { part_number: 'REF-005', name: 'Aceite Bardahl 5W20 1L', category_name: 'Lubricantes', brand_name: 'Bardahl' },
      { part_number: 'REF-006', name: 'Aceite Roshfrans 25W50 1L', category_name: 'Lubricantes', brand_name: 'Roshfrans' },
      { part_number: 'REF-007', name: 'Aceite ATF Transmision Quaker State 1L', category_name: 'Lubricantes', brand_name: 'Quaker State' },
      { part_number: 'REF-008', name: 'Anticongelante Prestone 1L', category_name: 'Lubricantes', brand_name: 'Prestone' },
      { part_number: 'REF-009', name: 'Grasa Multiusos Bardahl', category_name: 'Lubricantes', brand_name: 'Bardahl' },
      { part_number: 'REF-010', name: 'Liquido Direccion Hidraulica Bardahl', category_name: 'Lubricantes', brand_name: 'Bardahl' },
      // Filtros
      { part_number: 'REF-011', name: 'Filtro de Aceite Fram PH', category_name: 'Filtros', brand_name: 'Fram' },
      { part_number: 'REF-012', name: 'Filtro de Aire Fram', category_name: 'Filtros', brand_name: 'Fram' },
      { part_number: 'REF-013', name: 'Filtro de Gasolina Gonher', category_name: 'Filtros', brand_name: 'Gonher' },
      { part_number: 'REF-014', name: 'Filtro de Cabina Fram', category_name: 'Filtros', brand_name: 'Fram' },
      { part_number: 'REF-015', name: 'Filtro de Aceite Wix', category_name: 'Filtros', brand_name: 'Wix' },
      // Frenos
      { part_number: 'REF-016', name: 'Balatas Delanteras Fritec', category_name: 'Frenos', brand_name: 'Fritec' },
      { part_number: 'REF-017', name: 'Balatas Traseras Fritec', category_name: 'Frenos', brand_name: 'Fritec' },
      { part_number: 'REF-018', name: 'Liquido de Frenos DOT3 Bardahl', category_name: 'Frenos', brand_name: 'Bardahl' },
      { part_number: 'REF-019', name: 'Liquido de Frenos DOT4 Prestone', category_name: 'Frenos', brand_name: 'Prestone' },
      { part_number: 'REF-020', name: 'Disco de Freno Brembo', category_name: 'Frenos', brand_name: 'Brembo' },
      { part_number: 'REF-021', name: 'Tambor de Freno Brembo', category_name: 'Frenos', brand_name: 'Brembo' },
      { part_number: 'REF-022', name: 'Balatas Ceramicas Brembo', category_name: 'Frenos', brand_name: 'Brembo' },
      // Baterias
      { part_number: 'REF-023', name: 'Bateria LTH 45A', category_name: 'Baterias', brand_name: 'LTH' },
      { part_number: 'REF-024', name: 'Bateria LTH 65A', category_name: 'Baterias', brand_name: 'LTH' },
      { part_number: 'REF-025', name: 'Bateria ACDelco 47', category_name: 'Baterias', brand_name: 'ACDelco' },
      { part_number: 'REF-026', name: 'Cables Pasa Corriente', category_name: 'Baterias', brand_name: 'Truper' },
      // Encendido
      { part_number: 'REF-027', name: 'Bujia NGK Estandar', category_name: 'Encendido', brand_name: 'NGK' },
      { part_number: 'REF-028', name: 'Bujia Bosch Platino', category_name: 'Encendido', brand_name: 'Bosch' },
      { part_number: 'REF-029', name: 'Bujia Champion', category_name: 'Encendido', brand_name: 'Champion' },
      { part_number: 'REF-030', name: 'Cables de Bujia Bosch (juego)', category_name: 'Encendido', brand_name: 'Bosch' },
      { part_number: 'REF-031', name: 'Bobina de Encendido Bosch', category_name: 'Encendido', brand_name: 'Bosch' },
      { part_number: 'REF-032', name: 'Marcha Bosch', category_name: 'Encendido', brand_name: 'Bosch' },
      { part_number: 'REF-033', name: 'Alternador Valeo', category_name: 'Encendido', brand_name: 'Valeo' },
      { part_number: 'REF-034', name: 'Sensor de Oxigeno Denso', category_name: 'Encendido', brand_name: 'Denso' },
      // Bandas
      { part_number: 'REF-035', name: 'Banda de Distribucion Gates', category_name: 'Bandas', brand_name: 'Gates' },
      { part_number: 'REF-036', name: 'Banda Micro-V Gates', category_name: 'Bandas', brand_name: 'Gates' },
      { part_number: 'REF-037', name: 'Banda de Alternador Gates', category_name: 'Bandas', brand_name: 'Gates' },
      { part_number: 'REF-038', name: 'Tensor de Banda Gates', category_name: 'Bandas', brand_name: 'Gates' },
      // Aditivos
      { part_number: 'REF-039', name: 'Limpiador de Inyectores STP', category_name: 'Aditivos', brand_name: 'STP' },
      { part_number: 'REF-040', name: 'Limpia Carburador Bardahl', category_name: 'Aditivos', brand_name: 'Bardahl' },
      { part_number: 'REF-041', name: 'Aditivo Octanaje STP', category_name: 'Aditivos', brand_name: 'STP' },
      { part_number: 'REF-042', name: 'Tratamiento de Motor Bardahl No.1', category_name: 'Aditivos', brand_name: 'Bardahl' },
      { part_number: 'REF-043', name: 'Desengrasante de Motor Bardahl', category_name: 'Aditivos', brand_name: 'Bardahl' },
      // Electrico y accesorios
      { part_number: 'REF-044', name: 'Foco Halogeno H4 Osram', category_name: 'Electrico', brand_name: 'Osram' },
      { part_number: 'REF-045', name: 'Foco Halogeno H7 Philips', category_name: 'Electrico', brand_name: 'Philips' },
      { part_number: 'REF-046', name: 'Plumas Limpiaparabrisas Bosch (par)', category_name: 'Accesorios', brand_name: 'Bosch' },
      { part_number: 'REF-047', name: 'Liquido Limpiaparabrisas Bardahl', category_name: 'Accesorios', brand_name: 'Bardahl' },
      { part_number: 'REF-048', name: 'Fusibles Surtidos', category_name: 'Electrico', brand_name: 'Truper' },
      { part_number: 'REF-049', name: 'Claxon Caracol Hella', category_name: 'Electrico', brand_name: 'Hella' },
      { part_number: 'REF-050', name: 'Gato Hidraulico 2 Ton', category_name: 'Accesorios', brand_name: 'Truper' },
      { part_number: 'REF-051', name: 'Tapetes Uso Rudo (juego)', category_name: 'Accesorios', brand_name: 'Truper' },
      { part_number: 'REF-052', name: 'Aromatizante Little Trees', category_name: 'Accesorios', brand_name: 'Little Trees' }
    ]
  },
  {
    id: 'farmacias',
    nombre: 'Farmacias',
    icono: 'bi-capsule',
    productos: [
      // Analgesicos
      { part_number: 'FAR-001', name: 'Tempra 500mg (caja)', category_name: 'Analgesicos', brand_name: 'Tempra' },
      { part_number: 'FAR-002', name: 'Advil 400mg (caja)', category_name: 'Analgesicos', brand_name: 'Advil' },
      { part_number: 'FAR-003', name: 'Aspirina 500mg (caja)', category_name: 'Analgesicos', brand_name: 'Bayer' },
      { part_number: 'FAR-004', name: 'Naxen Naproxeno 250mg (caja)', category_name: 'Analgesicos', brand_name: 'Naxen' },
      { part_number: 'FAR-005', name: 'Motrin Ibuprofeno (caja)', category_name: 'Analgesicos', brand_name: 'Motrin' },
      { part_number: 'FAR-006', name: 'Tempra Jarabe Infantil', category_name: 'Analgesicos', brand_name: 'Tempra' },
      { part_number: 'FAR-007', name: 'Dolo-Neurobion (caja)', category_name: 'Analgesicos', brand_name: 'Neurobion' },
      // Gripa y tos
      { part_number: 'FAR-008', name: 'Next Tabletas (caja)', category_name: 'Antigripales', brand_name: 'Next' },
      { part_number: 'FAR-009', name: 'Desenfriol-D (caja)', category_name: 'Antigripales', brand_name: 'Desenfriol' },
      { part_number: 'FAR-010', name: 'Tabcin Dia y Noche (caja)', category_name: 'Antigripales', brand_name: 'Tabcin' },
      { part_number: 'FAR-011', name: 'Vick VapoRub 50g', category_name: 'Antigripales', brand_name: 'Vick' },
      { part_number: 'FAR-012', name: 'Sensibit D (caja)', category_name: 'Antigripales', brand_name: 'Sensibit' },
      { part_number: 'FAR-013', name: 'Jarabe para la Tos Bisolvon', category_name: 'Antigripales', brand_name: 'Bisolvon' },
      // Digestivo
      { part_number: 'FAR-014', name: 'Alka-Seltzer (sobres)', category_name: 'Digestivo', brand_name: 'Alka-Seltzer' },
      { part_number: 'FAR-015', name: 'Sal de Uvas Picot (sobre)', category_name: 'Digestivo', brand_name: 'Picot' },
      { part_number: 'FAR-016', name: 'Pepto-Bismol 120ml', category_name: 'Digestivo', brand_name: 'Pepto-Bismol' },
      { part_number: 'FAR-017', name: 'Melox Suspension', category_name: 'Digestivo', brand_name: 'Melox' },
      { part_number: 'FAR-018', name: 'Omeprazol Losec 20mg (caja)', category_name: 'Digestivo', brand_name: 'Losec' },
      { part_number: 'FAR-019', name: 'Treda Antidiarreico (caja)', category_name: 'Digestivo', brand_name: 'Treda' },
      { part_number: 'FAR-020', name: 'Sal Andrews (sobre)', category_name: 'Digestivo', brand_name: 'Andrews' },
      // Hidratacion
      { part_number: 'FAR-021', name: 'Electrolit 625ml', category_name: 'Hidratacion', brand_name: 'Electrolit' },
      { part_number: 'FAR-022', name: 'Suerox 630ml', category_name: 'Hidratacion', brand_name: 'Suerox' },
      { part_number: 'FAR-023', name: 'Pedialyte 500ml', category_name: 'Hidratacion', brand_name: 'Pedialyte' },
      // Primeros auxilios
      { part_number: 'FAR-024', name: 'Alcohol San Marcos 250ml', category_name: 'Primeros auxilios', brand_name: 'San Marcos' },
      { part_number: 'FAR-025', name: 'Agua Oxigenada San Marcos 250ml', category_name: 'Primeros auxilios', brand_name: 'San Marcos' },
      { part_number: 'FAR-026', name: 'Curitas (caja)', category_name: 'Primeros auxilios', brand_name: 'Curitas' },
      { part_number: 'FAR-027', name: 'Gasas Esteriles Le Roy', category_name: 'Primeros auxilios', brand_name: 'Le Roy' },
      { part_number: 'FAR-028', name: 'Cinta Microporosa Micropore 3M', category_name: 'Primeros auxilios', brand_name: '3M' },
      { part_number: 'FAR-029', name: 'Venda Elastica San Jorge', category_name: 'Primeros auxilios', brand_name: 'San Jorge' },
      { part_number: 'FAR-030', name: 'Algodon Le Roy 25g', category_name: 'Primeros auxilios', brand_name: 'Le Roy' },
      { part_number: 'FAR-031', name: 'Unguento Vitacilina', category_name: 'Primeros auxilios', brand_name: 'Vitacilina' },
      // Cuidado personal
      { part_number: 'FAR-032', name: 'Termometro Digital Citizen', category_name: 'Cuidado personal', brand_name: 'Citizen' },
      { part_number: 'FAR-033', name: 'Gel Antibacterial Escudo 250ml', category_name: 'Cuidado personal', brand_name: 'Escudo' },
      { part_number: 'FAR-034', name: 'Cubrebocas Ambiderm (caja 50)', category_name: 'Cuidado personal', brand_name: 'Ambiderm' },
      { part_number: 'FAR-035', name: 'Jabon Antibacterial Escudo', category_name: 'Cuidado personal', brand_name: 'Escudo' },
      { part_number: 'FAR-036', name: 'Rastrillo Gillette Prestobarba', category_name: 'Cuidado personal', brand_name: 'Gillette' },
      { part_number: 'FAR-037', name: 'Shampoo Head & Shoulders 375ml', category_name: 'Cuidado personal', brand_name: 'Head & Shoulders' },
      { part_number: 'FAR-038', name: 'Desodorante Rexona', category_name: 'Cuidado personal', brand_name: 'Rexona' },
      // Higiene bucal
      { part_number: 'FAR-039', name: 'Pasta Dental Colgate 100ml', category_name: 'Higiene bucal', brand_name: 'Colgate' },
      { part_number: 'FAR-040', name: 'Cepillo Dental Oral-B', category_name: 'Higiene bucal', brand_name: 'Oral-B' },
      { part_number: 'FAR-041', name: 'Enjuague Bucal Listerine 250ml', category_name: 'Higiene bucal', brand_name: 'Listerine' },
      // Vitaminas
      { part_number: 'FAR-042', name: 'Centrum (caja 30)', category_name: 'Vitaminas', brand_name: 'Centrum' },
      { part_number: 'FAR-043', name: 'Redoxon Vitamina C', category_name: 'Vitaminas', brand_name: 'Redoxon' },
      { part_number: 'FAR-044', name: 'Pharmaton (caja)', category_name: 'Vitaminas', brand_name: 'Pharmaton' },
      { part_number: 'FAR-045', name: 'Ensure Vainilla 400g', category_name: 'Vitaminas', brand_name: 'Ensure' },
      { part_number: 'FAR-046', name: 'Bedoyecta Tri (caja)', category_name: 'Vitaminas', brand_name: 'Bedoyecta' },
      // Bebe
      { part_number: 'FAR-047', name: 'Panal Huggies Etapa 3', category_name: 'Bebe', brand_name: 'Huggies' },
      { part_number: 'FAR-048', name: 'Panal KleenBebe Etapa 4', category_name: 'Bebe', brand_name: 'KleenBebe' },
      { part_number: 'FAR-049', name: 'Formula Nan 1', category_name: 'Bebe', brand_name: 'Nan' },
      { part_number: 'FAR-050', name: 'Formula Enfamil Premium', category_name: 'Bebe', brand_name: 'Enfamil' },
      { part_number: 'FAR-051', name: 'Toallitas Humedas Huggies', category_name: 'Bebe', brand_name: 'Huggies' },
      { part_number: 'FAR-052', name: 'Shampoo para Bebe Mennen', category_name: 'Bebe', brand_name: 'Mennen' }
    ]
  }
];
