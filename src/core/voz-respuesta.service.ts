import { Injectable, NgZone, inject, signal } from '@angular/core';

/*
 * WYBIX HABLA: lee en voz alta lo que contesta.
 *
 * Dos motores, en este orden:
 *   piper  la voz de Wybix (es_MX), sin internet, en la caja. No viaja en el
 *          instalador: se baja una vez (~85 MB) desde el chat
 *          (asistente:habla-descargar, electron/asistente/voz-piper.js).
 *   sapi   si Piper no está, una voz de Windows en ESPAÑOL (speechSynthesis),
 *          si la caja la tiene. Leer español con voz en inglés no se intenta.
 *
 * `disponible`: hay con qué hablar ya. `descargable`: se puede bajar Piper
 * (se ofrece en el chat al tocar la bocina). Se lee solo lo que la persona
 * pidió («léeme las respuestas») o lo que toca con la bocina; un mensaje
 * nuevo corta al anterior.
 */
@Injectable({ providedIn: 'root' })
export class VozRespuestaService {
  private readonly zona = inject(NgZone);
  readonly disponible = signal(false);
  readonly descargable = signal(false);
  readonly hablando = signal(false);
  readonly motor = signal<'piper' | 'sapi' | null>(null);
  /* La oferta de bajar la voz (el chat la pinta, igual que la del dictado). */
  readonly ofrecer = signal(false);
  readonly descargando = signal(false);
  readonly avance = signal(0);
  readonly error = signal('');
  readonly mb = signal(85);

  private vozSapi: SpeechSynthesisVoice | null = null;
  private audio: HTMLAudioElement | null = null;
  private url: string | null = null;
  private revisado = false;

  private get api() { return (window as any).electronAPI; }

  constructor() {
    const s = this.sintesis;
    if (s) {
      const elegir = () => {
        const voces = s.getVoices().filter((v) => /^es(-|_|$)/i.test(v.lang));
        this.vozSapi = voces.find((v) => /es-MX/i.test(v.lang)) || voces.find((v) => /es-(US|419|CO|AR|CL|PE)/i.test(v.lang)) || voces[0] || null;
        this.actualizar();
      };
      elegir();
      try { s.addEventListener?.('voiceschanged', elegir); } catch { /* noop */ }
    }
    void this.revisar();
  }

  /** ¿Está Piper en esta caja? Una vez por sesión (y después de bajarlo). */
  async revisar(forzar = false) {
    if (this.revisado && !forzar) return;
    this.revisado = true;
    try {
      const r = await this.api?.asistenteHabla?.({ estado: true });
      const piper = !!r?.success && !!r.data?.instalada;
      if (r?.data?.mb) this.mb.set(r.data.mb);
      this.motor.set(piper ? 'piper' : this.vozSapi ? 'sapi' : null);
      this.descargable.set(!!r?.success && !piper);
    } catch { this.descargable.set(false); }
    this.actualizar();
  }

  private actualizar() {
    if (this.motor() !== 'piper') this.motor.set(this.vozSapi ? 'sapi' : null);
    this.disponible.set(!!this.motor());
  }

  private get sintesis(): SpeechSynthesis | null {
    try { return typeof window !== 'undefined' && 'speechSynthesis' in window ? window.speechSynthesis : null; } catch { return null; }
  }

  /** Pesos, signos y comillas como se leen en voz alta. */
  static dicho(texto: string) {
    return String(texto)
      .replace(/\$\s?([\d,]+(?:\.\d{1,2})?)/g, (_m, n) => `${n} pesos`)
      .replace(/([+−-])\s?(\d+)%/g, (_m, sg, n) => `${sg === '+' ? 'más' : 'menos'} ${n} por ciento`)
      .replace(/%/g, ' por ciento')
      .replace(/[«»]/g, '');
  }

  /** Lee un texto (corta lo que estuviera leyendo). */
  async hablar(texto: string) {
    if (!texto) return;
    this.callar();
    const dicho = VozRespuestaService.dicho(texto);
    if (this.motor() === 'piper') {
      try {
        this.hablando.set(true);
        const r = await this.api?.asistenteHabla?.({ texto: dicho });
        if (!r?.success || !r.data?.wav) throw new Error(r?.error || 'sin audio');
        this.url = URL.createObjectURL(new Blob([r.data.wav], { type: 'audio/wav' }));
        this.audio = new Audio(this.url);
        this.audio.onended = () => this.zona.run(() => this.callar());
        this.audio.onerror = () => this.zona.run(() => this.callar());
        await this.audio.play();
        return;
      } catch {
        this.hablando.set(false);
        if (!this.vozSapi) return;
      }
    }
    const s = this.sintesis;
    if (!s || !this.vozSapi) return;
    const u = new SpeechSynthesisUtterance(dicho);
    u.voice = this.vozSapi;
    u.lang = this.vozSapi.lang;
    u.rate = 1.02;
    u.onend = () => this.zona.run(() => this.hablando.set(false));
    u.onerror = () => this.zona.run(() => this.hablando.set(false));
    this.hablando.set(true);
    s.speak(u);
  }

  callar() {
    try { this.sintesis?.cancel(); } catch { /* noop */ }
    if (this.audio) { try { this.audio.pause(); } catch { /* noop */ } this.audio = null; }
    if (this.url) { URL.revokeObjectURL(this.url); this.url = null; }
    this.hablando.set(false);
  }

  /** Baja Piper y la voz (~85 MB) una sola vez. */
  async descargar() {
    if (this.descargando()) return;
    this.descargando.set(true);
    this.error.set('');
    this.avance.set(0);
    const soltar = this.api?.onAsistenteHablaAvance?.((d: { pct: number }) =>
      this.zona.run(() => this.avance.set(Math.max(0, Math.min(100, Number(d?.pct) || 0)))));
    try {
      const r = await this.api?.asistenteHablaDescargar?.();
      if (!r?.success) throw new Error(r?.error || 'No se pudo bajar la voz.');
      await this.revisar(true);
      if (this.motor() === 'piper') this.ofrecer.set(false);
    } catch (e: any) {
      this.error.set(e?.message || 'No se pudo bajar la voz.');
    } finally {
      try { soltar?.(); } catch { /* noop */ }
      this.descargando.set(false);
    }
  }
}
