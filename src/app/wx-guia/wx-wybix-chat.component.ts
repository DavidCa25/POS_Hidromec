import {
  AfterViewChecked, ChangeDetectionStrategy, Component, ElementRef, EventEmitter, OnInit, Output, ViewChild, inject, signal,
} from '@angular/core';
import { NgClass, NgFor, NgIf } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { WxMascotaComponent } from '../wx-mascota/wx-mascota.component';
import { AsistenteService, MensajeChat } from '../../core/asistente.service';
import { DictadoService } from '../../core/dictado.service';
import { VozRespuestaService } from '../../core/voz-respuesta.service';
import { WxGraficaChatComponent } from './wx-grafica-chat.component';
import { GuiaService } from './guia.service';

/**
 * EL CHAT DE WYBIX — sale de la mascota del dock.
 *
 * Se ve como conversación, pero lo que dice Wybix sale de plantillas con los
 * números reales del negocio (electron/asistente), y lo que se escribe pasa
 * por el intérprete: si falta un dato, Wybix lo pregunta con botones.
 *
 * Nada se guarda sin «Confirmar»: la tarjeta del plan enseña antes y después,
 * y la pantalla ejecuta con la API de siempre (permisos y PIN incluidos).
 * docs/arquitectura/asistente-operativo.md
 */
@Component({
  selector: 'wx-wybix-chat',
  standalone: true,
  imports: [NgIf, NgFor, NgClass, FormsModule, WxMascotaComponent, WxGraficaChatComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './wx-wybix-chat.component.html',
  styleUrls: ['./wx-wybix-chat.component.css'],
})
export class WxWybixChatComponent implements OnInit, AfterViewChecked {
  readonly asistente = inject(AsistenteService);
  readonly guia = inject(GuiaService);
  readonly dictado = inject(DictadoService);
  readonly voz = inject(VozRespuestaService);

  /** Lo que se quería oír antes de tener voz: se lee en cuanto se baja. */
  private porLeer = '';

  /** La bocina de un mensaje: lo lee (o calla si ya estaba leyendo). Sin voz, ofrece bajarla. */
  leer(m: MensajeChat) {
    if (this.voz.hablando()) { this.voz.callar(); return; }
    if (!this.voz.disponible()) { this.porLeer = m.texto; this.voz.ofrecer.set(true); return; }
    void this.voz.hablar(m.texto);
  }

  async bajarVoz() {
    await this.voz.descargar();
    if (this.voz.disponible() && this.porLeer) { void this.voz.hablar(this.porLeer); this.porLeer = ''; }
  }
  private readonly router = inject(Router);
  @Output() irA = new EventEmitter<string>();
  @ViewChild('lista') lista?: ElementRef<HTMLElement>;
  @ViewChild('campo') campo?: ElementRef<HTMLInputElement>;

  texto = '';
  private vistos = 0;

  /** Atajos de un toque cuando el campo está vacío. */
  readonly atajos = [
    { etiqueta: '¿Cómo voy hoy?', texto: '¿Cómo voy hoy?' },
    { etiqueta: '¿Cuánto hay en caja?', texto: '¿Cuánto hay en caja?' },
    { etiqueta: '¿Qué me falta comprar?', texto: '¿Qué me falta comprar?' },
    { etiqueta: '¿Quién me debe?', texto: '¿Quién me debe?' },
    { etiqueta: '¿Qué debo revisar?', texto: '¿Qué pendientes tengo?' },
  ];

  readonly escribiendo = signal(false);

  /* Sin robar el foco al abrir: quien abre con el teclado sigue donde estaba.
     Se enfoca el campo después de enviar o de tocar una opción. */
  ngOnInit() { void this.asistente.abrir(); void this.dictado.revisar(); }

  ngAfterViewChecked() {
    const n = this.asistente.mensajes().length;
    if (n !== this.vistos && this.lista) {
      this.vistos = n;
      const el = this.lista.nativeElement;
      el.scrollTop = el.scrollHeight;
      /* «Te llevo a…»: el último mensaje de Wybix trae a dónde ir. */
      const ultimo = this.asistente.mensajes()[n - 1];
      if (ultimo?.autor === 'wybix' && ultimo.ruta && Date.now() - Date.parse(ultimo.en) < 5000) {
        setTimeout(async () => {
          if (ultimo.carrito?.length) await this.asistente.cargarCarrito(ultimo.carrito);
          this.ir(ultimo.ruta!);
        }, 600);
      }
    }
  }

  enfocar() { setTimeout(() => this.campo?.nativeElement.focus(), 50); }

  async enviar() {
    const t = this.texto;
    this.texto = '';
    await this.asistente.enviar(t);
    this.enfocar();
  }

  alEscribir(v: string) { this.texto = v; this.asistente.entender(v); }

  /** Micrófono: un toque empieza, otro termina; lo dictado queda en el campo para revisarlo y enviarlo. */
  async microfono() {
    if (this.dictado.escuchando()) {
      const t = await this.dictado.detener();
      if (t) this.alEscribir(t);
      this.enfocar();
      return;
    }
    if (!this.dictado.disponible()) { this.dictado.ofrecer.set(true); return; }
    await this.dictado.escuchar();
  }

  async opcion(o: NonNullable<MensajeChat['opciones']>[number]) {
    if (o.intent === 'ir_a' && o.params?.['ruta']) { this.ir(String(o.params['ruta'])); return; }
    await this.asistente.accion(o);
    this.enfocar();
  }

  ir(ruta: string) {
    this.guia.cerrar();
    void this.router.navigateByUrl(ruta);
  }

  /** Últimos 6 mensajes de cada opción ya usada no se vuelven a ofrecer: solo los del último mensaje. */
  esUltimo(m: MensajeChat) {
    const ms = this.asistente.mensajes();
    return ms[ms.length - 1]?.id === m.id;
  }

  porId = (_: number, m: { id: string }) => m.id;
}
