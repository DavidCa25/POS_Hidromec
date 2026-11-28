import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { CarneService, Mes, kg, pesos } from './carne.service';

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const DIAS = ['L', 'M', 'Mi', 'J', 'V', 'S', 'D'];
const DIAS_LARGOS = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábados', 'domingos'];

/*
 * EL MES DE LA CARNE (0095)
 *
 * Cuánta carne se compró, cuántos tacos salieron, cuántos se fueron sin
 * cobrar (y cuánto es), qué día de la semana se pierde más y cómo rinde cada
 * carne contra su número. Todo de sp_rendimiento_mes.
 */
@Component({
  selector: 'app-carne-mes',
  standalone: true,
  imports: [RouterLink],
  templateUrl: './carne-mes.component.html',
  styleUrls: ['./carne.css'],
})
export class CarneMesComponent implements OnInit {
  private readonly carne = inject(CarneService);
  readonly kg = kg;
  readonly pesos = pesos;
  readonly diasCortos = DIAS;

  readonly periodo = signal<'SEMANA' | 'MES'>('MES');
  readonly datos = signal<Mes | null>(null);
  readonly hayCarnes = signal<boolean | null>(null);
  readonly cargando = signal(false);
  readonly error = signal('');

  readonly a = computed(() => this.datos()?.actual ?? null);
  readonly b = computed(() => this.datos()?.anterior ?? null);
  readonly maxDia = computed(() => Math.max(1, ...(this.datos()?.dias ?? []).map((d) => Number(d.se_fueron) || 0)));
  readonly peorDia = computed(() => {
    const ds = this.datos()?.dias ?? [];
    const total = ds.reduce((s, d) => s + Number(d.se_fueron || 0), 0);
    /* Con un solo día con pérdida, «casi la mitad, los jueves» no dice nada. */
    if (!total || ds.filter((d) => Number(d.se_fueron) > 0).length < 2) return null;
    const peor = ds.reduce((m, d) => (Number(d.se_fueron) > Number(m.se_fueron) ? d : m), ds[0]);
    return { dow: Number(peor.dow), parte: Number(peor.se_fueron) / total };
  });
  readonly titular = computed(() => {
    const a = this.a();
    if (!a || !Number(a.tacos)) return 'Todavía no hay cierres con carne contada';
    const cuando = this.periodo() === 'MES' ? 'Este mes' : 'Esta semana';
    return Number(a.se_fueron) ? `${cuando}: se fueron ${a.se_fueron} tacos sin cobrar` : `${cuando}: toda la carne rindió`;
  });
  readonly bajada = computed(() => {
    const p = this.peorDia(); const c = (this.datos()?.carnes ?? []).find((x) => Number(x.se_fueron) > 0);
    const partes: string[] = [];
    if (p && p.parte >= 0.3) partes.push(`${p.parte >= 0.6 ? 'La mayoría' : p.parte >= 0.45 ? 'Casi la mitad' : 'Buena parte'}, los ${DIAS_LARGOS[p.dow]}.`);
    if (c) partes.push(`El ${c.nombre.toLowerCase()} es el que más se escapa.`);
    return partes.join(' ');
  });

  async ngOnInit() {
    this.hayCarnes.set(await this.carne.activa());
    if (this.hayCarnes()) await this.cargar();
  }

  async cambiar(p: 'SEMANA' | 'MES') { this.periodo.set(p); await this.cargar(); }

  async cargar() {
    const hoy = new Date();
    const desde = this.periodo() === 'MES' ? new Date(hoy.getFullYear(), hoy.getMonth(), 1)
      : new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate() - ((hoy.getDay() + 6) % 7));
    this.cargando.set(true); this.error.set('');
    try { this.datos.set(await this.carne.mes(iso(desde), iso(hoy))); }
    catch (e: any) { this.error.set(e?.message || 'No se pudo leer el reporte.'); }
    finally { this.cargando.set(false); }
  }

  alto(v: number) { return `${Math.max(2, Math.round(82 * (Number(v) || 0) / this.maxDia()))}%`; }
  esPeor(dow: number) { return this.peorDia()?.dow === Number(dow); }
}
