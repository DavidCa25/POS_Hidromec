import { Modalidad } from '../salud.service';

/** Las modalidades de imagen, en el orden en que se ofrecen. Mismo catálogo que el CHECK de la base. */
export const MODALIDADES: { valor: Modalidad; etiqueta: string }[] = [
  { valor: 'RX', etiqueta: 'Rayos X' },
  { valor: 'MASTOGRAFIA', etiqueta: 'Mastografía' },
  { valor: 'USG', etiqueta: 'Ultrasonido' },
  { valor: 'DENSITOMETRIA', etiqueta: 'Densitometría' },
  { valor: 'TAC', etiqueta: 'Tomografía' },
  { valor: 'RM', etiqueta: 'Resonancia magnética' },
  { valor: 'OTRO', etiqueta: 'Otro estudio de imagen' },
];

/** BI-RADS: la categoría de la mastografía (ACR, 5.ª ed.). */
export const BIRADS: { valor: number; etiqueta: string }[] = [
  { valor: 0, etiqueta: '0 · Incompleto: requiere estudios adicionales' },
  { valor: 1, etiqueta: '1 · Negativo' },
  { valor: 2, etiqueta: '2 · Hallazgos benignos' },
  { valor: 3, etiqueta: '3 · Probablemente benigno: control a corto plazo' },
  { valor: 4, etiqueta: '4 · Sospechoso: se sugiere biopsia' },
  { valor: 5, etiqueta: '5 · Altamente sugestivo de malignidad' },
  { valor: 6, etiqueta: '6 · Malignidad confirmada por biopsia' },
];
