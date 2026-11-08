import { ChangeDetectionStrategy, Component, Input, OnInit, inject, signal } from '@angular/core';
import { NgFor, NgIf, NgTemplateOutlet } from '@angular/common';
import { Router } from '@angular/router';
import { EmpresaLocal, EmpresaRemota, EmpresasService } from '../../core';
import { AuthService, PAQUETES } from '../../services/auth.service';

/**
 * WX-EMPRESA — de qué empresa es lo que se ve, y el paso a otra.
 *
 * Es la pastilla del negocio de la barra superior. Saber en qué base se está
 * trabajando —y si es una demo— es lo que evita el error caro; con
 * MultiEmpresa, además, es desde donde se cambia (docs/multiempresa.md).
 *
 *   Sin EMPRESAS_CAMBIAR, o sin otras empresas: la pastilla de siempre, quieta.
 *   Con otras empresas: la pastilla abre un panel (`.wx-pop`, popover nativo)
 *     con las de esta computadora (se entra) y las de otra (se consultan).
 *
 * Al entrar a otra empresa el proceso principal recarga la ventana: la
 * pantalla vuelve a nacer con la sesión y los datos de la nueva. Aquí solo se
 * muestra que está cambiando y, si falla, por qué.
 */
@Component({
  selector: 'wx-empresa',
  standalone: true,
  imports: [NgIf, NgFor, NgTemplateOutlet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './wx-empresa.component.html',
  styleUrls: ['./wx-empresa.component.css'],
})
export class WxEmpresaComponent implements OnInit {
  /** El nombre del negocio activo (lo sabe el panel antes que nadie). */
  @Input() nombre = 'Wybix POS';
  @Input() esDemo = false;

  readonly svc = inject(EmpresasService);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  readonly error = signal('');
  /** Un solo panel en la barra: id fijo, sin azar. */
  readonly idPanel = 'wx-empresa-panel';
  readonly ancla = '--ancla-wx-empresa';

  get puede(): boolean { return this.auth.puede(PAQUETES.EMPRESAS_CAMBIAR); }

  ngOnInit(): void {
    if (this.puede) void this.svc.cargar();
  }

  icono(giro: string | null | undefined): string {
    return giro === 'HOSPITALITY' ? 'ph-fill ph-fork-knife' : 'ph-fill ph-storefront';
  }

  /** «Datos de las 14:32»: la consulta remota es de la última sincronización. */
  hora(iso: string | null): string {
    if (!iso) return 'sin datos todavía';
    const d = new Date(iso);
    const hoy = new Date();
    const mismaFecha = d.toDateString() === hoy.toDateString();
    const h = d.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });
    return mismaFecha ? `datos de las ${h}` : `datos del ${d.toLocaleDateString('es-MX', { day: 'numeric', month: 'short' })}, ${h}`;
  }

  async entrar(e: EmpresaLocal): Promise<void> {
    if (this.svc.cambiando()) return;
    this.error.set('');
    const r = await this.svc.cambiar(e.base);
    if (!r.ok) this.error.set(r.error);
    // Si salió bien, la ventana se recarga sola con la otra empresa.
  }

  ver(r: EmpresaRemota): void {
    this.cerrar();
    void this.router.navigate(['/dashboard/empresas/remota', r.companyId]);
  }

  ir(ruta: string, query: Record<string, string> = {}): void {
    this.cerrar();
    void this.router.navigate([ruta], { queryParams: query });
  }

  private cerrar(): void {
    const el = document.getElementById(this.idPanel) as any;
    if (el?.hidePopover && el.matches(':popover-open')) el.hidePopover();
  }

  trackLocal(_i: number, e: EmpresaLocal) { return e.base; }
  trackRemota(_i: number, e: EmpresaRemota) { return e.companyId; }
}
