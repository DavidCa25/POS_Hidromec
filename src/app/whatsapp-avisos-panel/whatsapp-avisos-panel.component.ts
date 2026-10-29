import { Component, OnInit, signal } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import Swal from 'sweetalert2';
import { WxSelectComponent, WxOpcion } from '../wx-select/wx-select.component';
import { WxCargandoComponent } from '../wx-cargando/wx-cargando.component';

/** La cuenta de WhatsApp DEL NEGOCIO (wa_cuentas), sin token: eso nunca sale de la nube. */
interface CuentaWa {
  status: 'ACTIVA' | 'ERROR'; telefono: string | null; nombre: string | null;
  plantillas: Record<string, string>; error: string | null; conectada: string;
}
/** Los ajustes que guarda la nube (wa_settings). */
interface ConfigWa {
  nube: boolean; pedido_listo?: boolean; membresia?: boolean; dias_antes?: number; como_renovar?: string;
  principal?: boolean; proveedor?: 'meta' | 'simulado' | null; cuenta?: CuentaWa | null; conectable?: boolean;
}
/** Un renglón del registro (wa_messages), con el teléfono ya enmascarado por la nube. */
interface AvisoWa {
  id: number; kind: 'PEDIDO_LISTO' | 'MEMBRESIA_POR_VENCER' | 'MEMBRESIA_VENCE_HOY';
  status: 'PENDING' | 'SENDING' | 'SENT' | 'DELIVERED' | 'READ' | 'FAILED' | 'SKIPPED';
  last_error: string | null; provider: string | null; telefono: string; created_at: string;
}

const TIPOS: Record<AvisoWa['kind'], string> = {
  PEDIDO_LISTO: 'Pedido listo', MEMBRESIA_POR_VENCER: 'Membresía por vencer', MEMBRESIA_VENCE_HOY: 'Membresía vence hoy',
};
const ESTADOS: Record<AvisoWa['status'], string> = {
  PENDING: 'En cola', SENDING: 'Enviando…', SENT: 'Enviado', DELIVERED: 'Entregado', READ: 'Leído', FAILED: 'No salió', SKIPPED: 'Omitido',
};
const MOTIVOS: Record<string, string> = {
  OPT_OUT: 'el cliente se dio de baja', VENCIDA: 'ya no tenía caso mandarlo', DESACTIVADO: 'el aviso estaba apagado',
  SIN_NUMERO: 'el WhatsApp del negocio no estaba conectado',
};
/* Las cuatro plantillas que Wybix da de alta en la cuenta del negocio. */
const PLANTILLAS: Array<{ nombre: string; etiqueta: string }> = [
  { nombre: 'wybix_pedido_listo', etiqueta: 'Pedido listo' },
  { nombre: 'wybix_pedido_listo_seguimiento', etiqueta: 'Pedido listo con enlace' },
  { nombre: 'wybix_membresia_por_vencer', etiqueta: 'Membresía por vencer' },
  { nombre: 'wybix_membresia_vence_hoy', etiqueta: 'Membresía vence hoy' },
];
const ESTADO_PLANTILLA: Record<string, string> = {
  APPROVED: 'Aprobada', PENDING: 'En revisión de Meta', REJECTED: 'Rechazada', PAUSED: 'Pausada por Meta',
  DISABLED: 'Desactivada por Meta', NO_CREADA: 'Sin dar de alta', MARKETING: 'Meta la pasó a Marketing',
};

/*
 * AVISOS POR WHATSAPP AL CLIENTE (0068).
 *
 * Conectar el WhatsApp DEL NEGOCIO (los avisos salen con su nombre y su
 * número; Meta le cobra al negocio), encender o apagar cada aviso, cuántos
 * días antes se recuerda la membresía, dar de baja o reactivar un teléfono a
 * petición del cliente, y lo que salió.
 * Todo vive en la nube: esta pantalla solo lo lee y lo cambia. Cambiar los
 * ajustes es de la caja principal (la nube lo vuelve a exigir).
 */
