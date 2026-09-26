import { Injectable, computed, inject, signal } from '@angular/core';
import { AuthService } from '../../services/auth.service';

/**
 * LO QUE CADA PERSONA YA VIO.
 *
 * Por PERSONA, no por negocio: que el administrador termine el recorrido no
 * puede hacerlo desaparecer para la cajera que entra mañana. Vive donde viven
 * las demas preferencias de interfaz (el modo de navegacion, las columnas de
 * cada tabla): en el almacenamiento local de esta caja, con el id de quien
 * entro en la clave. El id y no el nombre: el nombre se corrige.
 *
 * Y una sola llave de EQUIPO: `wx-guide:auto = 0` apaga el ofrecimiento
 * automatico en esta maquina (una caja compartida, un equipo de pruebas). El
 * recorrido manual sigue ahi.
 *
 * Si el almacenamiento falla, Wybix sigue funcionando: la guia vuelve a
 * ofrecerse, que es el lado inofensivo del error.
 */
export interface Progreso {
  /** Recorrido -> cuando se termino. */
  completados: Record<string, string>;
  /** «Mostrar guía al iniciar». */
  mostrarAlIniciar: boolean;
  /** Recorridos que no se vuelven a ofrecer solos. */
  sinAuto: Record<string, true>;
  /** Lo que se contesto la primera vez. */
  primerUso: 'aceptado' | 'pospuesto' | 'nunca' | null;
  /** Donde se quedo, por si se interrumpio. */
  ultimo: { id: string; paso: number } | null;
}

const VACIO: Progreso = { completados: {}, mostrarAlIniciar: true, sinAuto: {}, primerUso: null, ultimo: null };

/* Ids que cambiaron de nombre: quien ya termino el recorrido inicial con el
   id anterior lo sigue teniendo hecho. */
const RENOMBRADOS: Record<string, string> = { 'core.primer_uso': 'core.first_run' };
function renombrar(c: Record<string, string>): Record<string, string> {
  const r: Record<string, string> = {};
  for (const [k, v] of Object.entries(c)) r[RENOMBRADOS[k] ?? k] = v;
  return r;
}
const LLAVE_EQUIPO = 'wx-guide:auto';
const LLAVE_SESION = 'wx-guide:pospuesto';

@Injectable({ providedIn: 'root' })
export class GuiaProgresoService {
  private readonly auth = inject(AuthService);
  private readonly escrituras = signal(0);

  readonly progreso = computed<Progreso>(() => {
    this.escrituras();
    const id = this.auth.acceso()?.userId;
    if (id == null) return VACIO;
    try {
      const p = JSON.parse(localStorage.getItem(this.llave(id)) || 'null');
      return {
        completados: renombrar(p?.completados && typeof p.completados === 'object' ? p.completados : {}),
        mostrarAlIniciar: p?.mostrarAlIniciar !== false,
        sinAuto: p?.sinAuto && typeof p.sinAuto === 'object' ? p.sinAuto : {},
        primerUso: ['aceptado', 'pospuesto', 'nunca'].includes(p?.primerUso) ? p.primerUso : null,
        ultimo: p?.ultimo && typeof p.ultimo.id === 'string' ? p.ultimo : null,
      };
    } catch {
      return VACIO;
    }
  });

  hecho(id: string): boolean { return !!this.progreso().completados[id]; }

  /**
   * ¿Se ofrece el recorrido inicial al entrar?
   * Nunca si la persona dijo que no, si ya lo termino y pidio no verlo, si
   * este equipo tiene la guia automatica apagada, o si ya se pospuso en esta
   * sesion (se vuelve a ofrecer en la siguiente).
   */
  debeOfrecer(id: string): boolean {
    if (this.auth.acceso()?.userId == null) return false;
    const p = this.progreso();
    if (!p.mostrarAlIniciar || p.primerUso === 'nunca' || p.sinAuto[id]) return false;
    if (p.completados[id]) return false;
    try {
      if (localStorage.getItem(LLAVE_EQUIPO) === '0') return false;
      if (sessionStorage.getItem(LLAVE_SESION) === String(this.auth.acceso()?.userId)) return false;
    } catch { /* sin almacenamiento: se ofrece */ }
    return true;
  }

  completar(id: string, sinAuto = false) {
    this.editar(p => ({
      ...p,
      completados: { ...p.completados, [id]: new Date().toISOString() },
      sinAuto: sinAuto ? { ...p.sinAuto, [id]: true } : p.sinAuto,
      ultimo: p.ultimo?.id === id ? null : p.ultimo,
    }));
  }

  recordar(id: string, paso: number) { this.editar(p => ({ ...p, ultimo: { id, paso } })); }

  fijarMostrarAlIniciar(v: boolean) { this.editar(p => ({ ...p, mostrarAlIniciar: v })); }

  decidirPrimerUso(v: 'aceptado' | 'pospuesto' | 'nunca') {
    this.editar(p => ({ ...p, primerUso: v, mostrarAlIniciar: v === 'nunca' ? false : p.mostrarAlIniciar }));
    if (v === 'pospuesto') {
      try { sessionStorage.setItem(LLAVE_SESION, String(this.auth.acceso()?.userId)); } catch { /* noop */ }
    }
  }

  /** «Reiniciar recorridos»: todo como el primer dia, salvo la preferencia de inicio. */
  reiniciar() {
    this.editar(p => ({ ...VACIO, mostrarAlIniciar: true, primerUso: p.primerUso === 'nunca' ? null : p.primerUso }));
  }

  private llave(id: number): string { return `wx-guide:${id}`; }

  private editar(f: (p: Progreso) => Progreso) {
    const id = this.auth.acceso()?.userId;
    if (id == null) return;
    try { localStorage.setItem(this.llave(id), JSON.stringify(f(this.progreso()))); } catch { /* sin almacenamiento */ }
    this.escrituras.update(n => n + 1);
  }
}
