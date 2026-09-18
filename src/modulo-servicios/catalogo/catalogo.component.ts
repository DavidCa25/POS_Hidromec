import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import Swal from 'sweetalert2';
import { AuthService, PAQUETES } from '../../services/auth.service';
import { Servicio, ServiciosService } from '../servicios.service';

/**
 * EL CATÁLOGO DE SERVICIOS.
 *
 * Lo que el negocio cobra por trabajo: el cambio de aceite, el corte, la
 * consulta. Cada uno es un producto de Wybix con una ficha de más, no una cosa
 * aparte: por eso aparece en la venta, en la factura y en los reportes sin que
 * nadie tenga que hacer nada.
 *
 * ENLAZAR UN PRODUCTO QUE YA ESTABA
 * ---------------------------------
 * El taller que lleva años cobrando «Mano de obra» como un producto más no
 * tiene que darlo de alta otra vez: se enlaza, y conserva su historial de
 * ventas. Es la diferencia entre empezar de cero y seguir donde se estaba.
 */
@Component({
  selector: 'app-servicios-catalogo',
  standalone: true,
  imports: [CommonModule, FormsModule],
  styleUrls: ['../servicios.css'],
  template: `
  <div class="srv-pagina">
    <header class="srv-cab">
      <div>
        <h1>Catálogo de servicios</h1>
        <p class="srv-sub">Lo que tu negocio cobra por trabajo.</p>
      </div>
      <div style="margin-left:auto;display:flex;gap:8px;flex-wrap:wrap" *ngIf="puedeAdministrar">
        <button class="btn" (click)="enlazar()">Enlazar un producto</button>
        <button class="btn btn-primary" (click)="editar(null)">Nuevo servicio</button>
      </div>
    </header>

    <div class="srv-barra">
      <input class="ctl" type="search" placeholder="Buscar servicio…"
             [ngModel]="busqueda()" (ngModelChange)="buscar($event)" aria-label="Buscar servicios" />
      <label class="srv-hint" style="display:flex;align-items:center;gap:6px">
        <input type="checkbox" [ngModel]="verRetirados()" (ngModelChange)="verRetirados.set($event); cargar()" />
        Ver retirados
      </label>
    </div>

    <div class="srv-tabla-wrap">
      <table class="srv-tabla">
        <thead>
          <tr>
            <th>Servicio</th>
            <th style="width:110px">Clave</th>
            <th class="ta-r" style="width:110px">Precio</th>
            <th class="ta-c" style="width:96px">Dura</th>
            <th class="ta-c" style="width:110px">Comisión</th>
            <th style="width:150px">Quién lo hace</th>
            <th class="ta-c" style="width:100px">Agenda</th>
            <th style="width:190px"></th>
          </tr>
        </thead>
        <tbody>
          <tr *ngFor="let s of servicios(); trackBy: porId" [style.opacity]="s.active ? 1 : .55">
            <td>
              {{ s.nombre }}
              <div class="srv-alerta" *ngIf="!s.active">Retirado</div>
            </td>
            <td class="mono srv-dim">{{ s.part_number }}</td>
            <td class="ta-r mono">{{ s.price | currency:'MXN':'symbol-narrow' }}</td>
            <td class="ta-c srv-dim">{{ s.duration_minutes }} min</td>
            <td class="ta-c mono">
              {{ s.default_commission_pct === null ? '—' : s.default_commission_pct + '%' }}
            </td>
            <td class="srv-dim">
              {{ s.professionals_count === 0 ? 'Cualquiera' : s.professionals_count + ' personas' }}
            </td>
            <td class="ta-c">
              <span class="srv-badge" [class.srv-badge--ok]="s.schedulable" [class.srv-badge--mute]="!s.schedulable">
                {{ s.schedulable ? 'Sí' : 'No' }}
              </span>
            </td>
            <td style="text-align:right" *ngIf="puedeAdministrar">
              <button class="btn srv-sm" (click)="editar(s)">Editar</button>
              <button class="btn srv-sm" (click)="quienLoHace(s)">Quién</button>
              <button class="btn srv-sm srv-ghost" (click)="alternar(s)">
                {{ s.active ? 'Retirar' : 'Reactivar' }}
              </button>
            </td>
            <td *ngIf="!puedeAdministrar"></td>
          </tr>
        </tbody>
      </table>

      <div class="srv-vacio" *ngIf="!cargando() && servicios().length === 0">
        <p *ngIf="busqueda()">Nada coincide con «{{ busqueda() }}».</p>
        <ng-container *ngIf="!busqueda()">
          <p><b>Todavía no hay servicios.</b></p>
          <p class="srv-sub">Da de alta lo que cobras por trabajo: una afinación, un corte,
             una consulta. Si ya lo cobrabas como producto, enlázalo y conserva su historial.</p>
          <div style="display:flex;gap:8px" *ngIf="puedeAdministrar">
            <button class="btn" (click)="enlazar()">Enlazar un producto</button>
            <button class="btn btn-primary" (click)="editar(null)">Crear el primero</button>
          </div>
        </ng-container>
      </div>
    </div>
  </div>
  `,
})
export class ServiciosCatalogo {
  private readonly srv = inject(ServiciosService);
  private readonly auth = inject(AuthService);