@Component({
  selector: 'app-whatsapp-avisos-panel',
  standalone: true,
  imports: [CommonModule, FormsModule, DatePipe, WxSelectComponent, WxCargandoComponent],
  styleUrls: ['../panel-controls.css'],
  template: `
  <div class="panel-content wa">
    <div class="section-title"><i class="ph ph-whatsapp-logo"></i> Avisos por WhatsApp</div>
    <p class="hint">Wybix le escribe a tu cliente cuando su pedido está listo y antes de que venza su membresía del Club. Solo a quien dejó su teléfono, y nunca a quien pidió no recibirlos.</p>

    <div *ngIf="cargando()" class="wa-vacio"><wx-cargando [size]="22" alt="Cargando avisos"></wx-cargando></div>

    <p *ngIf="!cargando() && !cfg().nube" class="wa-aviso" role="status"><i class="ph ph-cloud-slash"></i>Esta caja no está vinculada con Wybix en la nube. Vincúlala en Sincronización en la nube para usar los avisos.</p>
    <p *ngIf="error()" class="wa-error" role="alert">{{ error() }}</p>
    <p *ngIf="ok()" class="wa-ok" role="status">{{ ok() }}</p>

    <ng-container *ngIf="!cargando() && cfg().nube">
      <p *ngIf="cfg().proveedor === 'simulado'" class="wa-aviso" role="status"><i class="ph ph-flask"></i>Modo de prueba: los avisos se registran pero no le llegan a nadie.</p>
      <p *ngIf="!cfg().principal" class="wa-aviso" role="status"><i class="ph ph-lock-key"></i>Los ajustes se cambian desde la caja principal.</p>

      <div class="wa-cuenta" data-guide="wa-cuenta" [attr.data-guide-estado]="cuenta()?.status ?? 'SIN_CONECTAR'">
        <div class="section-title"><i class="ph ph-phone"></i> El WhatsApp de tu negocio</div>

        <ng-container *ngIf="!cuenta()">
          <p class="hint">Los avisos salen desde el número de WhatsApp de tu negocio, con su nombre. Meta te cobra cada aviso directamente (alrededor de 16 centavos).</p>
          <p class="hint">Necesitas una cuenta de Facebook que administre tu negocio y un número que puedas recibir por SMS o llamada. Ese número no puede estar en la app de WhatsApp: si lo usas ahí, conecta otro.</p>
          <p *ngIf="!cfg().conectable" class="wa-aviso" role="status"><i class="ph ph-plug"></i>WhatsApp todavía no está habilitado en Wybix. Puedes dejar los avisos listos; se conecta en cuanto esté disponible.</p>
          <div class="btn-row">
            <button type="button" class="btn-primary" (click)="conectar()" [disabled]="!cfg().principal || !cfg().conectable || conectando()" data-guide="wa-conectar">
              <i class="ph ph-whatsapp-logo"></i> {{ conectando() ? 'Abriendo…' : 'Conectar WhatsApp' }}
            </button>
            <button *ngIf="esperandoMeta()" type="button" class="btn-outline" (click)="revisarConexion()" [disabled]="conectando()" data-guide="wa-revisar">Ya terminé, revisar</button>
          </div>
          <p *ngIf="esperandoMeta()" class="hint" role="status">Se abrió tu navegador. Sigue los pasos de Meta y vuelve aquí. El enlace sirve 30 minutos.</p>
        </ng-container>

        <ng-container *ngIf="cuenta() as c">
          <div class="wa-numero">
            <i class="ph ph-check-circle" *ngIf="c.status === 'ACTIVA'"></i>
            <i class="ph ph-warning" *ngIf="c.status !== 'ACTIVA'"></i>
            <div><b>{{ c.nombre || 'Tu negocio' }}</b><small>{{ c.telefono || 'número conectado' }}</small></div>
          </div>
          <p *ngIf="c.status !== 'ACTIVA'" class="wa-error" role="alert">{{ c.error || 'Meta dejó de aceptar la conexión.' }} Vuelve a conectar WhatsApp.</p>
          <ul class="wa-plantillas">
            <li *ngFor="let p of plantillas" [attr.data-guide-clave]="p.nombre" [attr.data-guide-estado]="c.plantillas[p.nombre] || 'NO_CREADA'">
              <span>{{ p.etiqueta }}</span>
              <span class="wa-chip" [attr.data-estado]="c.plantillas[p.nombre] || 'NO_CREADA'">{{ estadoPlantilla(c.plantillas[p.nombre]) }}</span>
            </li>
          </ul>
          <p class="hint" *ngIf="hayEnRevision()">Meta revisa cada plantilla en minutos u horas. Mientras tanto ese aviso no sale.</p>
          <div class="btn-row">
            <button type="button" class="btn-outline" (click)="revisarConexion()" [disabled]="conectando()" data-guide="wa-revisar">Revisar</button>
            <button *ngIf="c.status !== 'ACTIVA'" type="button" class="btn-primary" (click)="conectar()" [disabled]="!cfg().principal || !cfg().conectable || conectando()">Volver a conectar</button>
            <button type="button" class="btn-outline" (click)="desconectar()" [disabled]="!cfg().principal || conectando()" data-guide="wa-desconectar">Desconectar</button>
          </div>
        </ng-container>
      </div>

      <div class="section-title wa-sec"><i class="ph ph-bell-ringing"></i> Qué avisar</div>

      <div class="wa-fila" data-guide="wa-pedido-listo">
        <div class="info">Tu pedido está listo
          <small>Cuando la cocina marca listo un pedido de mostrador, con su número del día.</small>
        </div>
        <label class="sw"><input type="checkbox" [(ngModel)]="pedidoListo" [disabled]="!cfg().principal || guardando()" aria-label="Aviso de pedido listo"><span class="sl"></span></label>
      </div>

      <div class="wa-fila" data-guide="wa-membresia">
        <div class="info">Membresía del Club por vencer
          <small>Unos días antes y el día que vence, con el nombre del plan y cómo renovar. Entre 9:00 y 21:00.</small>
        </div>
        <label class="sw"><input type="checkbox" [(ngModel)]="membresia" [disabled]="!cfg().principal || guardando()" aria-label="Aviso de membresía"><span class="sl"></span></label>
      </div>

      <div class="wa-grid" *ngIf="membresia">
        <label><span>Avisar antes</span>
          <wx-select [opciones]="opcionesDias" [(ngModel)]="diasAntes" [disabled]="!cfg().principal || guardando()" data-guide="wa-dias"></wx-select>
        </label>
        <label><span>Cómo renovar</span>
          <input class="ctl" type="text" maxlength="120" [(ngModel)]="comoRenovar" [disabled]="!cfg().principal || guardando()" placeholder="paga tu mensualidad en caja">
        </label>
      </div>
      <p class="hint" *ngIf="membresia">El cliente leerá: «Para renovarla: {{ comoRenovar || '…' }}.»</p>

      <div class="btn-row">
        <button type="button" class="btn-primary" (click)="guardar()" [disabled]="!cfg().principal || guardando() || !cambiado()" data-guide="wa-guardar">
          {{ guardando() ? 'Guardando…' : 'Guardar' }}
        </button>
      </div>

      <div class="section-title wa-sec"><i class="ph ph-user-minus"></i> Un cliente ya no quiere avisos</div>
      <p class="hint">El cliente también puede tocar «Ya no recibir avisos» en el mensaje o responder BAJA.</p>
      <div class="wa-tel">
        <input class="ctl" type="tel" inputmode="tel" maxlength="20" [(ngModel)]="telefono" placeholder="Teléfono a 10 dígitos" aria-label="Teléfono del cliente">
        <button type="button" class="btn-outline" (click)="telefonoAccion('estado_tel')" [disabled]="!telValido() || ocupadoTel()">Consultar</button>
        <button type="button" class="btn-outline" (click)="telefonoAccion('baja')" [disabled]="!telValido() || ocupadoTel()">Dar de baja</button>
        <button type="button" class="btn-outline" (click)="telefonoAccion('alta')" [disabled]="!telValido() || ocupadoTel()">Reactivar</button>
      </div>
      <p *ngIf="estadoTel()" class="hint" role="status">{{ estadoTel() }}</p>

      <div class="section-title wa-sec"><i class="ph ph-list-checks"></i> Últimos avisos</div>
      <div class="wa-resumen" *ngIf="resumen() as r" aria-live="polite">
        <span><b>{{ r.enviados }}</b> enviados</span><span><b>{{ r.leidos }}</b> leídos</span>
        <span [class.wa-hay]="r.fallidos"><b>{{ r.fallidos }}</b> no salieron</span>
        <span><b>{{ r.omitidos }}</b> omitidos</span><span><b>{{ bajas() }}</b> bajas</span>
        <small>últimos 30 días</small>
      </div>
      <div *ngIf="!avisos().length" class="wa-vacio">Todavía no hay avisos.</div>
      <table *ngIf="avisos().length">
        <thead><tr><th>Aviso</th><th>Cliente</th><th>Cuándo</th><th>Estado</th></tr></thead>
        <tbody>
          <tr *ngFor="let a of avisos()" [attr.data-guide-clave]="a.id" [attr.data-guide-estado]="a.status">
            <td>{{ tipo(a.kind) }}</td>
            <td class="wa-tenue">{{ a.telefono }}</td>
            <td>{{ a.created_at | date:'dd/MM HH:mm' }}</td>
            <td>
              <span class="wa-chip" [attr.data-estado]="a.status">{{ estado(a.status) }}</span>
              <div class="wa-tenue" *ngIf="motivo(a)" [title]="a.last_error || ''">{{ motivo(a) }}</div>
            </td>
          </tr>
        </tbody>
      </table>
    </ng-container>
  </div>
  `,
  styles: [`
    .wa-cuenta { padding: 4px 0 8px; border-bottom: 1px solid var(--wx-border); }
    .wa-numero { display: flex; gap: 10px; align-items: center; margin: 8px 0; }
    .wa-numero i { font-size: 1.5rem; color: var(--wx-success, #067647); }
    .wa-numero i.ph-warning { color: var(--wx-danger, #b42318); }
    .wa-numero div { display: flex; flex-direction: column; }
    .wa-numero small { color: var(--wx-text-muted); font-size: var(--wx-text-xs); }
    .wa-plantillas { list-style: none; padding: 0; margin: 8px 0; display: grid; gap: 6px; }
    .wa-plantillas li { display: flex; justify-content: space-between; gap: 12px; font-size: var(--wx-text-sm); }
    .wa-chip[data-estado="APPROVED"] { background: var(--wx-success-soft, #e7f6ec); color: var(--wx-success, #067647); }
    .wa-chip[data-estado="REJECTED"], .wa-chip[data-estado="PAUSED"], .wa-chip[data-estado="DISABLED"], .wa-chip[data-estado="MARKETING"] { background: var(--wx-danger-soft, #fde8e8); color: var(--wx-danger, #b42318); }
    .wa-fila { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 12px 0; border-bottom: 1px solid var(--wx-border); }
    .wa-fila .info { display: flex; flex-direction: column; gap: 2px; font-weight: 600; }
    .wa-fila small { color: var(--wx-text-muted); font-weight: 400; font-size: var(--wx-text-xs); }
    .wa-grid { display: grid; grid-template-columns: 180px 1fr; gap: 12px; margin-top: 12px; }
    .wa-grid label { display: flex; flex-direction: column; gap: 4px; }
    .wa-grid span { color: var(--wx-text-muted); font-size: var(--wx-text-xs); font-weight: 600; }
    .wa-sec { margin-top: 1.6rem; }
    .wa-tel { display: flex; gap: 8px; flex-wrap: wrap; }
    .wa-tel .ctl { flex: 1 1 180px; }
    .wa-aviso, .wa-error, .wa-ok { display: flex; gap: 8px; align-items: center; padding: 10px 12px; border-radius: var(--wx-radius-md, 10px); font-size: var(--wx-text-sm); margin: 10px 0; }
    .wa-aviso { background: var(--wx-raised); color: var(--wx-text-muted); }
    .wa-error { background: var(--wx-danger-soft, #fde8e8); color: var(--wx-danger, #b42318); }
    .wa-ok { background: var(--wx-success-soft, #e7f6ec); color: var(--wx-success, #067647); }
    .wa-vacio { padding: 18px; text-align: center; color: var(--wx-text-muted); }
    .wa-resumen { display: flex; gap: 14px; flex-wrap: wrap; align-items: baseline; margin-bottom: 8px; font-size: var(--wx-text-sm); }
    .wa-resumen small { color: var(--wx-text-dim); }
    .wa-hay b { color: var(--wx-danger, #b42318); }
    table { width: 100%; border-collapse: collapse; font-size: var(--wx-text-sm); }
    th { text-align: left; color: var(--wx-text-muted); font-size: var(--wx-text-xs); font-weight: 600; padding: 6px 8px; border-bottom: 1px solid var(--wx-border); }
    td { padding: 8px; border-bottom: 1px solid var(--wx-border); vertical-align: top; }
    .wa-tenue { color: var(--wx-text-muted); font-size: var(--wx-text-xs); }
    .wa-chip { display: inline-block; padding: 2px 8px; border-radius: 999px; font-size: var(--wx-text-xs); font-weight: 600; background: var(--wx-raised); }
    .wa-chip[data-estado="SENT"], .wa-chip[data-estado="DELIVERED"] { background: var(--wx-accent-soft); color: var(--wx-accent); }
    .wa-chip[data-estado="READ"] { background: var(--wx-success-soft, #e7f6ec); color: var(--wx-success, #067647); }
    .wa-chip[data-estado="FAILED"] { background: var(--wx-danger-soft, #fde8e8); color: var(--wx-danger, #b42318); }
    @media (max-width: 720px) { .wa-grid { grid-template-columns: 1fr; } }
  `],
})
export class WhatsappAvisosPanelComponent implements OnInit {
  readonly cargando = signal(true);
  readonly guardando = signal(false);
  readonly ocupadoTel = signal(false);
  readonly error = signal('');
  readonly ok = signal('');
  readonly estadoTel = signal('');
  readonly cfg = signal<ConfigWa>({ nube: false });
  readonly avisos = signal<AvisoWa[]>([]);
  readonly resumen = signal<{ enviados: number; leidos: number; fallidos: number; omitidos: number } | null>(null);
  readonly bajas = signal(0);
  readonly conectando = signal(false);
  readonly esperandoMeta = signal(false);
  readonly plantillas = PLANTILLAS;
  readonly cuenta = () => this.cfg().cuenta ?? null;
  readonly hayEnRevision = () => Object.values(this.cuenta()?.plantillas ?? {}).some(s => s === 'PENDING');

