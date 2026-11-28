import { Component, EventEmitter, Input, OnInit, Output, computed, inject, signal } from '@angular/core';
import { CarneCierre, CarneDia, CarneService, Sugerencia, kg, pesos } from './carne.service';

interface Fila extends CarneCierre { opciones: number[]; quedo: number | null; pesado: string; }

/*
 * EL PRIMER PASO DEL CORTE: «¿CUÁNTA CARNE TE QUEDÓ?» (0095)
 *
 * Un toque por carne («Nada», «½ kg», «1 kg»…) o lo que marcó la báscula.
 * Mientras contesta ve si rindió normal o cuántos tacos faltan. Al seguir se
 * guarda y se enseña cómo rindió hoy; después, el corte de efectivo de
 * siempre. «Hoy no la conté» sigue sin guardar nada: esa noche se suma a la
 * siguiente.
 *
 * El veredicto en vivo usa la misma regla que sp_rendimiento_dia (más de 3
 * tacos y más del 3 %); el que queda guardado es el de SQL.
 */
@Component({
  selector: 'app-carne-cierre',
  standalone: true,
  templateUrl: './carne-cierre.component.html',
  styleUrls: ['./carne.css'],
})
export class CarneCierreComponent implements OnInit {
  @Input() closureId: number | null = null;
  /** Ya se contestó (o se saltó): sigue el efectivo. */
  @Output() listo = new EventEmitter<void>();
  @Output() cancelar = new EventEmitter<void>();

  private readonly carne = inject(CarneService);
  readonly kg = kg;
  readonly pesos = pesos;

  readonly filas = signal<Fila[]>([]);
  readonly cargando = signal(true);
  readonly guardando = signal(false);
  readonly error = signal('');
  readonly resultado = signal<{ carnes: CarneDia[]; sugerencias: Sugerencia[] } | null>(null);
  readonly ajustadas = signal<Record<number, 'ajustada' | 'dejada'>>({});

  readonly contestadas = computed(() => this.filas().filter((f) => f.quedo != null).length);
  readonly fuga = computed(() => this.filas().reduce((s, f) => {
    const v = this.veredicto(f); return v?.tipo === 'FALTA' ? s + v.valor : s;
  }, 0));

  async ngOnInit() {
    try {
      const filas = await this.carne.cierre(this.closureId);
      /* Este corte ya la contó (se volvió a abrir el cierre): directo al resultado. */
      if (filas.length && filas.every((f) => f.contado)) {
        this.resultado.set(await this.carne.dia(this.closureId));
      }
      this.filas.set(filas.map((f) => ({ ...f, opciones: this.opcionesDe(Number(f.tenia_kg)), quedo: f.contado ? Number(f.quedo_kg) : null, pesado: '' })));
    } catch (e: any) {
      this.error.set(e?.message || 'No se pudo leer la carne.');
    } finally { this.cargando.set(false); }
  }

  /** Botones a la medida de lo que había: de «Nada» hasta casi todo. */
  private opcionesDe(tenia: number): number[] {
    const base = tenia <= 3 ? [0, 0.5, 1, 1.5, 2, 2.5, 3] : tenia <= 8 ? [0, 0.5, 1, 2, 3, 4, 5] : [0, 1, 2, 3, 4, 5, 6];
    return base.filter((v) => v <= Math.max(0.5, tenia)).slice(0, 7);
  }
  textoOpcion(v: number) { return v === 0 ? 'Nada' : v === 0.5 ? '½ kg' : `${kg(v)} kg`; }

  elegir(i: number, v: number) {
    this.filas.update((fs) => fs.map((f, k) => (k === i ? { ...f, quedo: v, pesado: '' } : f)));
  }
  escribir(i: number, texto: string) {
    const n = Number(String(texto).replace(',', '.'));
    this.filas.update((fs) => fs.map((f, k) => (k === i
      ? { ...f, pesado: texto, quedo: texto.trim() === '' || !Number.isFinite(n) || n < 0 ? null : n } : f)));
  }
  elegido(f: Fila, v: number) { return f.quedo === v && !f.pesado; }