  readonly servicios = signal<Servicio[]>([]);
  readonly cargando = signal(false);
  readonly busqueda = signal('');
  readonly verRetirados = signal(false);

  get puedeAdministrar(): boolean { return this.auth.puede(PAQUETES.SERVICIOS_ADMINISTRAR); }
  porId = (_: number, s: Servicio) => s.product_id;

  constructor() { void this.cargar(); }

  private temporizador: any = null;
  buscar(v: string) {
    this.busqueda.set(v);
    clearTimeout(this.temporizador);
    this.temporizador = setTimeout(() => void this.cargar(), 250);
  }

  async cargar() {
    this.cargando.set(true);
    const r = await this.srv.catalogo({
      soloActivos: !this.verRetirados(),
      busqueda: this.busqueda() || undefined,
    });
    this.cargando.set(false);
    if (!r.ok) { await Swal.fire({ icon: 'error', title: 'No se pudo cargar', text: r.error }); return; }
    this.servicios.set(r.datos);
  }

  async editar(s: Servicio | null) {
    const { value } = await Swal.fire({
      title: s ? 'Editar servicio' : 'Nuevo servicio',
      html: `
        <input id="sv-nombre" class="swal2-input" placeholder="Nombre" value="${s?.nombre ?? ''}">
        <input id="sv-precio" class="swal2-input" type="number" step="0.01" min="0"
               placeholder="Precio" value="${s?.price ?? ''}">
        <input id="sv-dura" class="swal2-input" type="number" min="1" max="1440"
               placeholder="Duración en minutos" value="${s?.duration_minutes ?? 30}">
        <input id="sv-com" class="swal2-input" type="number" min="0" max="100" step="0.01"
               placeholder="Comisión % (vacío: la de la persona)"
               value="${s?.default_commission_pct ?? ''}">
        <label style="display:flex;gap:8px;align-items:center;justify-content:center;font-size:14px;margin-top:8px">
          <input id="sv-agenda" type="checkbox" ${s?.schedulable ?? true ? 'checked' : ''}> Se puede agendar
        </label>`,
      focusConfirm: false, showCancelButton: true, confirmButtonText: 'Guardar',
      preConfirm: () => {
        const nombre = (document.getElementById('sv-nombre') as HTMLInputElement)?.value.trim();
        const precio = Number((document.getElementById('sv-precio') as HTMLInputElement)?.value);
        if (!nombre) { Swal.showValidationMessage('Ponle un nombre'); return false; }
        if (!Number.isFinite(precio) || precio < 0) { Swal.showValidationMessage('El precio no puede ser negativo'); return false; }
        const com = (document.getElementById('sv-com') as HTMLInputElement)?.value;
        return {
          productId: s?.product_id ?? null,
          nombre, precio,
          duracionMinutos: Number((document.getElementById('sv-dura') as HTMLInputElement)?.value) || 30,
          /* Vacío no es cero: vacío significa «usa la comisión de la persona»
             y cero significa «este servicio no comisiona». */
          comisionPct: com === '' ? null : Number(com),
          agendable: (document.getElementById('sv-agenda') as HTMLInputElement)?.checked,
        };
      },
    });
    if (!value) return;
    const r = await this.srv.guardarServicio(value);
    if (!r.ok) { await Swal.fire({ icon: 'error', title: 'No se pudo guardar', text: r.error }); return; }
    await this.cargar();
  }