  pedidoListo = false;
  membresia = false;
  diasAntes = 3;
  comoRenovar = 'paga tu mensualidad en caja';
  telefono = '';

  readonly opcionesDias: WxOpcion[] = [1, 2, 3, 5, 7, 10, 15].map(d => ({ valor: d, etiqueta: d === 1 ? '1 día' : `${d} días` }));
  readonly telValido = () => this.telefono.replace(/\D/g, '').length >= 10;
  readonly cambiado = () => {
    const c = this.cfg();
    return this.pedidoListo !== !!c.pedido_listo || this.membresia !== !!c.membresia
      || this.diasAntes !== (c.dias_antes ?? 3) || this.comoRenovar.trim() !== (c.como_renovar ?? '');
  };

  private get api() { return (window as any).electronAPI; }

  async ngOnInit() {
    await this.cargar();
  }

  tipo(k: AvisoWa['kind']) { return TIPOS[k] ?? k; }
  estado(s: AvisoWa['status']) { return ESTADOS[s] ?? s; }
  estadoPlantilla(s: string | undefined) { return ESTADO_PLANTILLA[s ?? 'NO_CREADA'] ?? s; }
  motivo(a: AvisoWa) {
    if (a.status === 'SKIPPED') return MOTIVOS[a.last_error ?? ''] ?? '';
    if (a.status === 'FAILED') return a.last_error === 'SIN_NUMERO' ? MOTIVOS['SIN_NUMERO'] : 'WhatsApp no lo pudo entregar';
    return a.provider === 'simulado' ? 'modo de prueba' : '';
  }

