import { Injectable, NgZone, inject, signal } from '@angular/core';

/*
 * DICTADO SIN INTERNET para el chat de Wybix.
 *
 * El reconocimiento corre en la caja con Vosk (WebAssembly): la voz no sale
 * del equipo. El motor (vosk-browser) y el modelo de español los entrega el
 * proceso principal por `asistente:voz`. Sin el motor, el micrófono no se
 * muestra; sin el modelo, el micrófono ofrece bajarlo una sola vez
 * (`asistente:voz-descargar`, con su avance) y después funciona sin internet.
 *
 * Se carga la primera vez que se toca el micrófono, no al abrir el chat: el
 * modelo pesa ~40 MB.
 */

interface Reconocedor {
  on(evento: 'result' | 'partialresult', fn: (m: { result: { text?: string; partial?: string } }) => void): void;
  acceptWaveform(b: AudioBuffer): void;
  retrieveFinalResult(): void;
  remove(): void;
}
interface ModeloVosk { KaldiRecognizer: new (sampleRate: number) => Reconocedor; terminate(): void }

@Injectable({ providedIn: 'root' })
export class DictadoService {
  private readonly zona = inject(NgZone);
  private get api() { return (window as any).electronAPI; }

  /** Motor y modelo: se puede dictar ya. */
  readonly disponible = signal(false);
  /** El motor viene con la app; sin él no hay micrófono. */
  readonly hayMotor = signal(false);
  /** Falta el modelo y alguien tocó el micrófono: se ofrece bajarlo. */
  readonly ofrecer = signal(false);
  readonly descargando = signal(false);
  readonly avance = signal(0);
  readonly etapa = signal<'bajando' | 'preparando' | 'listo'>('bajando');
  readonly error = signal('');
  readonly cargando = signal(false);
  readonly escuchando = signal(false);
  /** Lo que va oyendo, antes de cerrar la frase. */
  readonly parcial = signal('');

  private modelo: ModeloVosk | null = null;
  private audio: AudioContext | null = null;
  private flujo: MediaStream | null = null;
  private nodo: ScriptProcessorNode | null = null;
  private rec: Reconocedor | null = null;
  private texto = '';
  private revisado = false;

  /** ¿Esta caja tiene el motor y el modelo? Una vez por sesión. */
  async revisar() {
    if (this.revisado) return;
    this.revisado = true;
    try {
      const r = await this.api?.asistenteVoz?.({});
      this.disponible.set(!!r?.success && !!r.data?.disponible);
      this.hayMotor.set(!!r?.success && !r.data?.faltaMotor);
    } catch { this.disponible.set(false); this.hayMotor.set(false); }
  }

  /** Baja el modelo de español (~40 MB) una sola vez. */
  async descargar() {
    if (this.descargando()) return;
    this.descargando.set(true);
    this.error.set('');
    this.avance.set(0);
    this.etapa.set('bajando');
    const soltar = this.api?.onAsistenteVozAvance?.((d: { pct: number; etapa: 'bajando' | 'preparando' | 'listo' }) =>
      this.zona.run(() => { this.avance.set(Math.max(0, Math.min(100, Number(d?.pct) || 0))); if (d?.etapa) this.etapa.set(d.etapa); }));
    try {
      const r = await this.api?.asistenteVozDescargar?.();
      if (!r?.success) throw new Error(r?.error || 'No se pudo bajar la voz.');
      this.disponible.set(!!r.data?.disponible);
      if (this.disponible()) this.ofrecer.set(false);
    } catch (e: any) {
      this.error.set(e?.message || 'No se pudo bajar la voz.');
    } finally {
      try { soltar?.(); } catch { /* noop */ }
      this.descargando.set(false);
    }
  }

  private async cargar(): Promise<ModeloVosk> {
    if (this.modelo) return this.modelo;
    this.cargando.set(true);
    try {
      const r = await this.api?.asistenteVoz?.({ cargar: true });
      if (!r?.success || !r.data?.disponible) throw new Error('No hay modelo de voz en esta caja.');
      const w = window as any;
      if (!w.Vosk) {
        const url = URL.createObjectURL(new Blob([r.data.motor], { type: 'text/javascript' }));
        await new Promise<void>((ok, mal) => {
          const s = document.createElement('script');
          s.src = url; s.onload = () => ok(); s.onerror = () => mal(new Error('No se pudo cargar el motor de voz.'));
          document.head.appendChild(s);
        });
      }
      const urlModelo = URL.createObjectURL(new Blob([r.data.modelo], { type: 'application/gzip' }));
      this.modelo = await w.Vosk.createModel(urlModelo) as ModeloVosk;
      return this.modelo;
    } finally { this.cargando.set(false); }
  }

  async escuchar() {
    if (this.escuchando()) return;
    const modelo = await this.cargar();
    this.texto = '';
    this.parcial.set('');
    this.flujo = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 } });
    this.audio = new AudioContext();
    this.rec = new modelo.KaldiRecognizer(this.audio.sampleRate);
    this.rec.on('result', (m) => this.zona.run(() => { const t = (m.result.text || '').trim(); if (t) this.texto = `${this.texto} ${t}`.trim(); this.parcial.set(''); }));
    this.rec.on('partialresult', (m) => this.zona.run(() => this.parcial.set(m.result.partial || '')));
    const fuente = this.audio.createMediaStreamSource(this.flujo);
    /* ScriptProcessor: el ejemplo oficial de vosk-browser; un AudioWorklet
       pediría servir otro archivo y aquí no hace falta. */
    this.nodo = this.audio.createScriptProcessor(4096, 1, 1);
    this.nodo.onaudioprocess = (e) => { try { this.rec?.acceptWaveform(e.inputBuffer); } catch { /* un cuadro perdido no importa */ } };
    fuente.connect(this.nodo);
    this.nodo.connect(this.audio.destination);
    this.escuchando.set(true);
  }

  /** Termina y devuelve lo dictado (con lo último que estaba oyendo). */
  async detener(): Promise<string> {
    if (!this.escuchando()) return '';
    try { this.rec?.retrieveFinalResult(); } catch { /* noop */ }
    await new Promise((ok) => setTimeout(ok, 300));
    const final = `${this.texto} ${this.parcial()}`.replace(/\s+/g, ' ').trim();
    this.nodo?.disconnect();
    this.flujo?.getTracks().forEach((t) => t.stop());
    try { await this.audio?.close(); } catch { /* noop */ }
    try { this.rec?.remove(); } catch { /* noop */ }
    this.nodo = null; this.flujo = null; this.audio = null; this.rec = null;
    this.escuchando.set(false);
    this.parcial.set('');
    return final;
  }
}