  /** El producto que ya se vendía pasa a ser servicio sin perder su historial. */
  async enlazar() {
    const p = await (window as any).electronAPI?.getActiveProducts?.();
    const prods: any[] = (p?.data ?? p ?? []).filter((x: any) =>
      !this.servicios().some(s => s.product_id === x.id));
    if (!prods.length) {
      await Swal.fire({ icon: 'info', title: 'Nada que enlazar', text: 'No hay productos sin enlazar.' });
      return;
    }
    const opciones = Object.fromEntries(prods.map(x => [String(x.id), `${x.nombre} · $${x.price}`]));
    const { value: productId } = await Swal.fire({
      title: 'Enlazar un producto',
      text: 'Pasará a ser un servicio y conservará su historial de ventas. Dejará de descontar inventario.',
      input: 'select', inputOptions: opciones, inputPlaceholder: 'Elige el producto',
      showCancelButton: true, confirmButtonText: 'Enlazar',
    });
    if (!productId) return;
    const elegido = prods.find(x => String(x.id) === String(productId));
    const r = await this.srv.guardarServicio({
      productId: Number(productId), nombre: elegido.nombre, precio: elegido.price,
      duracionMinutos: 30, agendable: true,
    });
    if (!r.ok) { await Swal.fire({ icon: 'error', title: 'No se pudo enlazar', text: r.error }); return; }
    await this.cargar();
  }

  async quienLoHace(s: Servicio) {
    const pr = await this.srv.profesionales({ soloActivos: true });
    if (!pr.datos.length) {
      await Swal.fire({
        icon: 'info', title: 'Todavía no hay profesionales',
        text: 'Da de alta a quien hace el trabajo en Servicios › Profesionales.',
      });
      return;
    }
    const actuales = await this.srv.profesionales({ soloActivos: true, servicioId: s.product_id });
    const asignados = new Set(
      s.professionals_count === 0 ? [] : actuales.datos.map(p => p.id));

    const filas = pr.datos.map(p => `
      <label style="display:flex;gap:8px;align-items:center;padding:4px 0;font-size:14px">
        <input type="checkbox" class="sv-p" value="${p.id}" ${asignados.has(p.id) ? 'checked' : ''}>
        ${p.full_name}${p.title ? ' · ' + p.title : ''}
      </label>`).join('');

    const { value } = await Swal.fire({
      title: 'Quién hace «' + s.nombre + '»',
      html: `<p style="font-size:13px;color:#617284;margin:0 0 8px">
               Sin marcar a nadie, lo hace cualquiera.
             </p><div style="text-align:left">${filas}</div>`,
      focusConfirm: false, showCancelButton: true, confirmButtonText: 'Guardar',
      preConfirm: () => Array.from(document.querySelectorAll('.sv-p'))
        .filter((el: any) => el.checked)
        .map((el: any) => ({ professionalId: Number(el.value) })),
    });
    if (!value) return;
    const r = await this.srv.asignarProfesionales(s.product_id, value as any);
    if (!r.ok) { await Swal.fire({ icon: 'error', title: 'No se pudo guardar', text: r.error }); return; }
    await this.cargar();
  }

  async alternar(s: Servicio) {
    const r = await this.srv.activarServicio(s.product_id, !s.active);
    if (!r.ok) { await Swal.fire({ icon: 'error', title: 'No se pudo', text: r.error }); return; }
    await this.cargar();
  }
}
