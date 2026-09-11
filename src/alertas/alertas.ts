import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import Swal from 'sweetalert2';
import { ReportService, ReportConfig } from '../services/report.service';

interface Reorden {
  id: number; nombre: string; stock: number; vendido_ventana: number;
  prom_diario: number; dias_restantes: number; sugerido: number | null;
  /** DIRECT o RECIPE. Un NONE no llega nunca hasta aqui. */
  inventory_mode?: string;
  base_uom?: string;
  /** En una receta, el ingrediente que se acaba primero. */
  limita_nombre?: string | null;
  limita_stock?: number | null;
  limita_uom?: string | null;
  limita_necesita?: number | null;
}

@Component({
  selector: 'app-alertas',
  standalone: true,
  imports: [CommonModule, FormsModule],
  styles: [`
    /* ======================================================================
       ALERTAS — CENTRO DE ATENCION
       ----------------------------------------------------------------------
       Tres planos de lectura, de mas rapido a mas lento:

         1. la tira de resumen contesta "cuanto" de un vistazo
         2. cada fila contesta "que pasa, por que importa y que hago"
         3. el detalle, solo si se pide

       El peso visual sigue a la urgencia: lo critico abre con barra roja y su
       tabla desplegada; lo que esta en orden baja a una tira de una linea.
       ====================================================================== */
    :host{display:block;}
    .al-wrap{padding:1.75rem 1.75rem 3rem;max-width:1280px;margin:0 auto;}

    /* ------------------------------------------------------------ cabecera */
    .al-cabecera{display:flex;align-items:flex-start;justify-content:space-between;gap:2rem;flex-wrap:wrap;margin-bottom:1.35rem;}
    .al-title{font-size:2rem;font-weight:600;letter-spacing:-.025em;color:var(--wx-text);margin:0;}
    .al-sub{color:var(--wx-text-muted);margin:.3rem 0 0;font-size:.925rem;}

    /* Tira de resumen: tres celdas separadas por linea, no tres tarjetas. Que
       compartan caja es lo que las hace leerse como un solo dato. */
    .al-resumen{display:flex;align-items:stretch;background:var(--wx-surface);border:1px solid var(--wx-edge);border-radius:var(--wx-radius-lg);box-shadow:var(--wx-shadow-card);overflow:hidden;}
    .al-resumen__c{display:flex;align-items:center;gap:.7rem;padding:1rem 1.5rem;}
    .al-resumen__c + .al-resumen__c{border-left:1px solid var(--wx-edge);}
    .al-resumen__ico{display:inline-flex;align-items:center;justify-content:center;width:38px;height:38px;border-radius:50%;flex:0 0 auto;font-size:1.25rem;}
    .al-resumen__n{font-size:1.65rem;font-weight:600;line-height:1;color:var(--wx-text);font-variant-numeric:tabular-nums;}
    .al-resumen__et{font-size:.82rem;color:var(--wx-text-muted);max-width:7.5em;line-height:1.25;}
    .al-resumen__c.sev-critico .al-resumen__ico{background:var(--wx-danger-soft);color:var(--wx-danger);}
    .al-resumen__c.sev-atencion .al-resumen__ico{background:var(--wx-warning-soft);color:var(--wx-warning);}
    .al-resumen__c.sev-ok .al-resumen__ico{background:var(--wx-success-soft);color:var(--wx-success);}

    /* ------------------------------------------------------------- filtros */
    .al-filtros{display:flex;gap:.45rem;flex-wrap:wrap;margin-bottom:1.15rem;}
    .al-chip{display:inline-flex;align-items:center;gap:.4rem;padding:.42rem .85rem;border:1px solid var(--wx-edge);border-radius:999px;background:var(--wx-surface);color:var(--wx-text-muted);font:inherit;font-size:.85rem;font-weight:500;cursor:pointer;
      transition:background var(--wx-dur-press) ease,color var(--wx-dur-press) ease,border-color var(--wx-dur-press) ease;}
    @media (hover:hover) and (pointer:fine){.al-chip:hover:not(:disabled){background:var(--wx-hover);color:var(--wx-text);}}
    .al-chip.is-on{background:var(--wx-user-accent);border-color:var(--wx-user-accent);color:var(--wx-user-accent-fg);font-weight:600;}
    .al-chip:disabled{opacity:.4;cursor:default;}
    .al-chip:focus-visible{outline:2px solid var(--wx-accent);outline-offset:2px;}
    .al-chip__n{font-size:.75rem;font-variant-numeric:tabular-nums;opacity:.75;}

    /* -------------------------------------------------------------- bloque */
    .al-bloque{background:var(--wx-surface);border:1px solid var(--wx-edge);border-radius:var(--wx-radius-lg);box-shadow:var(--wx-shadow-card);padding:1.15rem 1.25rem 1.25rem;margin-bottom:1.1rem;}
    .al-bloque__cab{display:flex;align-items:center;gap:.6rem;flex-wrap:wrap;margin-bottom:.9rem;}
    .al-bloque__cab h3{margin:0;font-size:1.05rem;font-weight:600;color:var(--wx-text);letter-spacing:-.01em;}
    .al-bloque__cab p{margin:0;font-size:.85rem;color:var(--wx-text-muted);}
    .al-bloque__n{display:inline-flex;align-items:center;justify-content:center;min-width:22px;height:22px;padding:0 .4rem;border-radius:999px;background:var(--wx-danger-soft);color:var(--wx-danger-ink);font-size:.78rem;font-weight:600;font-variant-numeric:tabular-nums;}
    .al-bloque--ok .al-bloque__n{background:var(--wx-success-soft);color:var(--wx-success-ink);}
    .al-bloque__ok{color:var(--wx-success);font-size:1.15rem;}

    .al-bloque--limpio{display:flex;align-items:center;gap:1rem;padding:2.25rem 1.5rem;}
    .al-bloque--limpio > i{font-size:2rem;color:var(--wx-success);flex:0 0 auto;}
    .al-bloque--limpio h3{margin:0 0 .15rem;font-size:1.05rem;font-weight:600;color:var(--wx-text);}
    .al-bloque--limpio p{margin:0;font-size:.9rem;color:var(--wx-text-muted);}

    /* ---------------------------------------------------------------- fila */
    .al-filas{display:flex;flex-direction:column;gap:.6rem;}

    .al-fila{
      position:relative;
      border:1px solid var(--wx-edge);
      border-radius:var(--wx-radius-md);
      background:var(--wx-raised);
      overflow:hidden;
      /* La barra de severidad va como borde izquierdo grueso: no necesita un
         elemento propio y no se descoloca al envolverse el contenido. */
      border-left:3px solid var(--wx-edge-strong);
      transition:border-color var(--wx-dur-micro) ease,background var(--wx-dur-micro) ease;
    }
    .al-fila.sev-critico{border-left-color:var(--wx-danger);}
    .al-fila.sev-atencion{border-left-color:var(--wx-warning);}
    .al-fila.sev-informativo{border-left-color:var(--wx-accent);}

    .al-fila__cab{
      display:grid;
      /* icono | identidad | metricas | accion | cta | chevron */
      grid-template-columns:auto minmax(190px,1.15fr) minmax(0,1.35fr) minmax(0,.95fr) auto auto;
      align-items:center;
      gap:1.1rem;
      padding:.95rem 1rem;
      cursor:pointer;
    }
    @media (hover:hover) and (pointer:fine){.al-fila__cab:hover{background:var(--wx-hover);}}
    .al-fila__cab:focus-visible{outline:2px solid var(--wx-accent);outline-offset:-2px;}

    /* Baldosa del icono: cuadrado redondeado teñido con la severidad. Da el
       punto de entrada visual de la fila sin recurrir a un circulo de color
       saturado. */
    .al-tile{display:inline-flex;align-items:center;justify-content:center;width:44px;height:44px;flex:0 0 auto;border-radius:13px;font-size:1.4rem;background:var(--wx-sunken);color:var(--wx-text-muted);}
    .al-fila.sev-critico .al-tile{background:var(--wx-danger-soft);color:var(--wx-danger);}
    .al-fila.sev-atencion .al-tile{background:var(--wx-warning-soft);color:var(--wx-warning);}
    .al-fila.sev-informativo .al-tile{background:var(--wx-accent-soft);color:var(--wx-accent-text);}

    .al-ident{min-width:0;}
    .al-ident__l1{display:flex;align-items:center;gap:.5rem;flex-wrap:wrap;}
    .al-ident__l1 h3{margin:0;font-size:.98rem;font-weight:600;color:var(--wx-text);letter-spacing:-.01em;}
    .al-ident__l2{margin:.2rem 0 0;font-size:.82rem;line-height:1.4;color:var(--wx-text-muted);}

    .al-badge{padding:.1rem .5rem;border-radius:999px;font-size:.72rem;font-weight:600;letter-spacing:.01em;background:var(--wx-sunken);color:var(--wx-text-muted);white-space:nowrap;}
    .al-fila.sev-critico .al-badge{background:var(--wx-danger-soft);color:var(--wx-danger-ink);}
    .al-fila.sev-atencion .al-badge{background:var(--wx-warning-soft);color:var(--wx-warning-ink);}
    .al-fila.sev-informativo .al-badge{background:var(--wx-accent-soft);color:var(--wx-accent-text);}

    /* Metricas: etiqueta pequeña arriba, valor debajo. La cifra clave sube de
       tamaño para que se lea antes que el resto de la fila. */
    .al-metricas{display:flex;gap:1.5rem;min-width:0;flex-wrap:wrap;
      border-left:1px solid var(--wx-edge);padding-left:1.1rem;}
    .al-metrica{display:flex;flex-direction:column;gap:.15rem;min-width:0;}
    /* --wx-text-dim daba 4.05:1 sobre la fila en oscuro. A 11px eso no se lee. */
    .al-metrica__et{font-size:.68rem;font-weight:600;letter-spacing:.05em;text-transform:uppercase;color:var(--wx-text-muted);white-space:nowrap;}
    .al-metrica__v{font-size:.9rem;font-weight:500;color:var(--wx-text);font-variant-numeric:tabular-nums;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
    .al-metrica__v.es-fuerte{font-size:1.35rem;font-weight:600;line-height:1.15;letter-spacing:-.02em;}
    .al-metrica.tono-critico .al-metrica__v.es-fuerte{color:var(--wx-danger);}
    .al-metrica.tono-atencion .al-metrica__v.es-fuerte{color:var(--wx-warning);}

    .al-accion{display:flex;flex-direction:column;gap:.15rem;min-width:0;}
    .al-accion__et{font-size:.72rem;font-weight:600;color:var(--wx-text);}
    .al-accion__t{font-size:.82rem;line-height:1.4;color:var(--wx-text-muted);}

    .al-cta{display:flex;align-items:center;gap:.45rem;flex:0 0 auto;}
    .al-chev{display:inline-flex;flex:0 0 auto;color:var(--wx-text-dim);font-size:1rem;transition:transform var(--wx-dur-state) var(--wx-ease-out);}
    .al-fila:has(.al-detalle) .al-chev{transform:rotate(180deg);}

    /* -------------------------------------------------------------- detalle */
    .al-detalle{padding:0 1rem 1rem;border-top:1px solid var(--wx-edge);margin-top:-1px;}
    /* Solo opacidad y un desplazamiento minimo: animar la altura empujaria
       todas las filas de debajo, y desplegar es una accion frecuente. */
    .al-detalle{animation:al-abre var(--wx-dur-state) var(--wx-ease-out) both;}
    @keyframes al-abre{from{opacity:0;transform:translateY(-4px);}to{opacity:1;transform:translateY(0);}}
    .al-detalle .scroll{max-height:300px;overflow:auto;margin-top:.85rem;}

    /* ---------------------------------------------------------------- tira */
    .al-tira{display:flex;flex-wrap:wrap;}
    .al-tira__it{display:flex;align-items:center;gap:.6rem;padding:.55rem 1.15rem .55rem 0;min-width:0;}
    .al-tira__it + .al-tira__it{border-left:1px solid var(--wx-edge);padding-left:1.15rem;}
    .al-tira__it > i{color:var(--wx-success);font-size:1.1rem;flex:0 0 auto;}
    .al-tira__t{display:block;font-size:.85rem;font-weight:500;color:var(--wx-text);}
    .al-tira__s{display:block;font-size:.75rem;color:var(--wx-text-dim);}

    /* ------------------------------------------------------------ controles */
    .al-sel-wrap{position:relative;}
    .al-sel{display:flex;align-items:center;gap:.35rem;border:1px solid var(--wx-edge);background:var(--wx-surface);border-radius:var(--wx-radius-sm);padding:.4rem .65rem;font-size:.82rem;font-weight:600;color:var(--wx-text-muted);cursor:pointer;white-space:nowrap;}
    .al-menu{position:absolute;top:calc(100% + 4px);right:0;background:var(--wx-raised);border:1px solid var(--wx-edge-strong);border-radius:var(--wx-radius-sm);box-shadow:var(--wx-shadow-menu);z-index:30;min-width:130px;overflow:hidden;}
    .al-menu-opt{padding:.5rem .85rem;cursor:pointer;font-size:.85rem;white-space:nowrap;}
    .al-menu-opt:hover{background:var(--wx-hover);}

    .al-btn{border:1px solid var(--wx-edge);background:var(--wx-surface);border-radius:var(--wx-radius-sm);padding:.45rem .7rem;font:inherit;font-size:.82rem;font-weight:600;color:var(--wx-text-muted);cursor:pointer;white-space:nowrap;
      transition:background var(--wx-dur-press) ease,color var(--wx-dur-press) ease,transform var(--wx-dur-press) var(--wx-ease-out);}
    @media (hover:hover) and (pointer:fine){.al-btn:hover:not(:disabled){background:var(--wx-hover);color:var(--wx-text);}}
    .al-btn:active:not(:disabled){transform:scale(.97);}
    .al-btn:disabled{opacity:.45;cursor:default;}
    .al-btn:focus-visible{outline:2px solid var(--wx-accent);outline-offset:2px;}
    .al-btn--cta{color:var(--wx-text);border-color:var(--wx-edge-strong);}

    /* --------------------------------------------------------------- tabla */
    .al-table{width:100%;border-collapse:collapse;}
    .al-table th{text-align:left;font-size:.7rem;text-transform:uppercase;letter-spacing:.05em;color:var(--wx-text-dim);padding:.5rem .6rem;border-bottom:1px solid var(--wx-edge);font-weight:600;}
    .al-table th.r,.al-table td.r{text-align:right;}
    .al-table td{padding:.55rem .6rem;border-bottom:1px solid var(--wx-edge-soft);font-size:.85rem;color:var(--wx-text);}
    .al-table tbody tr:last-child td{border-bottom:0;}
    .al-table td.r,.al-table .mono{font-variant-numeric:tabular-nums;}
    .al-name{font-weight:600;color:var(--wx-text);}
    .mono{font-family:var(--wx-font-mono);color:var(--wx-text-muted);}

    .pill{display:inline-block;border-radius:999px;padding:.12rem .55rem;font-weight:600;font-size:.76rem;}
    .pill.crit{background:var(--wx-danger-soft);color:var(--wx-danger-ink);}
    .pill.warn{background:var(--wx-warning-soft);color:var(--wx-warning-ink);}
    .pill.ok{background:var(--wx-success-soft);color:var(--wx-success-ink);}
    .sug{font-weight:600;color:var(--wx-accent-text);}

    .al-empty{display:flex;align-items:center;gap:.5rem;color:var(--wx-text-muted);padding:.5rem;font-size:.88rem;}
    .al-empty i{color:var(--wx-success);font-size:1.05rem;}
    .al-load{color:var(--wx-text-dim);padding:.85rem .5rem;font-size:.88rem;}

    /* ------------------------------------------------------------ adaptable */
    /* La fila tiene seis zonas: por debajo de cierto ancho no caben en una
       linea sin que las metricas se aplasten. Se reorganiza en dos alturas
       antes de que eso pase. */
    @media (max-width:1280px){
      .al-fila__cab{grid-template-columns:auto minmax(180px,1fr) minmax(0,1.2fr) auto auto;}
      .al-accion{display:none;}
    }
    @media (max-width:1000px){
      .al-fila__cab{grid-template-columns:auto 1fr auto auto;gap:.85rem;}
      .al-metricas{grid-column:1 / -1;border-left:0;padding-left:0;padding-top:.15rem;}
    }
    @media (max-width:720px){
      .al-wrap{padding:1.25rem 1rem 2.5rem;}
      .al-cabecera{gap:1rem;}
      .al-resumen{width:100%;}
      .al-resumen__c{flex:1 1 0;padding:.85rem 1rem;}
      .al-fila__cab{grid-template-columns:auto 1fr auto;}
      .al-cta{grid-column:1 / -1;justify-content:flex-end;}
      .al-tira__it{flex:1 1 100%;}
      .al-tira__it + .al-tira__it{border-left:0;padding-left:0;border-top:1px solid var(--wx-edge);}
    }

    @media (prefers-reduced-motion:reduce){
      .al-detalle{animation:none;}
      .al-chev{transition:none;}
      .al-btn:active:not(:disabled){transform:none;}
    }
  `],
  template: `
  <div class="al-wrap">

    <header class="al-cabecera">
      <div class="al-cabecera__txt">
        <h2 class="al-title">Alertas</h2>
        <p class="al-sub">Wybix vigila tu negocio y te avisa antes de que sea un problema.</p>
      </div>

      <!-- Resumen: contesta "que necesita mi atencion" antes de leer nada. -->
      <div class="al-resumen">
        <div class="al-resumen__c sev-critico">
          <span class="al-resumen__ico"><i class="ph-fill ph-warning-circle" aria-hidden="true"></i></span>
          <span class="al-resumen__n">{{ totalCritico }}</span>
          <span class="al-resumen__et">{{ totalCritico === 1 ? 'crítica' : 'críticas' }}</span>
        </div>
        <div class="al-resumen__c sev-atencion">
          <span class="al-resumen__ico"><i class="ph-fill ph-warning" aria-hidden="true"></i></span>
          <span class="al-resumen__n">{{ totalAtencion }}</span>
          <span class="al-resumen__et">requieren atención</span>
        </div>
        <div class="al-resumen__c sev-ok">
          <span class="al-resumen__ico"><i class="ph-fill ph-check-circle" aria-hidden="true"></i></span>
          <span class="al-resumen__n">{{ totalOk }}</span>
          <span class="al-resumen__et">en orden</span>
        </div>
      </div>
    </header>

    <!-- Filtros por familia. Los que no tienen nada quedan desactivados en
         lugar de ofrecer una pestaña vacia. -->
    <nav class="al-filtros" aria-label="Filtrar alertas">
      <button *ngFor="let f of filtros" class="al-chip"
              [class.is-on]="filtro === f.id"
              [disabled]="f.id !== 'todas' && !cuentaFiltro(f.id)"
              (click)="ponerFiltro(f.id)">
        {{ f.texto }}
        <span class="al-chip__n" *ngIf="cuentaFiltro(f.id)">{{ cuentaFiltro(f.id) }}</span>
      </button>
    </nav>

    <!-- ================= REQUIEREN ATENCION ================= -->
    <section class="al-bloque" *ngIf="filasActivas.length">
      <div class="al-bloque__cab">
        <h3>Requieren atención</h3>
        <span class="al-bloque__n">{{ filasActivas.length }}</span>
        <p>Alertas que pueden afectar tu operación hoy.</p>
      </div>

      <div class="al-filas">
        <ng-container *ngFor="let f of filasActivas">
        <!-- riesgo -->
        <article class="al-fila" *ngIf="f === 'riesgo'" [ngClass]="'sev-'+sev('riesgo')">
          <div class="al-fila__cab" (click)="alternar('riesgo')" role="button" tabindex="0"
               [attr.aria-expanded]="abierta('riesgo')" (keydown.enter)="alternar('riesgo')">

            <span class="al-tile"><i class="ph {{ CATALOGO['riesgo'].icono }}" aria-hidden="true"></i></span>

            <div class="al-ident">
              <div class="al-ident__l1">
                <h3>{{ CATALOGO['riesgo'].titulo }}</h3>
                <span class="al-badge">{{ sevTexto('riesgo') }}</span>
              </div>
              <p class="al-ident__l2">{{ CATALOGO['riesgo'].explica }}</p>
            </div>

            <div class="al-metricas">
              <div class="al-metrica" *ngFor="let m of metricas('riesgo')" [ngClass]="m.tono ? 'tono-'+m.tono : ''">
                <span class="al-metrica__et">{{ m.etiqueta }}</span>
                <span class="al-metrica__v" [class.es-fuerte]="m.fuerte">{{ m.valor }}</span>
              </div>
            </div>

            <div class="al-accion">
              <span class="al-accion__et">Acción recomendada</span>
              <span class="al-accion__t">{{ CATALOGO['riesgo'].accion }}</span>
            </div>

            <div class="al-cta" (click)="$event.stopPropagation()">
              <button class="al-btn al-btn--cta" (click)="alternar('riesgo')">{{ CATALOGO['riesgo'].cta }}</button>
            </div>

            <span class="al-chev" aria-hidden="true"><i class="ph ph-caret-down"></i></span>
          </div>

          <div class="al-detalle" *ngIf="abierta('riesgo')">
            <div class="al-load" *ngIf="cargando('riesgo')">Cargando…</div>
            <div class="scroll" *ngIf="riesgo.length">
                      <table class="al-table">
                        <thead><tr><th>Cajero</th><th class="r">Anuladas</th><th class="r">Devol.</th><th class="r">Cajón s/venta</th><th class="r">Descuentos</th><th class="r">Riesgo</th></tr></thead>
                        <tbody>
                          <tr *ngFor="let c of riesgo">
                            <td class="al-name">{{ c.cajero }}</td>
                            <td class="r">{{ c.anuladas }}</td>
                            <td class="r">{{ c.devoluciones }}</td>
                            <td class="r">{{ c.cajon_sin_venta }}</td>
                            <td class="r">{{ c.descuentos }}</td>
                            <td class="r"><span class="pill" [ngClass]="nivelClase(c.nivel)">{{ nivelTexto(c.nivel) }} · {{ c.score }}</span></td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
          </div>
        </article>
        <!-- reorden -->
        <article class="al-fila" *ngIf="f === 'reorden'" [ngClass]="'sev-'+sev('reorden')">
          <div class="al-fila__cab" (click)="alternar('reorden')" role="button" tabindex="0"
               [attr.aria-expanded]="abierta('reorden')" (keydown.enter)="alternar('reorden')">

            <span class="al-tile"><i class="ph {{ CATALOGO['reorden'].icono }}" aria-hidden="true"></i></span>

            <div class="al-ident">
              <div class="al-ident__l1">
                <h3>{{ CATALOGO['reorden'].titulo }}</h3>
                <span class="al-badge">{{ sevTexto('reorden') }}</span>
              </div>
              <p class="al-ident__l2">{{ CATALOGO['reorden'].explica }}</p>
            </div>

            <div class="al-metricas">
              <div class="al-metrica" *ngFor="let m of metricas('reorden')" [ngClass]="m.tono ? 'tono-'+m.tono : ''">
                <span class="al-metrica__et">{{ m.etiqueta }}</span>
                <span class="al-metrica__v" [class.es-fuerte]="m.fuerte">{{ m.valor }}</span>
              </div>
            </div>

            <div class="al-accion">
              <span class="al-accion__et">Acción recomendada</span>
              <span class="al-accion__t">{{ CATALOGO['reorden'].accion }}</span>
            </div>

            <div class="al-cta" (click)="$event.stopPropagation()">
            <div class="al-sel-wrap" (click)="$event.stopPropagation()">
              <div class="al-sel" (click)="menuDias = !menuDias">≤ {{ diasAlerta }} días <i class="ph ph-caret-down"></i></div>
              <div class="al-menu" *ngIf="menuDias">
                <div class="al-menu-opt" *ngFor="let d of opcionesDias" (click)="setDias(d); menuDias=false">≤ {{ d }} días</div>
              </div>
            </div>
            <button class="al-btn" (click)="$event.stopPropagation(); exportarReorden('excel')" [disabled]="!reorden.length" title="Exportar a Excel"><i class="ph ph-file-xls"></i></button>
            <button class="al-btn" (click)="$event.stopPropagation(); exportarReorden('pdf')" [disabled]="!reorden.length" title="Exportar a PDF"><i class="ph ph-file-pdf"></i></button>
              <button class="al-btn al-btn--cta" (click)="alternar('reorden')">{{ CATALOGO['reorden'].cta }}</button>
            </div>

            <span class="al-chev" aria-hidden="true"><i class="ph ph-caret-down"></i></span>
          </div>

          <div class="al-detalle" *ngIf="abierta('reorden')">
            <div class="al-load" *ngIf="cargando('reorden')">Cargando…</div>
            <div class="scroll" *ngIf="reorden.length">
                      <table class="al-table">
                        <thead><tr><th>Producto</th><th class="r">Stock</th><th class="r">Vende/día</th><th class="r">Se acaba en</th><th class="r">Pedir</th></tr></thead>
                        <tbody>
                          <tr *ngFor="let f of reorden">
                            <td class="al-name">
                              {{ f.nombre }}
                              <!-- En una receta, "quedan 3" no dice que reponer.
                                   El ingrediente que la limita, si. -->
                              <div class="al-sub" *ngIf="f.limita_nombre">
                                falta {{ f.limita_nombre }}: hay {{ f.limita_stock }} {{ f.limita_uom }},
                                cada uno lleva {{ f.limita_necesita }} {{ f.limita_uom }}
                              </div>
                            </td>
                            <td class="r">{{ existencia(f) }}</td>
                            <td class="r">{{ f.prom_diario }}</td>
                            <td class="r"><span class="pill" [ngClass]="urgencia(f.dias_restantes)">{{ plazo(f) }}</span></td>
                            <td class="r sug">{{ f.sugerido == null ? '—' : f.sugerido }}</td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
          </div>
        </article>
        <!-- low -->
        <article class="al-fila" *ngIf="f === 'low'" [ngClass]="'sev-'+sev('low')">
          <div class="al-fila__cab" (click)="alternar('low')" role="button" tabindex="0"
               [attr.aria-expanded]="abierta('low')" (keydown.enter)="alternar('low')">

            <span class="al-tile"><i class="ph {{ CATALOGO['low'].icono }}" aria-hidden="true"></i></span>

            <div class="al-ident">
              <div class="al-ident__l1">
                <h3>{{ CATALOGO['low'].titulo }}</h3>
                <span class="al-badge">{{ sevTexto('low') }}</span>
              </div>
              <p class="al-ident__l2">{{ CATALOGO['low'].explica }}</p>
            </div>

            <div class="al-metricas">
              <div class="al-metrica" *ngFor="let m of metricas('low')" [ngClass]="m.tono ? 'tono-'+m.tono : ''">
                <span class="al-metrica__et">{{ m.etiqueta }}</span>
                <span class="al-metrica__v" [class.es-fuerte]="m.fuerte">{{ m.valor }}</span>
              </div>
            </div>

            <div class="al-accion">
              <span class="al-accion__et">Acción recomendada</span>
              <span class="al-accion__t">{{ CATALOGO['low'].accion }}</span>
            </div>

            <div class="al-cta" (click)="$event.stopPropagation()">
            <div class="al-sel-wrap" (click)="$event.stopPropagation()">
              <div class="al-sel" (click)="menuMin = !menuMin">≤ {{ minStock }} <i class="ph ph-caret-down"></i></div>
              <div class="al-menu" *ngIf="menuMin">
                <div class="al-menu-opt" *ngFor="let n of opcionesMin" (click)="setMin(n); menuMin=false">≤ {{ n }}</div>
              </div>
            </div>
              <button class="al-btn al-btn--cta" (click)="alternar('low')">{{ CATALOGO['low'].cta }}</button>
            </div>

            <span class="al-chev" aria-hidden="true"><i class="ph ph-caret-down"></i></span>
          </div>

          <div class="al-detalle" *ngIf="abierta('low')">
            <div class="al-load" *ngIf="cargando('low')">Cargando…</div>
            <div class="scroll" *ngIf="lowStock.length">
                      <table class="al-table">
                        <thead><tr><th>Producto</th><th>No. parte</th><th class="r">Stock</th></tr></thead>
                        <tbody>
                          <tr *ngFor="let a of lowStock">
                            <td class="al-name">{{ a.nombre }}</td>
                            <td class="mono">{{ a.part_number || '-' }}</td>
                            <td class="r"><span class="pill" [ngClass]="a.stock <= 1 ? 'crit' : 'warn'">{{ a.stock }}</span></td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
          </div>
        </article>
        <!-- agotados -->
        <article class="al-fila" *ngIf="f === 'agotados'" [ngClass]="'sev-'+sev('agotados')">
          <div class="al-fila__cab" (click)="alternar('agotados')" role="button" tabindex="0"
               [attr.aria-expanded]="abierta('agotados')" (keydown.enter)="alternar('agotados')">

            <span class="al-tile"><i class="ph {{ CATALOGO['agotados'].icono }}" aria-hidden="true"></i></span>

            <div class="al-ident">
              <div class="al-ident__l1">
                <h3>{{ CATALOGO['agotados'].titulo }}</h3>
                <span class="al-badge">{{ sevTexto('agotados') }}</span>
              </div>
              <p class="al-ident__l2">{{ CATALOGO['agotados'].explica }}</p>
            </div>

            <div class="al-metricas">
              <div class="al-metrica" *ngFor="let m of metricas('agotados')" [ngClass]="m.tono ? 'tono-'+m.tono : ''">
                <span class="al-metrica__et">{{ m.etiqueta }}</span>
                <span class="al-metrica__v" [class.es-fuerte]="m.fuerte">{{ m.valor }}</span>
              </div>
            </div>

            <div class="al-accion">
              <span class="al-accion__et">Acción recomendada</span>
              <span class="al-accion__t">{{ CATALOGO['agotados'].accion }}</span>
            </div>

            <div class="al-cta" (click)="$event.stopPropagation()">
              <button class="al-btn al-btn--cta" (click)="alternar('agotados')">{{ CATALOGO['agotados'].cta }}</button>
            </div>

            <span class="al-chev" aria-hidden="true"><i class="ph ph-caret-down"></i></span>
          </div>

          <div class="al-detalle" *ngIf="abierta('agotados')">
            <div class="al-load" *ngIf="cargando('agotados')">Cargando…</div>
            <div class="scroll" *ngIf="agotados.length">
                      <table class="al-table">
                        <thead><tr><th>Producto</th><th>No. parte</th><th class="r">Stock</th></tr></thead>
                        <tbody>
                          <tr *ngFor="let a of agotados">
                            <td class="al-name">{{ a.nombre }}</td>
                            <td class="mono">{{ a.part_number || '-' }}</td>
                            <td class="r"><span class="pill crit">{{ a.stock }}</span></td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
          </div>
        </article>
        <!-- muertos -->
        <article class="al-fila" *ngIf="f === 'muertos'" [ngClass]="'sev-'+sev('muertos')">
          <div class="al-fila__cab" (click)="alternar('muertos')" role="button" tabindex="0"
               [attr.aria-expanded]="abierta('muertos')" (keydown.enter)="alternar('muertos')">

            <span class="al-tile"><i class="ph {{ CATALOGO['muertos'].icono }}" aria-hidden="true"></i></span>

            <div class="al-ident">
              <div class="al-ident__l1">
                <h3>{{ CATALOGO['muertos'].titulo }}</h3>
                <span class="al-badge">{{ sevTexto('muertos') }}</span>
              </div>
              <p class="al-ident__l2">{{ CATALOGO['muertos'].explica }}</p>
            </div>

            <div class="al-metricas">
              <div class="al-metrica" *ngFor="let m of metricas('muertos')" [ngClass]="m.tono ? 'tono-'+m.tono : ''">
                <span class="al-metrica__et">{{ m.etiqueta }}</span>
                <span class="al-metrica__v" [class.es-fuerte]="m.fuerte">{{ m.valor }}</span>
              </div>
            </div>

            <div class="al-accion">
              <span class="al-accion__et">Acción recomendada</span>
              <span class="al-accion__t">{{ CATALOGO['muertos'].accion }}</span>
            </div>

            <div class="al-cta" (click)="$event.stopPropagation()">
              <button class="al-btn al-btn--cta" (click)="alternar('muertos')">{{ CATALOGO['muertos'].cta }}</button>
            </div>

            <span class="al-chev" aria-hidden="true"><i class="ph ph-caret-down"></i></span>
          </div>

          <div class="al-detalle" *ngIf="abierta('muertos')">
            <div class="al-load" *ngIf="cargando('muertos')">Cargando…</div>
            <div class="scroll" *ngIf="muertos.length">
                      <table class="al-table">
                        <thead><tr><th>Producto</th><th class="r">Stock</th></tr></thead>
                        <tbody>
                          <tr *ngFor="let m of muertos">
                            <td class="al-name">{{ m.nombre || m.product_name || '-' }}</td>
                            <td class="r">{{ m.stock ?? '-' }}</td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
          </div>
        </article>
        <!-- cero -->
        <article class="al-fila" *ngIf="f === 'cero'" [ngClass]="'sev-'+sev('cero')">
          <div class="al-fila__cab" (click)="alternar('cero')" role="button" tabindex="0"
               [attr.aria-expanded]="abierta('cero')" (keydown.enter)="alternar('cero')">

            <span class="al-tile"><i class="ph {{ CATALOGO['cero'].icono }}" aria-hidden="true"></i></span>

            <div class="al-ident">
              <div class="al-ident__l1">
                <h3>{{ CATALOGO['cero'].titulo }}</h3>
                <span class="al-badge">{{ sevTexto('cero') }}</span>
              </div>
              <p class="al-ident__l2">{{ CATALOGO['cero'].explica }}</p>
            </div>

            <div class="al-metricas">
              <div class="al-metrica" *ngFor="let m of metricas('cero')" [ngClass]="m.tono ? 'tono-'+m.tono : ''">
                <span class="al-metrica__et">{{ m.etiqueta }}</span>
                <span class="al-metrica__v" [class.es-fuerte]="m.fuerte">{{ m.valor }}</span>
              </div>
            </div>

            <div class="al-accion">
              <span class="al-accion__et">Acción recomendada</span>
              <span class="al-accion__t">{{ CATALOGO['cero'].accion }}</span>
            </div>

            <div class="al-cta" (click)="$event.stopPropagation()">
              <button class="al-btn al-btn--cta" (click)="alternar('cero')">{{ CATALOGO['cero'].cta }}</button>
            </div>

            <span class="al-chev" aria-hidden="true"><i class="ph ph-caret-down"></i></span>
          </div>

          <div class="al-detalle" *ngIf="abierta('cero')">
            <div class="al-load" *ngIf="cargando('cero')">Cargando…</div>
            <div class="scroll" *ngIf="ventasCero.length">
                      <table class="al-table">
                        <thead><tr><th>Folio</th><th>Fecha</th><th>Cajero</th></tr></thead>
                        <tbody>
                          <tr *ngFor="let v of ventasCero">
                            <td class="al-name">#{{ v.id }}</td>
                            <td>{{ v.datee | date:'dd/MM/yyyy HH:mm' }}</td>
                            <td>{{ v.usuario || '-' }}</td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
          </div>
        </article>
        <!-- descuadre -->
        <article class="al-fila" *ngIf="f === 'descuadre'" [ngClass]="'sev-'+sev('descuadre')">
          <div class="al-fila__cab" (click)="alternar('descuadre')" role="button" tabindex="0"
               [attr.aria-expanded]="abierta('descuadre')" (keydown.enter)="alternar('descuadre')">

            <span class="al-tile"><i class="ph {{ CATALOGO['descuadre'].icono }}" aria-hidden="true"></i></span>

            <div class="al-ident">
              <div class="al-ident__l1">
                <h3>{{ CATALOGO['descuadre'].titulo }}</h3>
                <span class="al-badge">{{ sevTexto('descuadre') }}</span>
              </div>
              <p class="al-ident__l2">{{ CATALOGO['descuadre'].explica }}</p>
            </div>

            <div class="al-metricas">
              <div class="al-metrica" *ngFor="let m of metricas('descuadre')" [ngClass]="m.tono ? 'tono-'+m.tono : ''">
                <span class="al-metrica__et">{{ m.etiqueta }}</span>
                <span class="al-metrica__v" [class.es-fuerte]="m.fuerte">{{ m.valor }}</span>
              </div>
            </div>

            <div class="al-accion">
              <span class="al-accion__et">Acción recomendada</span>
              <span class="al-accion__t">{{ CATALOGO['descuadre'].accion }}</span>
            </div>

            <div class="al-cta" (click)="$event.stopPropagation()">
              <button class="al-btn al-btn--cta" (click)="alternar('descuadre')">{{ CATALOGO['descuadre'].cta }}</button>
            </div>

            <span class="al-chev" aria-hidden="true"><i class="ph ph-caret-down"></i></span>
          </div>

          <div class="al-detalle" *ngIf="abierta('descuadre')">
            <div class="al-load" *ngIf="cargando('descuadre')">Cargando…</div>
            <div class="scroll" *ngIf="descuadres.length">
                      <table class="al-table">
                        <thead><tr><th>Fecha</th><th>Cajero</th><th class="r">Esperado</th><th class="r">Entregado</th><th class="r">Diferencia</th></tr></thead>
                        <tbody>
                          <tr *ngFor="let c of descuadres">
                            <td>{{ c.create_date | date:'dd/MM/yyyy' }}</td>
                            <td class="al-name">{{ c.user_name || '-' }}</td>
                            <td class="r">{{ money(c.cash_expected) }}</td>
                            <td class="r">{{ money(c.cash_delivered) }}</td>
                            <td class="r"><span class="pill" [ngClass]="c.difference < 0 ? 'crit' : 'warn'">{{ money(c.difference) }}</span></td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
          </div>
        </article>
        <!-- devoluciones -->
        <article class="al-fila" *ngIf="f === 'devoluciones'" [ngClass]="'sev-'+sev('devoluciones')">
          <div class="al-fila__cab" (click)="alternar('devoluciones')" role="button" tabindex="0"
               [attr.aria-expanded]="abierta('devoluciones')" (keydown.enter)="alternar('devoluciones')">

            <span class="al-tile"><i class="ph {{ CATALOGO['devoluciones'].icono }}" aria-hidden="true"></i></span>

            <div class="al-ident">
              <div class="al-ident__l1">
                <h3>{{ CATALOGO['devoluciones'].titulo }}</h3>
                <span class="al-badge">{{ sevTexto('devoluciones') }}</span>
              </div>
              <p class="al-ident__l2">{{ CATALOGO['devoluciones'].explica }}</p>
            </div>

            <div class="al-metricas">
              <div class="al-metrica" *ngFor="let m of metricas('devoluciones')" [ngClass]="m.tono ? 'tono-'+m.tono : ''">
                <span class="al-metrica__et">{{ m.etiqueta }}</span>
                <span class="al-metrica__v" [class.es-fuerte]="m.fuerte">{{ m.valor }}</span>
              </div>
            </div>

            <div class="al-accion">
              <span class="al-accion__et">Acción recomendada</span>
              <span class="al-accion__t">{{ CATALOGO['devoluciones'].accion }}</span>
            </div>

            <div class="al-cta" (click)="$event.stopPropagation()">
              <button class="al-btn al-btn--cta" (click)="alternar('devoluciones')">{{ CATALOGO['devoluciones'].cta }}</button>
            </div>

            <span class="al-chev" aria-hidden="true"><i class="ph ph-caret-down"></i></span>
          </div>

          <div class="al-detalle" *ngIf="abierta('devoluciones')">
            <div class="al-load" *ngIf="cargando('devoluciones')">Cargando…</div>
            <div class="scroll" *ngIf="devoluciones.length">
                      <table class="al-table">
                        <thead><tr><th>Cajero</th><th class="r">Devoluciones</th><th class="r">Monto</th></tr></thead>
                        <tbody>
                          <tr *ngFor="let d of devoluciones">
                            <td class="al-name">{{ d.usuario || '-' }}</td>
                            <td class="r">{{ d.num_devoluciones }}</td>
                            <td class="r">{{ money(d.monto) }}</td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
          </div>
        </article>
        <!-- vencidos -->
        <article class="al-fila" *ngIf="f === 'vencidos'" [ngClass]="'sev-'+sev('vencidos')">
          <div class="al-fila__cab" (click)="alternar('vencidos')" role="button" tabindex="0"
               [attr.aria-expanded]="abierta('vencidos')" (keydown.enter)="alternar('vencidos')">

            <span class="al-tile"><i class="ph {{ CATALOGO['vencidos'].icono }}" aria-hidden="true"></i></span>

            <div class="al-ident">
              <div class="al-ident__l1">
                <h3>{{ CATALOGO['vencidos'].titulo }}</h3>
                <span class="al-badge">{{ sevTexto('vencidos') }}</span>
              </div>
              <p class="al-ident__l2">{{ CATALOGO['vencidos'].explica }}</p>
            </div>

            <div class="al-metricas">
              <div class="al-metrica" *ngFor="let m of metricas('vencidos')" [ngClass]="m.tono ? 'tono-'+m.tono : ''">
                <span class="al-metrica__et">{{ m.etiqueta }}</span>
                <span class="al-metrica__v" [class.es-fuerte]="m.fuerte">{{ m.valor }}</span>
              </div>
            </div>

            <div class="al-accion">
              <span class="al-accion__et">Acción recomendada</span>
              <span class="al-accion__t">{{ CATALOGO['vencidos'].accion }}</span>
            </div>

            <div class="al-cta" (click)="$event.stopPropagation()">
              <button class="al-btn al-btn--cta" (click)="alternar('vencidos')">{{ CATALOGO['vencidos'].cta }}</button>
            </div>

            <span class="al-chev" aria-hidden="true"><i class="ph ph-caret-down"></i></span>
          </div>

          <div class="al-detalle" *ngIf="abierta('vencidos')">
            <div class="al-load" *ngIf="cargando('vencidos')">Cargando…</div>
            <div class="scroll" *ngIf="vencidos.length">
                      <table class="al-table">
                        <thead><tr><th>Cliente</th><th class="r">Deuda vencida</th><th class="r">Días</th><th class="r">Facturas</th></tr></thead>
                        <tbody>
                          <tr *ngFor="let v of vencidos">
                            <td class="al-name">{{ nombreCliente(v.customer_id) }}</td>
                            <td class="r">{{ money(v.deuda_vencida) }}</td>
                            <td class="r"><span class="pill crit">{{ v.dias_vencido }}</span></td>
                            <td class="r">{{ v.facturas }}</td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
          </div>
        </article>
        </ng-container>
      </div>
    </section>

    <!-- Nada pendiente. -->
    <section class="al-bloque al-bloque--limpio" *ngIf="!filasActivas.length">
      <i class="ph-fill ph-check-circle" aria-hidden="true"></i>
      <div>
        <h3>Todo en orden</h3>
        <p *ngIf="filtro === 'todas'">No hay nada que requiera tu atención ahora mismo.</p>
        <p *ngIf="filtro !== 'todas'">Nada pendiente en este filtro.</p>
      </div>
    </section>

    <!-- ================= EN ORDEN ================= -->
    <section class="al-bloque al-bloque--ok" *ngIf="filasEnOrden.length">
      <div class="al-bloque__cab">
        <i class="ph-fill ph-check-circle al-bloque__ok" aria-hidden="true"></i>
        <h3>En orden</h3>
        <span class="al-bloque__n">{{ filasEnOrden.length }}</span>
        <p>Todo bajo control. Sigue así.</p>
      </div>

      <!-- Tira compacta: una categoria sin incidencias no necesita mas que su
           nombre y la confirmacion de que esta bien. -->
      <div class="al-tira">
        <div class="al-tira__it" *ngFor="let f of filasEnOrden">
          <i class="ph-fill ph-check-circle" aria-hidden="true"></i>
          <div>
            <span class="al-tira__t">{{ CATALOGO[f].titulo }}</span>
            <span class="al-tira__s">Sin incidencias</span>
          </div>
        </div>
      </div>
    </section>

  </div>
  `
})
export class Alertas implements OnInit {
  private get api() { return (window as any).electronAPI; }

