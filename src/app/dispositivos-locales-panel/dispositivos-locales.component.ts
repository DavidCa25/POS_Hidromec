import { ChangeDetectionStrategy, Component, OnDestroy, OnInit, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import Swal from 'sweetalert2';

interface Direccion { nombre: string; ip: string; tipo: 'ethernet' | 'wifi' | 'otra'; url: string; }
interface Superficie { tipo: string; familia: 'ESTACION' | 'TRABAJADOR' | 'PUBLICA'; nombre: string; descripcion: string; icono: string; identidad: string; sonido: string | null; requiereEstacion: boolean; }
interface Dispositivo {
  id: string; nombre: string; superficie: string; superficieNombre: string; familia: string | null;
  estacion: string | null; stationId: number | null; todas: boolean; config: any;
  emparejadoEn: string; ultimoContacto: string | null; ultimaIp: string | null;
  revocado: boolean; enLinea: boolean; colaPendiente: number;
  sesion: { nombre: string; inicio: string; ultimaActividad: string; via: string } | null;
}
interface Estado {
  fase: 'APAGADO' | 'NO_PRINCIPAL' | 'SIN_TABLAS' | 'OTRO_HOST' | 'PUERTO_OCUPADO' | 'ACTIVO' | 'ERROR';
  activo: boolean; encendidoEnConfig: boolean; puerto: number;
  direcciones: Direccion[]; lan: boolean; internet: boolean | null;
  dueno: { nombre: string; direccion: string } | null; error: string | null;
  dispositivos: Dispositivo[]; estaciones: { id: number; nombre: string; salida: string }[];
  superficies: Superficie[]; areas: { id: number; nombre: string }[];
}
interface Persona {
  clave: string; userId: number | null; professionalId: number | null; nombre: string; usuario: string | null;
  rol: string | null; profesional: boolean; accesoId: number | null; qr: boolean; pin: boolean; revocado: boolean; bloqueado: boolean;
}
interface Qr { url: string; qr: string; expiraEn: string; nombre: string; funcion: string; }
interface Firewall { soportado: boolean; regla: boolean | null; redPublica?: boolean; nombreRegla?: string; error?: string; }
interface Nodo { d: Dispositivo; x: number; y: number; }

const ICONO: Record<string, string> = {
  PREPARATION: 'ph-cooking-pot', WAITER: 'ph-fork-knife', STAFF_DAY: 'ph-calendar-check',
  TECHNICIAN: 'ph-wrench', INVENTORY_FLOOR: 'ph-package', CUSTOMER_STATUS: 'ph-monitor-play',
};

/**
 * CONFIGURACION -> DISPOSITIVOS LOCALES.
 *
 * Diseño B aprobado: el mapa de la red del local. El router al centro, esta
 * computadora como Host, cada dispositivo colgando con su FUNCION (Cocina,
 * Mesero, Mi jornada...) y su estado; Internet aparte y punteado, porque no
 * forma parte del camino.
 *
 * Debajo: la lista de dispositivos (ver, cambiar funcion, renombrar,
 * revocar), las personas que pueden entrar a una pantalla (QR y PIN) y el
 * firewall.
 */
@Component({
  selector: 'app-dispositivos-locales-panel',
  standalone: true,
  imports: [CommonModule, FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrls: ['../panel-controls.css', './dispositivos-locales.component.css'],
  templateUrl: './dispositivos-locales.component.html',
})
export class DispositivosLocalesPanelComponent implements OnInit, OnDestroy {
  readonly estado = signal<Estado | null>(null);
  readonly cargando = signal(true);
  readonly error = signal<string | null>(null);
  readonly trabajando = signal(false);

  /* conectar un dispositivo */
  readonly conectando = signal(false);
  readonly funcion = signal<string | null>(null);
  nombre = '';
  estacion: number | 'todas' | null = null;
  areasElegidas = new Set<number>();
  publica = { mostrarMesa: false, sonido: false, minutosListo: 10 };
  readonly qr = signal<Qr | null>(null);
  readonly quedan = signal(0);

  /* ver / cambiar funcion */
  readonly visto = signal<Dispositivo | null>(null);
  readonly cambiando = signal<Dispositivo | null>(null);

  /* personas */
  readonly personas = signal<Persona[]>([]);
  readonly qrPersona = signal<{ nombre: string; qr: string; conDireccion: boolean } | null>(null);
  readonly pinPara = signal<Persona | null>(null);
  pinNuevo = '';

  readonly firewall = signal<Firewall | null>(null);
  readonly revisandoFirewall = signal(false);

  private reloj: any = null;
  private relojQr: any = null;

  private get api(): any { return (window as any).wybix?.localHost; }

  readonly icono = (tipo: string) => ICONO[tipo] || 'ph-device-tablet';
  readonly activos = computed(() => (this.estado()?.dispositivos || []).filter(d => !d.revocado));
  readonly revocados = computed(() => (this.estado()?.dispositivos || []).filter(d => d.revocado));
  readonly direccion = computed(() => this.estado()?.direcciones?.[0] ?? null);
  readonly superficieElegida = computed(() => (this.estado()?.superficies || []).find(s => s.tipo === this.funcion()) || null);

  /** Posiciones del mapa: los dispositivos en abanico a la derecha del router. */
  readonly nodos = computed<Nodo[]>(() => {
    const lista = this.activos().slice(0, 8);
    const n = lista.length;
    return lista.map((d, i) => {
      const t = n === 1 ? 0.5 : i / (n - 1);
      const y = 24 + t * 58;
      const x = 76 + Math.sin(t * Math.PI) * 5;
      return { d, x, y };
    });
  });
  readonly fuera = computed(() => Math.max(0, this.activos().length - 8));

  async ngOnInit() {
    await this.cargar();
    await this.cargarPersonas();
    this.reloj = setInterval(() => { if (!document.hidden) void this.cargar(true); }, 5000);
  }

  ngOnDestroy() {
    clearInterval(this.reloj);
    clearInterval(this.relojQr);
  }

  async cargar(silencioso = false) {
    if (!this.api) { this.error.set('Esta función está disponible en la aplicación de escritorio.'); this.cargando.set(false); return; }
    if (!silencioso) this.cargando.set(true);
    try {
      const r = await this.api.estado();
      if (!r?.success) { if (!silencioso) this.error.set(r?.error || 'No se pudo leer el estado.'); return; }
      this.error.set(null);
      this.estado.set(r.data);
      const v = this.visto();
      if (v) this.visto.set(r.data.dispositivos.find((d: Dispositivo) => d.id === v.id) || null);
    } finally {
      this.cargando.set(false);
    }
  }

  async cargarPersonas() {
    if (!this.api) return;
    const r = await this.api.trabajadores();
    if (r?.success) this.personas.set(r.data);
  }

  textoFase(e: Estado): string {
    switch (e.fase) {
      case 'ACTIVO': return 'Local Host';
      case 'APAGADO': return 'Apagado';
      case 'OTRO_HOST': return `Lo atiende ${e.dueno?.nombre || 'otra computadora'}`;
      case 'NO_PRINCIPAL': return 'No es la computadora principal';
      case 'SIN_TABLAS': return 'Falta actualizar la base';
      case 'PUERTO_OCUPADO': return `Puerto ${e.puerto} ocupado`;
      default: return e.error || 'No disponible';
    }
  }

  detalleDe(d: Dispositivo): string {
    if (d.sesion) return d.sesion.nombre;
    if (d.superficie === 'PREPARATION') return d.todas ? 'Todas las estaciones' : (d.estacion || '');
    if (d.familia === 'TRABAJADOR') return 'Nadie ha entrado';
    return '';
  }

  async alternar(activo: boolean) {
    this.trabajando.set(true);
    try {
      const r = await this.api.activar({ activo });
      if (!r?.success) await Swal.fire({ icon: 'error', title: 'No se pudo', text: r?.error });
      await this.cargar(true);
    } finally {
      this.trabajando.set(false);
    }
  }

  // --------------------------------------------------- conectar dispositivo
  abrirConectar() {
    this.qr.set(null);
    this.nombre = '';
    this.funcion.set(null);
    this.estacion = null;
    this.areasElegidas = new Set();
    this.publica = { mostrarMesa: false, sonido: false, minutosListo: 10 };
    this.conectando.set(true);
  }

  cerrarConectar() {
    clearInterval(this.relojQr);
    this.qr.set(null);
    this.conectando.set(false);
    void this.cargar(true);
  }

  alternarArea(id: number, on: boolean) {
    if (on) this.areasElegidas.add(id); else this.areasElegidas.delete(id);
  }

  private configPedida(tipo: string): any {
    if (tipo === 'WAITER' && this.areasElegidas.size) return { areas: [...this.areasElegidas] };
    if (tipo === 'CUSTOMER_STATUS') return { ...this.publica };
    return null;
  }

  async generar() {
    const s = this.superficieElegida();
    if (!s) { await Swal.fire({ icon: 'info', title: 'Elige la función', text: 'Qué va a hacer esta pantalla.' }); return; }
    const todas = this.estacion === 'todas';
    const est = (this.estado()?.estaciones || []).find(e => e.id === this.estacion);
    if (s.requiereEstacion && !todas && !est) { await Swal.fire({ icon: 'info', title: 'Elige la estación' }); return; }
    const nombre = this.nombre.trim() || (s.requiereEstacion ? `Tablet ${todas ? 'Cocina' : est!.nombre}` : `Pantalla · ${s.nombre}`);
    this.trabajando.set(true);
    try {
      const r = await this.api.emparejar({ superficie: s.tipo, stationId: s.requiereEstacion && !todas ? est!.id : null, todas, nombre, config: this.configPedida(s.tipo) });
      if (!r?.success) { await Swal.fire({ icon: 'error', title: 'No se pudo generar el código', text: r?.error }); return; }
      this.qr.set({ ...r.data, nombre, funcion: s.requiereEstacion ? `${s.nombre} · ${todas ? 'Todas' : est!.nombre}` : s.nombre });
      this.contar();
      await this.cargar(true);
    } finally {
      this.trabajando.set(false);
    }
  }

  private contar() {
    clearInterval(this.relojQr);
    const tic = () => {
      const q = this.qr();
      const s = q ? Math.max(0, Math.round((new Date(q.expiraEn).getTime() - Date.now()) / 1000)) : 0;
      this.quedan.set(s);
      if (!s) clearInterval(this.relojQr);
    };
    tic();
    this.relojQr = setInterval(tic, 1000);
  }

  get quedanTexto(): string {
    const s = this.quedan();
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }

  /** La direccion sin el token: el token es un secreto y solo va en el QR. */
  sinToken(url: string): string { return url.replace(/\/pair\/.*$/, '/pair/…'); }

  // --------------------------------------------------- un dispositivo
  ver(d: Dispositivo) { this.cambiando.set(null); this.visto.set(this.visto()?.id === d.id ? null : d); }

  abrirCambio(d: Dispositivo) {
    this.visto.set(null);
    this.funcion.set(d.superficie);
    this.estacion = d.todas ? 'todas' : d.stationId;
    this.areasElegidas = new Set(d.config?.areas || []);
    this.publica = { mostrarMesa: !!d.config?.mostrarMesa, sonido: !!d.config?.sonido, minutosListo: d.config?.minutosListo || 10 };
    this.cambiando.set(d);
  }

  async confirmarCambio() {
    const d = this.cambiando();
    const s = this.superficieElegida();
    if (!d || !s) return;
    const todas = this.estacion === 'todas';
    const r = await this.api.cambiarFuncion({ id: d.id, superficie: s.tipo, stationId: s.requiereEstacion && !todas ? this.estacion : null, todas, config: this.configPedida(s.tipo) });
    if (!r?.success) { await Swal.fire({ icon: 'error', title: 'No se pudo cambiar', text: r?.error }); return; }
    this.cambiando.set(null);
    await this.cargar(true);
  }

  async renombrar(d: Dispositivo) {
    const r = await Swal.fire({ title: 'Renombrar', input: 'text', inputValue: d.nombre, inputAttributes: { maxlength: '80' },
      showCancelButton: true, confirmButtonText: 'Guardar', cancelButtonText: 'Cancelar' });
    if (!r.isConfirmed || !String(r.value || '').trim()) return;
    const x = await this.api.renombrar({ id: d.id, nombre: String(r.value).trim() });
    if (!x?.success) await Swal.fire({ icon: 'error', title: 'No se pudo', text: x?.error });
    await this.cargar(true);
  }

  async revocar(d: Dispositivo) {
    const c = await Swal.fire({
      icon: 'question', title: `Desconectar «${d.nombre}»`,
      text: 'Deja de funcionar al momento. Para volver a usarlo, se conecta con un código nuevo.',
      showCancelButton: true, confirmButtonText: 'Desconectar', cancelButtonText: 'Cancelar',
    });
    if (!c.isConfirmed) return;
    const r = await this.api.revocar({ id: d.id });
    if (!r?.success) await Swal.fire({ icon: 'error', title: 'No se pudo', text: r?.error });
    this.visto.set(null);
    await this.cargar(true);
  }

  hace(iso: string | null): string {
    if (!iso) return 'nunca';
    const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
    if (s < 60) return 'ahora';
    if (s < 3600) return `hace ${Math.round(s / 60)} min`;
    if (s < 86400) return `hace ${Math.round(s / 3600)} h`;
    return new Date(iso).toLocaleDateString('es-MX', { day: 'numeric', month: 'short' });
  }

  hora(iso: string | null): string {
    return iso ? new Date(iso).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' }) : '—';
  }

  // ------------------------------------------------------------ personas
  async generarQrPersona(p: Persona) {
    if (p.qr) {
      const c = await Swal.fire({ icon: 'question', title: `QR nuevo para ${p.nombre}`, text: 'El QR anterior dejará de funcionar y se cerrarán sus sesiones abiertas.',
        showCancelButton: true, confirmButtonText: 'Generar otro', cancelButtonText: 'Cancelar' });
      if (!c.isConfirmed) return;
    }
    const r = await this.api.qrTrabajador({ userId: p.userId, professionalId: p.userId ? null : p.professionalId });
    if (!r?.success) { await Swal.fire({ icon: 'error', title: 'No se pudo', text: r?.error }); return; }
    this.qrPersona.set({ nombre: p.nombre, qr: r.data.qr, conDireccion: r.data.conDireccion });
    await this.cargarPersonas();
  }

  abrirPin(p: Persona) { this.pinNuevo = ''; this.pinPara.set(p); }

  async guardarPin() {
    const p = this.pinPara();
    if (!p) return;
    const r = await this.api.pinTrabajador({ userId: p.userId, professionalId: p.userId ? null : p.professionalId, pin: this.pinNuevo });
    if (!r?.success) { await Swal.fire({ icon: 'error', title: 'PIN no válido', text: r?.error }); return; }
    this.pinPara.set(null);
    this.pinNuevo = '';
    await this.cargarPersonas();
  }

  async revocarPersona(p: Persona) {
    if (!p.accesoId) return;
    const c = await Swal.fire({ icon: 'question', title: `Quitar acceso a ${p.nombre}`, text: 'Su QR y su PIN dejan de funcionar y sale de cualquier pantalla al momento.',
      showCancelButton: true, confirmButtonText: 'Quitar acceso', cancelButtonText: 'Cancelar' });
    if (!c.isConfirmed) return;
    await this.api.revocarTrabajador({ accesoId: p.accesoId });
    await this.cargarPersonas();
  }

  // ------------------------------------------------------------ firewall
  async revisarFirewall() {
    this.revisandoFirewall.set(true);
    try {
      const r = await this.api.firewall();
      this.firewall.set(r?.success ? r.data : { soportado: true, regla: null, error: r?.error });
    } finally {
      this.revisandoFirewall.set(false);
    }
  }

  /** Nunca en silencio: se explica que se hara y Windows vuelve a preguntar. */
  async abrirFirewall() {
    const e = this.estado();
    const c = await Swal.fire({
      icon: 'question', title: 'Permitir las pantallas en el firewall',
      html: `Wybix creará <b>una</b> regla de entrada en el Firewall de Windows:<br>
             TCP ${e?.puerto}, solo desde la red local, solo en redes Privadas o de Dominio.<br><br>
             No abre SQL Server, no desactiva el firewall y no abre nada a Internet.
             Windows te pedirá permiso de administrador.`,
      showCancelButton: true, confirmButtonText: 'Crear la regla', cancelButtonText: 'Cancelar',
    });
    if (!c.isConfirmed) return;
    this.revisandoFirewall.set(true);
    try {
      const r = await this.api.abrirFirewall();
      if (!r?.success) { await Swal.fire({ icon: 'error', title: 'No se creó la regla', text: r?.error }); return; }
      this.firewall.set(r.data);
    } finally {
      this.revisandoFirewall.set(false);
    }
  }

  readonly porId = (_: number, d: { id: string }) => d.id;
  readonly porNodo = (_: number, n: Nodo) => n.d.id;
  readonly porClave = (_: number, p: Persona) => p.clave;
}
