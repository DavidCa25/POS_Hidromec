import { ChangeDetectionStrategy, Component, HostListener } from '@angular/core';
import { NgClass, NgFor, NgIf } from '@angular/common';
import { Router } from '@angular/router';
import { WxMascotaComponent } from '../wx-mascota/wx-mascota.component';
import { GuiaService, AvisoGuia } from './guia.service';

/**
 * WX-GUIA — el panel que sale de Wybix Mini.
 *
 * Emerge del propio personaje, en la esquina del dock, y no es un modal
 * centrado: un modal centrado corta el trabajo y obliga a volver. Esto se
 * asoma al lado de donde se pulsó y se va igual de rápido.
 *
 * NO REPITE LO QUE YA DICE LA PANTALLA. En Inicio la frase del saludo y este
 * panel dicen lo mismo con las mismas palabras porque salen del MISMO sitio;
 * lo que el panel añade es el desglose y el camino para resolverlo, que la
 * frase no tiene.
 */
@Component({
  selector: 'wx-guia',
  standalone: true,
  imports: [NgIf, NgFor, NgClass, WxMascotaComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './wx-guia.component.html',
  styleUrls: ['./wx-guia.component.css'],
})
export class WxGuiaComponent {
  constructor(public guia: GuiaService, private router: Router) {}

  ir(ruta?: string) {
    if (!ruta) return;
    this.guia.cerrar();
    void this.router.navigateByUrl(ruta);
  }

  porAviso = (_: number, a: AvisoGuia) => a.area + a.texto;

  @HostListener('document:keydown.escape')
  alEscapar() { if (this.guia.abierta()) this.guia.cerrar(); }

  @HostListener('document:click', ['$event'])
  alPulsarFuera(e: Event) {
    if (!this.guia.abierta()) return;
    /* El propio botón de Wybix -en el dock o en la barra lateral- no cuenta
       como "fuera": si contara, pulsarlo cerraría y volvería a abrir en el
       mismo gesto. */
    const dentro = (e.target as HTMLElement)?.closest?.('.wxg, .wxdock__pulso, .wxside__pulso');
    if (!dentro) this.guia.cerrar();
  }
}