  // Reorden
  reorden: Reorden[] = [];
  cargandoReorden = false;
  diasAlerta = 7;
  opcionesDias = [3, 7, 15, 30];
  menuDias = false;

  // Otras alertas
  lowStock: any[] = []; cargandoLow = false; minStock = 3; opcionesMin = [3, 5, 10]; menuMin = false;
  agotados: any[] = []; cargandoAgotados = false;
  muertos: any[] = []; cargandoMuertos = false;
  ventasCero: any[] = []; cargandoCero = false;
  descuadres: any[] = []; cargandoDescuadre = false;
  devoluciones: any[] = []; cargandoDevol = false;
  vencidos: any[] = []; cargandoVencidos = false;
  riesgo: any[] = []; cargandoRiesgo = false;
  private clientesMap: Record<number, string> = {};

  constructor(private reports: ReportService) {}

  async ngOnInit() {
    await Promise.all([
      this.cargarReorden(), this.cargarLow(), this.cargarAgotados(), this.cargarMuertos(), this.cargarCero(),
      this.cargarDescuadre(), this.cargarDevoluciones(), this.cargarVencidos(), this.cargarRiesgo()
    ]);
  }

  async cargarLow() {
    this.menuMin = false;
    this.cargandoLow = true;
    try {
      const r = await this.api?.alertsLowStock?.({ min: this.minStock });
      this.lowStock = r?.success ? (r.data || []) : [];
    } catch { this.lowStock = []; } finally { this.cargandoLow = false; }
  }
  setMin(n: number) { this.minStock = n; this.cargarLow(); }

