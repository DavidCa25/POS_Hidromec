import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import Swal from 'sweetalert2';
import { ModoTeclado, TecladoVirtualService } from '../wx-virtual-keyboard/teclado-virtual.service';

/**
 * Teclado en pantalla de ESTE equipo.
 *
 * Vive en device-config.json, igual que la experiencia de la caja: una
 * pantalla tactil de mostrador lo quiere siempre, y el equipo de la oficina
 * nunca. El teclado fisico funciona igual con cualquiera de los tres.
 */
@Component({
  selector: 'app-teclado-panel',
  standalone: true,
  imports: [CommonModule],
  styleUrls: ['../panel-controls.css'],
  template: `
  <div class="panel-content">
    <div class="section-title"><i class="ph ph-keyboard"></i> Teclado en pantalla</div>
    <p class="hint" style="margin-bottom:1rem;">
      Cuándo aparece el teclado de Wybix al tocar un campo. El teclado físico sigue funcionando siempre, también a la vez.
    </p>

    <div class="wx-choice-list" role="radiogroup" aria-label="Teclado en pantalla">
      <label class="wx-choice" *ngFor="let m of modos" [class.is-on]="t.modo() === m.valor">
        <input type="radio" name="modoTeclado" [value]="m.valor" [checked]="t.modo() === m.valor"
               (change)="elegir(m.valor)" [disabled]="guardando">
        <span class="wx-choice__ic"><i class="ph ph-{{ m.icono }}"></i></span>
        <span class="wx-choice__txt">
          <b>{{ m.titulo }}</b>
          <small>{{ m.desc }}</small>
        </span>
      </label>
    </div>

    <div class="section-title" style="margin-top:1.4rem;"><i class="ph ph-hand-tap"></i> Pruébalo</div>
    <div class="tk-prueba">
      <label><span>Buscar producto</span><input class="ctl" type="text" data-teclado="TEXT" placeholder="Texto"></label>
      <label><span>Precio</span><input class="ctl" type="text" data-teclado="MONEY" placeholder="0.00"></label>
      <label><span>Cantidad</span><input class="ctl" type="text" data-teclado="QUANTITY" placeholder="1"></label>
    </div>
    <div class="hint" style="margin-top:.8rem;">Aplica solo a esta máquina.</div>
  </div>
  `,
  styles: [`
    .tk-prueba { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; }
    .tk-prueba label { display: flex; flex-direction: column; gap: 4px; }
    .tk-prueba span { color: var(--wx-text-muted); font-size: var(--wx-text-xs); font-weight: 600; }
    @media (max-width: 720px) { .tk-prueba { grid-template-columns: 1fr; } }
  `],
})
export class TecladoPanelComponent {
  readonly t = inject(TecladoVirtualService);
  guardando = false;

  readonly modos: { valor: ModoTeclado; titulo: string; desc: string; icono: string }[] = [
    { valor: 'AUTO', titulo: 'Automático', desc: 'En una caja Touch, o cuando el campo se toca con el dedo. Con ratón y teclado no aparece.', icono: 'magic-wand' },
    { valor: 'SIEMPRE', titulo: 'Siempre', desc: 'En cualquier campo de escritura, aunque se use ratón.', icono: 'keyboard' },
    { valor: 'NUNCA', titulo: 'Nunca', desc: 'Solo el teclado físico.', icono: 'prohibit' },
  ];

  async elegir(m: ModoTeclado) {
    this.guardando = true;
    try {
      const ok = await this.t.fijarModo(m);
      if (!ok) await Swal.fire({ icon: 'error', title: 'No se pudo guardar' });
    } finally {
      this.guardando = false;
    }
  }
}