  usado(f: Fila) { return Math.max(0, Number(f.tenia_kg) - Number(f.quedo ?? 0)); }
  veredicto(f: Fila): { tipo: 'FALTA' | 'SOBRA' | 'NORMAL'; texto: string; valor: number } | null {
    if (f.quedo == null) return null;
    const esperados = Math.round(this.usado(f) * Number(f.rinde));
    const dif = esperados - Number(f.vendidos);
    const margen = Math.max(3, esperados * 0.03);
    const valor = Math.round(dif * Number(f.precio_taco ?? 0));
    if (dif > margen) return { tipo: 'FALTA', texto: `Faltan ${dif} tacos · ${pesos(valor)}`, valor };
    if (-dif > margen) return { tipo: 'SOBRA', texto: `Rindió de más · ${-dif} tacos`, valor: 0 };
    return { tipo: 'NORMAL', texto: 'Rindió normal', valor: 0 };
  }
  rindeHoy(f: Fila) { const u = this.usado(f); return u > 0 ? (Number(f.vendidos) / u).toFixed(1) : '—'; }

  async seguir() {
    if (this.resultado()) { this.listo.emit(); return; }
    const conteos = this.filas().filter((f) => f.quedo != null && !f.contado).map((f) => ({ carneId: f.carne_id, quedoKg: Number(f.quedo) }));
    if (!conteos.length) { this.listo.emit(); return; }
    this.guardando.set(true); this.error.set('');
    try {
      this.resultado.set(await this.carne.contar(this.closureId, conteos));
    } catch (e: any) {
      this.error.set(e?.message || 'No se pudo guardar la carne.');
    } finally { this.guardando.set(false); }
  }
  saltar() { this.listo.emit(); }

  // ------------------------------------------------------------ resultado
  readonly faltantes = computed(() => (this.resultado()?.carnes ?? []).filter((c) => c.veredicto === 'FALTA'));
  readonly costoHoy = computed(() => (this.resultado()?.carnes ?? []).reduce((s, c) => s + Number(c.costo_carne || 0), 0));
  readonly titular = computed(() => {
    const f = this.faltantes();
    if (!f.length) return 'Toda la carne rindió como siempre';
    if (f.length === 1) return `Se fueron ${f[0].faltan} tacos de ${f[0].nombre.toLowerCase()} sin cobrar`;
    return `Se fueron ${f.reduce((s, c) => s + Number(c.faltan), 0)} tacos sin cobrar`;
  });
  readonly subtitulo = computed(() => {
    const cs = this.resultado()?.carnes ?? [];
    const f = this.faltantes();
    const valor = f.reduce((s, c) => s + Number(c.valor_faltante || 0), 0);
    const normales = cs.filter((c) => c.veredicto !== 'FALTA').map((c) => c.nombre.toLowerCase());
    const partes: string[] = [];
    if (f.length) partes.push(`Unos ${pesos(valor)} de venta.`);
    if (normales.length && f.length) partes.push(`${normales.join(' y ').replace(/^./, (x) => x.toUpperCase())} rindi${normales.length > 1 ? 'eron' : 'ó'} bien.`);
    return partes.join(' ');
  });
  ancho(c: CarneDia) { const e = Math.max(Number(c.esperados), Number(c.vendidos), 1); return Math.round(100 * Number(c.vendidos) / e); }
  anchoFalta(c: CarneDia) { return c.veredicto === 'FALTA' ? 100 - this.ancho(c) : 0; }

  async ajustar(s: Sugerencia, aceptar: boolean) {
    if (aceptar) {
      try { await this.carne.ajustar(s.carne_id, Number(s.sugerido)); }
      catch (e: any) { this.error.set(e?.message || 'No se pudo ajustar.'); return; }
    }
    this.ajustadas.update((a) => ({ ...a, [s.carne_id]: aceptar ? 'ajustada' : 'dejada' }));
  }
}