  money(n: any): string { return '$' + Number(n || 0).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  nombreCliente(id: number): string { return this.clientesMap[id] || ('Cliente #' + id); }

  async cargarDescuadre() {
    this.cargandoDescuadre = true;
    try {
      const r = await this.api?.alertsCashClosures?.({ dias: 30 });
      const rows = r?.success ? (r.data || []) : [];
      this.descuadres = rows.filter((c: any) => Number(c.difference) !== 0);
    } catch { this.descuadres = []; } finally { this.cargandoDescuadre = false; }
  }

  async cargarDevoluciones() {
    this.cargandoDevol = true;
    try {
      const r = await this.api?.alertsRefundsByCashier?.();
      this.devoluciones = r?.success ? (r.data || []) : [];
    } catch { this.devoluciones = []; } finally { this.cargandoDevol = false; }
  }

  // ---- Blindaje: riesgo por cajero ----
  async cargarRiesgo() {
    this.cargandoRiesgo = true;
    try {
      const r = await this.api?.securityRisk?.();
      this.riesgo = (r?.success ? (r.data || []) : []).filter((c: any) => Number(c.score) > 0);
    } catch { this.riesgo = []; } finally { this.cargandoRiesgo = false; }
  }
  get riesgoAlto(): number { return this.riesgo.filter(c => c.nivel === 'alto').length; }
  nivelClase(n: string): string { return n === 'alto' ? 'crit' : n === 'medio' ? 'warn' : 'ok'; }
  nivelTexto(n: string): string { return n === 'alto' ? 'Alto' : n === 'medio' ? 'Medio' : 'Bajo'; }

  async cargarVencidos() {
    this.cargandoVencidos = true;
    try {
      await this.cargarClientesMap();
      const r = await this.api?.alertsOverdueCredit?.();
      this.vencidos = r?.success ? (r.data || []) : [];
    } catch { this.vencidos = []; } finally { this.cargandoVencidos = false; }
  }

  private async cargarClientesMap() {
    try {
      const r = await this.api?.getCreditCustomers?.();
      const arr = Array.isArray(r) ? r : (Array.isArray(r?.data) ? r.data : []);
      const map: Record<number, string> = {};
      for (const c of arr) {
        const id = Number(c.id ?? c.customer_id);
        const nm = c.customerName ?? c.name ?? c.nombre ?? c.customer_name;
        if (Number.isFinite(id)) map[id] = nm || ('Cliente #' + id);
      }
      this.clientesMap = map;
    } catch { this.clientesMap = {}; }
  }

  // ---- Reorden ----
  async cargarReorden() {
    this.menuDias = false;
    this.cargandoReorden = true;
    try {
      const r = await this.api?.alertsReorder?.({ dias_alerta: this.diasAlerta });
      this.reorden = r?.success ? (r.data || []) : [];
    } catch { this.reorden = []; } finally { this.cargandoReorden = false; }
  }
  setDias(d: number) { this.diasAlerta = d; this.cargarReorden(); }
  urgencia(d: number): string { return d <= 2 ? 'crit' : d <= 5 ? 'warn' : 'ok'; }

  /**
   * Cuanto le queda, en palabras.
   *
   * Cero dias NO es "se acaba en 0 dias": es que ya no hay. Escribirlo como un
   * plazo era lo que producia el "se acabara en menos de 0 dias" que se vio en
   * la VM -sintoma de que el calculo tomaba el stock 0 de una receta, ya
   * corregido en SQL-. Aqui se cierra el circulo: aunque el numero fuera raro,
   * la pantalla no puede decir un absurdo.
   */
  plazo(f: Reorden): string {
    const d = Math.max(0, Math.floor(Number(f?.dias_restantes) || 0));
    if (d <= 0) return 'Sin existencias';
    return d === 1 ? '1 día' : `${d} días`;
  }

  /** La existencia con su unidad. Una receta se cuenta en unidades servibles. */
  existencia(f: Reorden): string {
    const n = Number(f?.stock) || 0;
    if (f?.inventory_mode === 'RECIPE') return `${n} por preparar`;
    return `${n} ${f?.base_uom || 'pza'}`;
  }

  // ---- Agotados ----
  async cargarAgotados() {
    this.cargandoAgotados = true;
    try {
      const r = await this.api?.alertsOutOfStock?.();
      this.agotados = r?.success ? (r.data || []) : [];
    } catch { this.agotados = []; } finally { this.cargandoAgotados = false; }
  }

  // ---- Muertos (reutiliza sp_dead_products) ----
  async cargarMuertos() {
    this.cargandoMuertos = true;
    try {
      const r = await this.api?.deadProducts?.({});
      this.muertos = (r?.success ? r.data : (Array.isArray(r) ? r : r?.data)) || [];
    } catch { this.muertos = []; } finally { this.cargandoMuertos = false; }
  }

  // ---- Ventas en $0 ----
  async cargarCero() {
    this.cargandoCero = true;
    try {
      const r = await this.api?.alertsZeroSales?.({ dias: 30 });
      this.ventasCero = r?.success ? (r.data || []) : [];
    } catch { this.ventasCero = []; } finally { this.cargandoCero = false; }
  }


  // ==========================================================================
  // PRIORIDAD (solo presentacion)
  // --------------------------------------------------------------------------
  // La gravedad NO introduce niveles nuevos: sale de las mismas senales que el
  // codigo ya usaba para pintar un recuento en rojo (`al-count crit`) y de los
  // umbrales que ya existian en `urgencia()` y en `nivel`.
  //
  // Ningun dato, consulta ni calculo cambia aqui.
  // ==========================================================================

  /** Filas desplegadas. Las categorias en orden no se despliegan. */
  private desplegadas = new Set<string>();

  /** Gravedad de una categoria a partir de su estado real. */
  sev(id: string): 'critico' | 'atencion' | 'informativo' | 'ok' {
    switch (id) {
      // Ya se marcaba en rojo cuando habia algun cajero en nivel alto.
      case 'riesgo':       return this.riesgoAlto ? 'critico' : (this.riesgo.length ? 'atencion' : 'ok');
      // `urgencia()` ya consideraba critico <= 2 dias.
      case 'reorden':      return this.reorden.some(r => r.dias_restantes <= 2) ? 'critico'
                                : (this.reorden.length ? 'atencion' : 'ok');
      case 'agotados':     return this.agotados.length ? 'critico' : 'ok';
      case 'cero':         return this.ventasCero.length ? 'critico' : 'ok';
      case 'descuadre':    return this.descuadres.length ? 'critico' : 'ok';
      case 'vencidos':     return this.vencidos.length ? 'critico' : 'ok';
      case 'low':          return this.lowStock.length ? 'atencion' : 'ok';
      case 'devoluciones': return this.devoluciones.length ? 'informativo' : 'ok';
      case 'muertos':      return this.muertos.length ? 'informativo' : 'ok';
      default:             return 'ok';
    }
  }

  /** Orden visual: lo urgente primero, lo que esta en orden al final. */
  orden(id: string): number {
    const peso = { critico: 0, atencion: 10, informativo: 20, ok: 30 } as const;
    return peso[this.sev(id)] + this.POSICION.indexOf(id);
  }
  private readonly POSICION = ['riesgo','agotados','vencidos','descuadre','cero',
                               'reorden','low','devoluciones','muertos'];

  private readonly TODAS = ['riesgo','reorden','low','agotados','muertos',
                            'cero','descuadre','devoluciones','vencidos'];

  /**
   * Una categoria en orden no se despliega: no hay nada que mirar, y ocupar
   * pantalla con ello es justo lo que hacia ilegible la version anterior.
   * Las criticas empiezan abiertas.
   */
  abierta(id: string): boolean {
    if (this.sev(id) === 'ok') return false;
    if (this.desplegadas.has('!' + id)) return false;   // cerrada a mano
    return this.desplegadas.has(id) || this.sev(id) === 'critico';
  }

  alternar(id: string) {
    if (this.sev(id) === 'ok') return;
    if (this.abierta(id)) {
      this.desplegadas.delete(id);
      this.desplegadas.add('!' + id);
    } else {
      this.desplegadas.delete('!' + id);
      this.desplegadas.add(id);
    }
  }

  private cuenta(s: string): number { return this.TODAS.filter(id => this.sev(id) === s).length; }
  get totalCritico(): number { return this.cuenta('critico'); }
  get totalAtencion(): number { return this.cuenta('atencion') + this.cuenta('informativo'); }
  get totalOk(): number { return this.cuenta('ok'); }


  // ==========================================================================
  // MODELO DE VISTA
  // ==========================================================================

  /** Filtro por familia. Vive arriba, junto al resumen. */
  filtro: 'todas' | 'criticas' | 'inventario' | 'caja' | 'clientes' | 'auditoria' = 'todas';
  readonly filtros = [
    { id: 'todas',     texto: 'Todas' },
    { id: 'criticas',  texto: 'Críticas' },
    { id: 'inventario', texto: 'Inventario' },
    { id: 'caja',      texto: 'Caja' },
    { id: 'clientes',  texto: 'Clientes' },
    { id: 'auditoria', texto: 'Auditoría' },
  ] as const;

  /**
   * Descripcion de cada categoria. La explicacion contesta "por que importa",
   * que es lo que faltaba: antes solo estaba el nombre tecnico.
   */
  readonly CATALOGO: Record<string, {
    titulo: string; icono: string; grupo: string; explica: string;
    accion: string; cta: string;
  }> = {
    agotados:     { titulo: 'Productos agotados', icono: 'ph-package', grupo: 'inventario',
                    explica: 'Productos activos sin una sola unidad disponible.',
                    accion: 'Reabastece para no perder ventas.', cta: 'Ver inventario' },
    vencidos:     { titulo: 'Crédito vencido', icono: 'ph-calendar-x', grupo: 'clientes',
                    explica: 'Clientes que ya pasaron su fecha de pago.',
                    accion: 'Contacta para cobrar.', cta: 'Ver cobranza' },
    descuadre:    { titulo: 'Descuadre en corte de caja', icono: 'ph-scales', grupo: 'caja',
                    explica: 'Cortes donde lo entregado no coincide con lo esperado.',
                    accion: 'Revisa el corte con el cajero.', cta: 'Revisar cortes' },
    cero:         { titulo: 'Ventas en $0', icono: 'ph-receipt-x', grupo: 'caja',
                    explica: 'Tickets cerrados en cero. Puede ser un error o una fuga.',
                    accion: 'Revisa esos folios.', cta: 'Revisar' },
    riesgo:       { titulo: 'Blindaje · Riesgo por cajero', icono: 'ph-shield-check', grupo: 'auditoria',
                    explica: 'Anulaciones, devoluciones, cajón sin venta y descuentos (30 días).',
                    accion: 'Revisa la actividad del cajero.', cta: 'Ver detalle' },
    reorden:      { titulo: 'Reorden inteligente', icono: 'ph-cube', grupo: 'inventario',
                    explica: 'Productos que se acabarán pronto según su ritmo de venta.',
                    accion: 'Genera el pedido sugerido.', cta: 'Generar pedido' },
    low:          { titulo: 'Stock bajo', icono: 'ph-battery-low', grupo: 'inventario',
                    explica: 'Productos rozando el mínimo que definiste.',
                    accion: 'Ajusta el mínimo o repón stock.', cta: 'Ajustar mínimo' },
    devoluciones: { titulo: 'Devoluciones por cajero', icono: 'ph-arrow-u-up-left', grupo: 'auditoria',
                    explica: 'Cómo se reparten las devoluciones entre cajeros.',
                    accion: 'Revisa las devoluciones.', cta: 'Ver detalle' },
    muertos:      { titulo: 'Productos sin rotación', icono: 'ph-snowflake', grupo: 'inventario',
                    explica: 'Ocupan inventario y llevan tiempo sin venderse.',
                    accion: 'Considera liquidar o devolver.', cta: 'Ver detalle' },
  };

  /** Cuantos elementos tiene una categoria. */
  conteo(id: string): number {
    switch (id) {
      case 'riesgo':       return this.riesgo.length;
      case 'reorden':      return this.reorden.length;
      case 'low':          return this.lowStock.length;
      case 'agotados':     return this.agotados.length;
      case 'muertos':      return this.muertos.length;
      case 'cero':         return this.ventasCero.length;
      case 'descuadre':    return this.descuadres.length;
      case 'devoluciones': return this.devoluciones.length;
      case 'vencidos':     return this.vencidos.length;
      default:             return 0;
    }
  }

  /** ¿Sigue cargando esta categoria? */
  cargando(id: string): boolean {
    switch (id) {
      case 'riesgo':       return this.cargandoRiesgo;
      case 'reorden':      return this.cargandoReorden;
      case 'low':          return this.cargandoLow;
      case 'agotados':     return this.cargandoAgotados;
      case 'muertos':      return this.cargandoMuertos;
      case 'cero':         return this.cargandoCero;
      case 'descuadre':    return this.cargandoDescuadre;
      case 'devoluciones': return this.cargandoDevol;
      case 'vencidos':     return this.cargandoVencidos;
      default:             return false;
    }
  }

  /**
   * Metricas que se ven en la propia fila, tomadas del primer elemento: las
   * consultas ya devuelven ordenado por gravedad, asi que es el peor caso.
   * `fuerte` marca la cifra que debe leerse primero.
   */
  metricas(id: string): Array<{ etiqueta: string; valor: string; fuerte?: boolean; tono?: string }> {
    const n = (v: any) => (v === null || v === undefined ? '—' : String(v));
    switch (id) {
      case 'agotados': {
        const a = this.agotados[0]; if (!a) return [];
        return [{ etiqueta: 'Producto', valor: n(a.nombre) },
                { etiqueta: 'Stock', valor: '0', fuerte: true, tono: 'critico' }];
      }
      case 'low': {
        const a = this.lowStock[0]; if (!a) return [];
        return [{ etiqueta: 'Producto', valor: n(a.nombre) },
                { etiqueta: 'No. parte', valor: n(a.part_number) },
                { etiqueta: 'Stock actual', valor: n(a.stock), fuerte: true, tono: 'atencion' },
                { etiqueta: 'Mínimo', valor: '≤ ' + this.minStock }];
      }
      case 'reorden': {
        const f = this.reorden[0]; if (!f) return [];
        const filas = [{ etiqueta: 'Producto', valor: n(f.nombre) },
                       { etiqueta: 'Se acaba en', valor: this.plazo(f), fuerte: true, tono: 'atencion' }];
        if (f.limita_nombre) {
          filas.push({ etiqueta: 'Lo limita', valor: `${f.limita_nombre} (${f.limita_stock} ${f.limita_uom})` });
        }
        filas.push({ etiqueta: 'Pedir', valor: f.sugerido == null ? '—' : n(f.sugerido) });
        return filas;
      }
      case 'muertos': {
        const m = this.muertos[0]; if (!m) return [];
        return [{ etiqueta: 'Producto', valor: n(m.nombre) },
                { etiqueta: 'Stock parado', valor: n(m.stock), fuerte: true }];
      }
      case 'riesgo': {
        const c = this.riesgo[0]; if (!c) return [];
        return [{ etiqueta: 'Cajero', valor: n(c.cajero) },
                { etiqueta: 'Riesgo', valor: this.nivelTexto(c.nivel) + ' · ' + n(c.score),
                  fuerte: true, tono: c.nivel === 'alto' ? 'critico' : 'atencion' }];
      }
      case 'devoluciones': {
        const d = this.devoluciones[0]; if (!d) return [];
        return [{ etiqueta: 'Cajero', valor: n(d.usuario) },
                { etiqueta: 'Devoluciones', valor: n(d.num_devoluciones), fuerte: true }];
      }
      case 'cero': {
        const v = this.ventasCero[0]; if (!v) return [];
        return [{ etiqueta: 'Folio', valor: '#' + n(v.id) },
                { etiqueta: 'Cajero', valor: n(v.usuario), fuerte: true, tono: 'critico' }];
      }
      case 'descuadre': {
        const c = this.descuadres[0]; if (!c) return [];
        return [{ etiqueta: 'Cajero', valor: n(c.user_name) },
                { etiqueta: 'Cortes', valor: n(this.descuadres.length), fuerte: true, tono: 'critico' }];
      }
      case 'vencidos': {
        const v = this.vencidos[0]; if (!v) return [];
        return [{ etiqueta: 'Días vencido', valor: n(v.dias_vencido), fuerte: true, tono: 'critico' },
                { etiqueta: 'Facturas', valor: n(v.facturas) }];
      }
      default: return [];
    }
  }

  /** Categorias que requieren atencion, ya ordenadas y filtradas. */
  get filasActivas() {
    return this.TODAS
      .filter(id => this.sev(id) !== 'ok')
      .filter(id => this.pasaFiltro(id))
      .sort((a, b) => this.orden(a) - this.orden(b));
  }

  /** Categorias sin incidencias. Van al final, en una tira compacta. */
  get filasEnOrden() {
    return this.TODAS.filter(id => this.sev(id) === 'ok');
  }

  private pasaFiltro(id: string): boolean {
    if (this.filtro === 'todas') return true;
    if (this.filtro === 'criticas') return this.sev(id) === 'critico';
    return this.CATALOGO[id]?.grupo === this.filtro;
  }

  ponerFiltro(f: any) { this.filtro = f; }

  /** Cuantas hay en cada filtro, para no ofrecer pestañas vacias. */
  cuentaFiltro(f: string): number {
    if (f === 'todas') return this.TODAS.filter(id => this.sev(id) !== 'ok').length;
    if (f === 'criticas') return this.totalCritico;
    return this.TODAS.filter(id => this.sev(id) !== 'ok' && this.CATALOGO[id]?.grupo === f).length;
  }

  sevTexto(id: string): string {
    const s = this.sev(id);
    return s === 'critico' ? 'Crítica' : s === 'atencion' ? 'Atención' : s === 'informativo' ? 'Informativa' : 'En orden';
  }

  async exportarReorden(tipo: 'pdf' | 'excel') {
    if (!this.reorden.length) return;
    const cfg: ReportConfig = {
      titulo: 'Lista de reorden',
      subtitulo: `Productos que se acaban en ${this.diasAlerta} días o menos`,
      columns: [
        { header: 'Producto', key: 'nombre', width: 34 },
        { header: 'Stock', key: 'stock', width: 10, align: 'right' },
        { header: 'Vende/día', key: 'prom_diario', width: 12, align: 'right' },
        { header: 'Días restantes', key: 'dias_restantes', width: 14, align: 'right' },
        { header: 'Pedir', key: 'sugerido', width: 10, align: 'right' },
      ],
      rows: this.reorden,
      filename: 'reorden'
    };
    try {
      if (tipo === 'excel') await this.reports.exportExcel(cfg);
      else await this.reports.exportPdf(cfg);
    } catch (e: any) {
      await Swal.fire({ icon: 'error', title: 'Error al exportar', text: e?.message || 'No se pudo generar el archivo.' });
    }
  }
}
