import { Component, EventEmitter, Input, Output, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';

export interface MapaSucursal { id: string; nombre: string; es_matriz: boolean; }
/** Un envío que todavía no se recibe: un camión en la calle. */
export interface MapaEnvio {
  clave: string; desdeId: string | null; haciaId: string | null; desdeNombre: string; haciaNombre: string;
  piezas: number; hora: string | null; quien: string | null; entrante: boolean;
  lineas?: Array<{ nombre: string; qty: number }>;
}
/** Lo que dice la etiqueta flotante de cada local. */
export interface MapaEtiqueta { sub: string; tono?: 'ok' | 'warn' | 'acc' | null; }

interface Poligono { puntos: string; color: string; }
interface Local { id: string; nombre: string; matriz: boolean; aqui: boolean; x: number; ancho: number; formas: Poligono[]; tag: { x: number; y: number }; pin: { x: number; y: number }; }
interface Camion { envio: MapaEnvio; formas: Poligono[]; ruedas: { x: number; y: number }[]; texto: { x: number; y: number; t: string }; tx: number; ty: number; ruta: string; demora: number; }

/* Proyección isométrica (unidades del mundo -> pixeles del SVG). */
const iso = (x: number, y: number, z = 0): [number, number] => [(x - y) * 0.866, (x + y) * 0.5 - z];
const pts = (a: [number, number][]) => a.map(p => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');
function caja(x: number, y: number, w: number, d: number, h: number, c: [string, string, string], z = 0): Poligono[] {
  return [
    { puntos: pts([iso(x, y + d, z), iso(x + w, y + d, z), iso(x + w, y + d, z + h), iso(x, y + d, z + h)]), color: c[1] },
    { puntos: pts([iso(x + w, y, z), iso(x + w, y + d, z), iso(x + w, y + d, z + h), iso(x + w, y, z + h)]), color: c[2] },
    { puntos: pts([iso(x, y, z + h), iso(x + w, y, z + h), iso(x + w, y + d, z + h), iso(x, y + d, z + h)]), color: c[0] },
  ];
}
const piso = (x: number, y: number, w: number, d: number, color: string): Poligono =>
  ({ puntos: pts([iso(x, y), iso(x + w, y), iso(x + w, y + d), iso(x, y + d)]), color });

const BLANCO: [string, string, string] = ['#FFFFFF', '#E8EEF2', '#D3DEE6'];
const TECHO: [string, string, string] = ['#F4F7F9', '#DCE5EB', '#C6D3DC'];
const NAVY: [string, string, string] = ['#33536B', '#1E3547', '#152836'];
const CIAN: [string, string, string] = ['#5FCEDE', '#2A8494', '#1F6C7A'];
const VIDRIO: [string, string, string] = ['#BFE7EE', '#8FCFDA', '#8FCFDA'];
const CAJA_CAMION: [string, string, string] = ['#FFFFFF', '#E6EDF2', '#D0DCE4'];
const TOLDOS: [string, string, string][] = [
  ['#F7C9D4', '#E39AAE', '#C97E93'], ['#C9E3F7', '#8DBCE3', '#6E9FCB'], ['#F7E3B5', '#E8C46E', '#CFA650'],
  ['#D3EEC9', '#9FD08C', '#82B771'], ['#E2D3F5', '#BDA3E6', '#9F84CC'],
];
/** Lo que ocupa cada sucursal a lo largo de la calle. */
const PASO = 330;
const CARRIL_IDA = 66, CARRIL_VUELTA = 30;

/*
 * MULTISUCURSAL · EL MAPA DE TRASPASOS (la escena).
 *
 * Una calle isométrica con un local por sucursal y un camión por cada envío
 * que todavía no se recibe. El camión recorre su ruta -del local que manda al
 * que recibe- rotulado con el nombre del local que lo manda («Wybix» solo si
 * no tiene nombre).
 *
 * Solo dibuja: los indicadores, el panel de la sucursal, el seguimiento y las
 * ventanas de enviar y recibir son del componente de Traspasos, encima de esta
 * escena. Todo lo dibujado es un dato y se puede tocar.
 *
 * SVG generado aquí, sin librerías. El viaje del camión es un transform en CSS
 * (lo compone la GPU); con movimiento reducido el camión queda quieto a medio
 * camino.
 */
@Component({
  selector: 'app-traspasos-mapa',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './traspasos-mapa.component.html',
  styleUrls: ['./traspasos-mapa.component.css'],
})
export class TraspasosMapaComponent {
  private readonly _sucursales = signal<MapaSucursal[]>([]);
  private readonly _aqui = signal<string | null>(null);
  private readonly _envios = signal<MapaEnvio[]>([]);
  private readonly _etiquetas = signal<Record<string, MapaEtiqueta>>({});
  readonly horno = signal(0);
  readonly elegida = signal<string | null>(null);
  readonly envioElegido = signal<string | null>(null);

  @Input() set sucursales(v: MapaSucursal[] | null) { this._sucursales.set(v ?? []); }
  @Input() set locationId(v: string | null) { this._aqui.set(v); }
  @Input() set envios(v: MapaEnvio[] | null) { this._envios.set(v ?? []); }
  @Input() set etiquetas(v: Record<string, MapaEtiqueta> | null) { this._etiquetas.set(v ?? {}); }
  /** Tandas en preparación aquí: aparece el horno junto a tu local. */
  @Input() set enHorno(v: number | null) { this.horno.set(v ?? 0); }
  @Input() set sucursalElegida(v: string | null) { this.elegida.set(v); }
  @Input() set envio(v: string | null) { this.envioElegido.set(v); }
  @Output() tocarSucursal = new EventEmitter<string>();
  @Output() tocarEnvio = new EventEmitter<MapaEnvio>();

  private readonly largo = computed(() => Math.max(2, this._sucursales().length) * PASO);

  readonly terreno = computed<Poligono[]>(() => {
    const L = this.largo(), x0 = -L / 2 - 140, w = L + 280;
    return [
      piso(x0, -320, w, 560, '#E4ECF0'),
      piso(x0 + 10, -310, w - 20, 312, '#DCEBD9'), piso(x0 + 10, 124, w - 20, 110, '#DCEBD9'),
      piso(x0, 18, w, 86, '#BFCBD3'), piso(x0, 12, w, 6, '#F6F8FA'), piso(x0, 104, w, 6, '#F6F8FA'),
      ...Array.from({ length: Math.floor(w / 54) }, (_, k) => piso(x0 + 12 + k * 54, 59, 28, 4, '#FFFFFF')),
    ];
  });

  readonly locales = computed<Local[]>(() => {
    const s = [...this._sucursales()].sort((a, b) => Number(b.es_matriz) - Number(a.es_matriz) || a.nombre.localeCompare(b.nombre));
    const x0 = -this.largo() / 2;
    return s.map((suc, i) => {
      const w = PASO - 90, x = x0 + i * PASO + 45, y = -200, d = 160, h = suc.es_matriz ? 120 : 90;
      const toldo = TOLDOS[i % TOLDOS.length];
      const formas = suc.es_matriz
        ? [...caja(x, y, w, d, h, BLANCO), ...caja(x + 10, y + 10, w - 20, d - 20, 8, TECHO, h),
           ...caja(x + 30, y + 30, 60, 50, 30, ['#C6D3DC', '#B0C0CB', '#9EB0BC'], h + 8),
           ...caja(x + w * 0.22, y + d, w * 0.5, 6, 62, CIAN), ...caja(x + w * 0.22, y + d, w * 0.5, 5, 7, VIDRIO, 62),
           ...caja(x + w * 0.8, y + d, 26, 5, 50, NAVY)]
        : [...caja(x, y, w, d, h, BLANCO), ...caja(x, y, w, d, 10, toldo, h),
           ...caja(x + w * 0.18, y + d, w * 0.64, 6, 52, NAVY),
           ...caja(x + w * 0.12, y + d, w * 0.76, 18, 7, toldo, 54)];
      const [tx, ty] = iso(x + w / 2, y + d, h * 0.55);
      const [px, py] = iso(x + w / 2, y + d / 2, h + 10);
      return { id: suc.id, nombre: suc.nombre, matriz: suc.es_matriz, aqui: suc.id === this._aqui(), x: x + w / 2, ancho: w, formas, tag: { x: tx, y: ty }, pin: { x: px, y: py } };
    });
  });

  /** El horno junto a tu local, con una tarima de cajas. */
  readonly hornoFormas = computed<Poligono[]>(() => {
    const aqui = this.locales().find(l => l.aqui);
    if (!aqui || !this.horno()) return [];
    const x = aqui.x + aqui.ancho / 2 + 6, y = -150;
    return [...caja(x, y, 46, 40, 40, ['#C2CCD3', '#8E9BA5', '#76838D']), ...caja(x + 10, y + 40, 26, 2, 12, ['#E0A33E', '#E0A33E', '#C98A2A'], 18),
      ...caja(x + 4, y + 52, 22, 22, 4, ['#C8A47A', '#A9865E', '#8E6E4A']), ...caja(x + 6, y + 54, 18, 18, 16, ['#E7C99D', '#CFAE7D', '#B9965F'], 4)];
  });

  readonly arboles = computed(() => {
    const L = this.locales(), m = this.largo() / 2;
    const lugares: [number, number][] = [[-m - 90, -120], [m + 70, -230], [-m - 60, 170], [m + 50, 160], [-m / 2, 190], [m / 3, 200]];
    for (let i = 0; i < L.length - 1; i++) lugares.push([(L[i].x + L[i + 1].x) / 2, -40]);
    return lugares.map(([x, y]) => {
      const [a, b] = iso(x + 4, y + 4, 34);
      return { tronco: caja(x, y, 8, 8, 24, ['#7A5A3A', '#5E4630', '#4A3726']), copa: { x: a, y: b } };
    });
  });

  /** Un camión por envío: sale de su local y recorre la calle hasta el otro. */
  readonly camiones = computed<Camion[]>(() => {
    const L = this.locales(), n = this._envios().length;
    return this._envios().map((e, k) => {
      const desde = L.find(l => l.id === e.desdeId) ?? L.find(l => l.nombre === e.desdeNombre) ?? L[0];
      const hacia = L.find(l => l.id === e.haciaId) ?? L.find(l => l.nombre === e.haciaNombre) ?? L[L.length - 1];
      const ida = (hacia?.x ?? 0) >= (desde?.x ?? 0);
      const my = ida ? CARRIL_IDA : CARRIL_VUELTA;
      const largo = 150;
      // Arranca frente al local que manda y llega frente al que recibe.
      const x0 = (desde?.x ?? 0) - (ida ? 40 : largo - 40), x1 = (hacia?.x ?? 0) - (ida ? largo - 20 : 20);
      const formas = ida
        ? [...caja(x0, my, 116, 32, 58, CAJA_CAMION), ...caja(x0 + 116, my + 2, 34, 28, 42, CIAN), ...caja(x0 + 132, my + 4, 10, 24, 17, VIDRIO, 23)]
        : [...caja(x0 + 34, my, 116, 32, 58, CAJA_CAMION), ...caja(x0, my + 2, 34, 28, 42, CIAN), ...caja(x0 + 8, my + 4, 10, 24, 17, VIDRIO, 23)];
      const ruedas = (ida ? [18, 92, 136] : [14, 58, 132]).map(dx => { const [x, y] = iso(x0 + dx, my + 32); return { x, y }; });
      const [tx, ty] = iso(x0 + (ida ? 58 : 92), my + 32, 26);
      const [ax, ay] = iso(x0, my), [bx, by] = iso(x1, my);
      const [r0x, r0y] = iso(desde?.x ?? 0, -36), [r1x, r1y] = iso(desde?.x ?? 0, my + 16), [r2x, r2y] = iso(hacia?.x ?? 0, my + 16), [r3x, r3y] = iso(hacia?.x ?? 0, -36);
      const t = (e.desdeNombre || '').trim() || 'Wybix';
      return { envio: e, formas, ruedas, texto: { x: tx, y: ty, t: t.length > 14 ? t.slice(0, 13) + '…' : t },
        tx: bx - ax, ty: by - ay, ruta: `${r0x},${r0y} ${r1x},${r1y} ${r2x},${r2y} ${r3x},${r3y}`, demora: -((k + 0.5) / Math.max(1, n)) * 7 };
    });
  });

  /** El cuadro que encierra la calle y los locales: la escena se ajusta a él. */
  readonly vista = computed(() => {
    const todos = [...this.locales().flatMap(l => l.formas), this.terreno()[3]].flatMap(p => p.puntos.split(' ').map(q => q.split(',').map(Number)));
    const xs = todos.map(p => p[0]), ys = todos.map(p => p[1]);
    // Margen asimétrico: a la derecha flota el panel de la sucursal, arriba los
    // indicadores y abajo el seguimiento; los locales caen en el hueco libre.
    const x0 = Math.min(...xs) - 200, x1 = Math.max(...xs) + 640, y0 = Math.min(...ys) - 470, y1 = Math.max(...ys) + 300;
    return `${x0.toFixed(0)} ${y0.toFixed(0)} ${(x1 - x0).toFixed(0)} ${(y1 - y0).toFixed(0)}`;
  });

  etiqueta(id: string) { return this._etiquetas()[id] ?? null; }
}