  private aplicar(c: ConfigWa) {
    this.cfg.set(c);
    this.pedidoListo = !!c.pedido_listo;
    this.membresia = !!c.membresia;
    this.diasAntes = c.dias_antes ?? 3;
    this.comoRenovar = c.como_renovar ?? 'paga tu mensualidad en caja';
  }

  async cargar() {
    this.cargando.set(true); this.error.set('');
    try {
      const r = await this.api.whatsappConfig();
      if (!r?.success) throw new Error(r?.error || 'No se pudieron leer los avisos.');
      this.aplicar(r.data);
      if (r.data.nube) await this.cargarRegistro();
    } catch (e: any) {
      this.error.set(e?.message || String(e));
    } finally {
      this.cargando.set(false);
    }
  }

  async cargarRegistro() {
    const r = await this.api.whatsappRegistro({ limite: 50 });
    if (!r?.success) { this.error.set(r?.error || 'No se pudo leer el registro.'); return; }
    this.avisos.set(r.data.avisos ?? []);
    this.resumen.set(r.data.resumen ?? null);
    this.bajas.set(Number(r.data.bajas) || 0);
  }

  async guardar() {
    this.guardando.set(true); this.error.set(''); this.ok.set('');
    try {
      const r = await this.api.whatsappConfigGuardar({
        pedidoListo: this.pedidoListo, membresia: this.membresia, diasAntes: this.diasAntes, comoRenovar: this.comoRenovar,
      });
      if (!r?.success) throw new Error(r?.error || 'No se pudo guardar.');
      this.aplicar(r.data);
      this.ok.set('Listo. Los avisos quedaron guardados.');
    } catch (e: any) {
      this.error.set(e?.message || String(e));
    } finally {
      this.guardando.set(false);
    }
  }

