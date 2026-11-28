import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import Swal from 'sweetalert2';
import { CARNES_TAQUERIA, CarneService, Platillo } from './carne.service';

interface Tile { clave: string; nombre: string; rinde: number; on: boolean; existe: boolean; platillos: string[]; }

/*
 * «¿QUÉ CARNES USAS Y CUÁNTOS TACOS TE SALEN POR KILO?» (0095)
 *
 * Un toque por carne y su número con − / +. Nada que escribir. Guardar crea
 * el insumo de cada carne (en gramos, se compra por kilo) y decide solo qué
 * platillo del menú cuenta tacos de cuál, por el nombre.
 */
@Component({
  selector: 'app-carne-arranque',
  standalone: true,
  imports: [RouterLink],
  templateUrl: './carne-arranque.component.html',
  styleUrls: ['./carne.css'],
})
export class CarneArranqueComponent implements OnInit {
  private readonly carne = inject(CarneService);
  private readonly router = inject(Router);

  readonly tiles = signal<Tile[]>(CARNES_TAQUERIA.map((c, i) => ({ ...c, on: i < 3, existe: false, platillos: [] })));
  readonly guardando = signal(false);
  readonly error = signal('');
  readonly elegidas = computed(() => this.tiles().filter((t) => t.on).length);

  async ngOnInit() {
    try {
      const { carnes, platillos } = await this.carne.config();
      if (!carnes.length) return;
      const porCarne = (id: number) => platillos.filter((p: Platillo) => p.carne_id === id).map((p) => p.nombre);
      this.tiles.update((ts) => ts.map((t) => {
        const c = carnes.find((x) => x.clave === `CARNE-${t.clave.toUpperCase()}`);
        return c ? { ...t, on: !!c.activo, rinde: Number(c.rinde), existe: true, platillos: porCarne(c.carne_id) } : { ...t, on: false };
      }));
    } catch (e: any) { this.error.set(e?.message || 'No se pudieron leer las carnes.'); }
  }

  gramos(t: Tile) { return `≈ ${Math.round(1000 / t.rinde)} g de carne por taco`; }
  toggle(i: number) { this.tiles.update((ts) => ts.map((t, k) => (k === i ? { ...t, on: !t.on } : t))); }
  cambiar(i: number, d: number) {
    this.tiles.update((ts) => ts.map((t, k) => (k === i ? { ...t, rinde: Math.max(4, Math.min(30, t.rinde + d)) } : t)));
  }

  async listo() {
    if (!this.elegidas()) return;
    this.guardando.set(true); this.error.set('');
    try {
      const { platillos } = await this.carne.guardar(this.tiles()
        .filter((t) => t.on || t.existe)
        .map((t) => ({ clave: t.clave, nombre: t.nombre, rinde: t.rinde, activo: t.on })));
      const n = platillos.length;
      void Swal.fire({ icon: 'success', title: 'Carnes listas', timer: 3200,
        text: n ? `${n} platillo${n > 1 ? 's' : ''} del menú ya cuentan tacos. Al cierre solo te preguntaremos cuánto quedó.`
                : 'Al cierre solo te preguntaremos cuánto quedó. Los tacos cuentan en cuanto estén en el menú.' });
      await this.router.navigate(['/dashboard/carne']);
    } catch (e: any) {
      this.error.set(e?.message || 'No se pudo guardar.');
    } finally { this.guardando.set(false); }
  }
}
