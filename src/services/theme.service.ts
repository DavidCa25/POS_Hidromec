import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';

/** Un color de la paleta de tablas. */
export interface AccentPreset {
  nombre: string;
  valor: string;
}

/**
 * Paleta de acentos para las tablas.
 *
 * Elegida con un criterio: todos rondan la misma PROFUNDIDAD (equivalente a
 * un paso 700-800), de modo que la fila de muestras se lee como un sistema y
 * no como un arcoíris. Todos sostienen texto blanco con holgura, así que
 * ninguno depende de que el cálculo de tinta les rescate.
 *
 * El usuario puede salirse de aquí con "Personalizado": la paleta es un
 * atajo con buen gusto, no una restricción.
 */
export const ACCENT_PRESETS: AccentPreset[] = [
  { nombre: 'Navy Wybix', valor: '#1F2E86' },
  { nombre: 'Índigo',     valor: '#4338CA' },
  { nombre: 'Azul',       valor: '#1D4ED8' },
  { nombre: 'Cyan',       valor: '#0E7490' },
  { nombre: 'Teal',       valor: '#0F766E' },
  { nombre: 'Esmeralda',  valor: '#047857' },
  { nombre: 'Verde',      valor: '#15803D' },
  { nombre: 'Oliva',      valor: '#4D7C0F' },
  { nombre: 'Ámbar',      valor: '#B45309' },
  { nombre: 'Naranja',    valor: '#C2410C' },
  { nombre: 'Rojo',       valor: '#B91C1C' },
  { nombre: 'Rosa',       valor: '#BE185D' },
  { nombre: 'Violeta',    valor: '#6D28D9' },
  { nombre: 'Café',       valor: '#78350F' },
  { nombre: 'Pizarra',    valor: '#334155' },
  { nombre: 'Grafito',    valor: '#1F2937' },
];

/**
 * Tema de la aplicación: modo claro/oscuro y color de acento de las tablas.
 *
 * El color elegido es una FUENTE de acento, no la pintura de la tabla: de él
 * se derivan la tinta legible encima, la variante tenue para hover y
 * selección, la línea y una versión legible como texto sobre la superficie
 * del tema. Todas las derivaciones se recalculan al cambiar de tema.
 *
 * Nada aquí toca reglas de negocio: es exclusivamente presentación.
 */
@Injectable({ providedIn: 'root' })
export class ThemeService {
  private readonly KEY = 'inv-main-color';
  private readonly DARK_KEY = 'ui-dark';

  private invMain$ = new BehaviorSubject<string>(this.load());
  private dark$ = new BehaviorSubject<boolean>(this.loadDark());

  readonly presets = ACCENT_PRESETS;

  constructor() {
    this.apply(this.invMain$.value);
    this.applyDark(this.dark$.value);
  }

  // ---------- Color de acento ----------
  setInvMain(color: string) {
    const limpio = ThemeService.normalizarHex(color);
    if (!limpio) return;
    localStorage.setItem(this.KEY, limpio);
    this.invMain$.next(limpio);
    this.apply(limpio);
  }

  /**
   * Aplica un color SIN persistirlo. Lo usa la vista previa del selector
   * personalizado: el usuario ve el efecto en las tablas mientras arrastra,
   * y sólo se guarda si confirma.
   */
  previewInvMain(color: string) {
    const limpio = ThemeService.normalizarHex(color);
    if (limpio) this.apply(limpio);
  }

  /** Descarta una vista previa y vuelve al color guardado. */
  cancelPreview() {
    this.apply(this.invMain$.value);
  }

  getInvMain$() { return this.invMain$.asObservable(); }
  getInvMainSnapshot() { return this.invMain$.value; }

  // ---------- Modo oscuro ----------
  getDark$() { return this.dark$.asObservable(); }
  isDark(): boolean { return this.dark$.value; }
  toggleDark() { this.setDark(!this.dark$.value); }
  setDark(on: boolean) {
    localStorage.setItem(this.DARK_KEY, on ? '1' : '0');
    this.dark$.next(on);
    this.applyDark(on);
  }

  // ---------- Persistencia ----------
  private load(): string {
    return ThemeService.normalizarHex(localStorage.getItem(this.KEY) || '') || '#1F2E86';
  }
  private loadDark(): boolean {
    return localStorage.getItem(this.DARK_KEY) === '1';
  }