  /** Abre en el navegador la página de Meta (enlace de un solo uso). */
  async conectar() {
    this.conectando.set(true); this.error.set(''); this.ok.set('');
    try {
      const r = await this.api.whatsappConexion({ accion: 'iniciar' });
      if (!r?.success) throw new Error(r?.error || 'No se pudo abrir la conexión.');
      this.esperandoMeta.set(true);
    } catch (e: any) {
      this.error.set(e?.message || String(e));
    } finally {
      this.conectando.set(false);
    }
  }

  /** Pregunta a la nube por la cuenta y, si hay plantillas en revisión, a Meta. */
  async revisarConexion() {
    this.conectando.set(true); this.error.set(''); this.ok.set('');
    try {
      const r = await this.api.whatsappConexion({ accion: 'estado' });
      if (!r?.success) throw new Error(r?.error || 'No se pudo revisar.');
      this.cfg.set({ ...this.cfg(), cuenta: r.data.cuenta, conectable: r.data.conectable });
      if (r.data.cuenta) { this.esperandoMeta.set(false); this.ok.set('Tu WhatsApp está conectado.'); }
      else if (this.esperandoMeta()) this.ok.set('Todavía no se completa la conexión en Meta.');
    } catch (e: any) {
      this.error.set(e?.message || String(e));
    } finally {
      this.conectando.set(false);
    }
  }

