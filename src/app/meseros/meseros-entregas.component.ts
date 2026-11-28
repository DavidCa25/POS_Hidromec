import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import Swal from 'sweetalert2';
import { RegisterService } from '../../services/register.service';

export interface BolsaMesero {
  mesero_id: number; usuario: string; mesas: number; cobrado: number; propinas: number;
  en_bolsa: number; entregado: number; por_entregar: number; diferencia: number;
}

const pesos = (n: number | null | undefined) =>
  Number(n ?? 0).toLocaleString('es-MX', { style: 'currency', currency: 'MXN' });

/*
 * ENTREGAS DE MESEROS (0097)
 *
 * Cada mesero cobra sus mesas en la tablet y trae el efectivo. Aquí la caja
 * ve quién trae cuánto y recibe lo que entrega cada uno: lo entregado entra
 * al cajón (el corte lo espera) y la diferencia queda a nombre del mesero.
 */
@Component({
  selector: 'app-meseros-entregas',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './meseros-entregas.component.html',
  styleUrls: ['./meseros-entregas.component.css'],
})
export class MeserosEntregasComponent implements OnInit {
  private readonly register = inject(RegisterService);
  readonly pesos = pesos;
  readonly meseros = signal<BolsaMesero[]>([]);
  readonly cargando = signal(true);
  readonly error = signal('');
  readonly recibiendo = signal<number | null>(null);
  monto: number | null = null;
  readonly porEntregar = computed(() => this.meseros().reduce((s, m) => s + Number(m.por_entregar || 0), 0));

  private get api(): any { return (window as any).wybix?.meseros; }

  async ngOnInit() { await this.cargar(); }

  async cargar() {
    this.cargando.set(true); this.error.set('');
    try {
      const r = await this.api?.resumen();
      if (!r?.success) throw new Error(r?.error || 'No se pudieron leer los meseros.');
      this.meseros.set((r.data ?? []).map((x: any) => ({ ...x, mesero_id: Number(x.mesero_id) })));
    } catch (e: any) { this.error.set(e?.message || 'No se pudieron leer los meseros.'); }
    finally { this.cargando.set(false); }
  }

  abrir(m: BolsaMesero) { this.recibiendo.set(m.mesero_id); this.monto = Number(m.por_entregar) || null; }
  cancelar() { this.recibiendo.set(null); this.monto = null; }

  async recibir(m: BolsaMesero) {
    const entregado = Number(this.monto);
    if (!Number.isFinite(entregado) || entregado < 0) return;
    const r = await this.api?.entregar({ meseroId: m.mesero_id, entregado, registerId: this.register.registerId });
    if (!r?.success) { await Swal.fire({ icon: 'error', title: 'No se recibió', text: r?.error || 'Inténtalo de nuevo.' }); return; }
    const e = r.data?.[0] ?? {};
    const dif = Number(e.diferencia || 0);
    void Swal.fire({
      icon: dif < 0 ? 'warning' : 'success',
      title: dif === 0 ? 'Entrega completa' : dif < 0 ? `Le faltaron ${pesos(-dif)}` : `Le sobraron ${pesos(dif)}`,
      text: `${m.usuario} entregó ${pesos(entregado)}. Ya está en el cajón y saldrá en el corte.`,
      ...(dif === 0 ? { timer: 3200 } : {}),
    });
    this.cancelar();
    await this.cargar();
  }
}