  // ---------- Aplicación al DOM ----------
  private apply(color: string) {
    const root = document.documentElement;
    const oscuro = this.dark$.value;
    const superficie = oscuro ? '#16233A' : '#FFFFFF';

    // `--inv-main` se conserva: lo usan inventario, conteo y compras.
    root.style.setProperty('--inv-main', color);
    root.style.setProperty('--inv-main-dark', ThemeService.mezclar(color, '#000000', 0.18));

    // El color, tal cual, para la cabecera y la paginación activa.
    root.style.setProperty('--wx-user-accent', color);
    // Tinta legible ENCIMA del color.
    root.style.setProperty('--wx-user-accent-fg', ThemeService.tintaLegible(color));

    const rgb = ThemeService.aRgb(color)!;
    const [r, g, b] = rgb;

    // Variantes tenues para hover, selección y línea. En oscuro necesitan más
    // cuerpo: la misma alfa sobre navy casi no se ve.
    root.style.setProperty('--wx-user-accent-soft', `rgb(${r} ${g} ${b} / ${oscuro ? 0.22 : 0.10})`);
    root.style.setProperty('--wx-user-accent-line', `rgb(${r} ${g} ${b} / ${oscuro ? 0.45 : 0.34})`);
    root.style.setProperty('--wx-user-accent-ring', `rgb(${r} ${g} ${b} / 0.35)`);

    // Versión legible como TEXTO sobre la superficie del tema. Sin esto, un
    // amarillo pálido elegido por el usuario sería ilegible en claro, y un
    // navy muy oscuro lo sería en oscuro.
    root.style.setProperty(
      '--wx-user-accent-text',
      ThemeService.legibleSobre(color, superficie, 4.5),
    );
  }

  private applyDark(on: boolean) {
    document.documentElement.classList.toggle('dark', on);
    // Las derivaciones dependen del tema: se recalculan.
    this.apply(this.invMain$.value);
  }

  // ==========================================================================
  // Utilidades de color
  // ==========================================================================

  /** Acepta '#rgb', '#rrggbb' o 'rrggbb'. Devuelve '#RRGGBB' o null. */
  static normalizarHex(hex: string): string | null {
    let h = (hex || '').trim().replace('#', '');
    if (h.length === 3) h = h.split('').map(c => c + c).join('');
    if (!/^[0-9a-fA-F]{6}$/.test(h)) return null;
    return '#' + h.toUpperCase();
  }

  private static aRgb(hex: string): [number, number, number] | null {
    const h = ThemeService.normalizarHex(hex);
    if (!h) return null;
    const s = h.slice(1);
    return [0, 2, 4].map(i => parseInt(s.substr(i, 2), 16)) as [number, number, number];
  }

  /** Luminancia relativa (WCAG 2.1). */
  private static luminancia(rgb: [number, number, number]): number {
    const [r, g, b] = rgb.map(v => {
      const c = v / 255;
      return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }

  private static ratioL(a: number, b: number): number {
    const hi = Math.max(a, b), lo = Math.min(a, b);
    return (hi + 0.05) / (lo + 0.05);
  }

  /** Contraste entre dos colores. Público: la vista lo usa para el aviso. */
  static contraste(a: string, b: string): number {
    const ra = ThemeService.aRgb(a), rb = ThemeService.aRgb(b);
    if (!ra || !rb) return 1;
    return ThemeService.ratioL(ThemeService.luminancia(ra), ThemeService.luminancia(rb));
  }

  /**
   * Tinta legible ENCIMA de `hex`.
   *
   * El usuario puede elegir cualquier color, incluido un amarillo puro o un
   * blanco. Se comparan blanco y una tinta casi negra, y gana la de mayor
   * contraste: la cabecera nunca queda ilegible.
   */
  static tintaLegible(hex: string): string {
    const rgb = ThemeService.aRgb(hex);
    if (!rgb) return '#FFFFFF';
    const l = ThemeService.luminancia(rgb);
    const conBlanco = ThemeService.ratioL(l, 1);
    const conTinta = ThemeService.ratioL(l, ThemeService.luminancia([10, 18, 25]));
    return conBlanco >= conTinta ? '#FFFFFF' : '#0A1219';
  }

  /**
   * Devuelve una variante de `color` que alcance `objetivo` de contraste
   * sobre `fondo`, oscureciéndola o aclarándola según haga falta.
   *
   * Es lo que permite aceptar CUALQUIER color sin romper la legibilidad: un
   * amarillo se oscurece para poder usarse como texto sobre blanco, y un
   * navy se aclara para poder usarse como texto sobre navy. Si ni el negro
   * ni el blanco puros alcanzan el objetivo, devuelve el extremo más
   * contrastado, que es lo mejor disponible.
   */
  static legibleSobre(color: string, fondo: string, objetivo = 4.5): string {
    if (ThemeService.contraste(color, fondo) >= objetivo) {
      return ThemeService.normalizarHex(color)!;
    }
    const fondoRgb = ThemeService.aRgb(fondo)!;
    const fondoClaro = ThemeService.luminancia(fondoRgb) > 0.45;
    const destino = fondoClaro ? '#000000' : '#FFFFFF';

    let mejor = ThemeService.normalizarHex(color)!;
    // 20 pasos de mezcla: suficiente resolución y coste trivial.
    for (let i = 1; i <= 20; i++) {
      const candidato = ThemeService.mezclar(color, destino, i / 20);
      mejor = candidato;
      if (ThemeService.contraste(candidato, fondo) >= objetivo) break;
    }
    return mejor;
  }

  /** Mezcla `hex` con `con` en proporción `p` (0..1). */
  static mezclar(hex: string, con: string, p: number): string {
    const a = ThemeService.aRgb(hex);
    const b = ThemeService.aRgb(con);
    if (!a || !b) return hex;
    const m = a.map((v, i) => Math.round(v + (b[i] - v) * p));
    return '#' + m.map(v => v.toString(16).padStart(2, '0')).join('').toUpperCase();
  }
}