  async desconectar() {
    const c = await Swal.fire({
      icon: 'question', title: 'Desconectar WhatsApp',
      text: 'Los avisos dejan de salir al momento. Tu número y tu cuenta de WhatsApp siguen siendo tuyos; para volver a usarlos aquí, conecta de nuevo.',
      showCancelButton: true, confirmButtonText: 'Desconectar', cancelButtonText: 'Cancelar',
    });
    if (!c.isConfirmed) return;
    this.conectando.set(true); this.error.set(''); this.ok.set('');
    try {
      const r = await this.api.whatsappConexion({ accion: 'desconectar' });
      if (!r?.success) throw new Error(r?.error || 'No se pudo desconectar.');
      this.cfg.set({ ...this.cfg(), cuenta: null });
      this.ok.set('WhatsApp desconectado. Los avisos ya no salen.');
    } catch (e: any) {
      this.error.set(e?.message || String(e));
    } finally {
      this.conectando.set(false);
    }
  }

  async telefonoAccion(accion: 'baja' | 'alta' | 'estado_tel') {
    this.ocupadoTel.set(true); this.error.set(''); this.estadoTel.set('');
    try {
      const r = await this.api.whatsappTelefono({ accion, telefono: this.telefono });
      if (!r?.success) throw new Error(r?.error || 'No se pudo.');
      const baja = !!r.data?.baja;
      this.estadoTel.set(accion === 'baja' ? 'Hecho: este teléfono ya no recibirá avisos de tu negocio.'
        : accion === 'alta' ? 'Hecho: este teléfono vuelve a recibir avisos.'
        : baja ? 'Este teléfono pidió no recibir avisos.' : 'Este teléfono recibe avisos.');
      await this.cargarRegistro();
    } catch (e: any) {
      this.error.set(e?.message || String(e));
    } finally {
      this.ocupadoTel.set(false);
    }
  }
}
