import { Component, OnInit } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { CapabilityService } from '../core';
import { LicenseService } from '../services/license.service';
import { SetupInicial } from './setup-inicial/setup-inicial.component';
import { IniciarPruebaComponent } from './licencia/iniciar-prueba.component';
import { LicenciaVencidaComponent } from './licencia/licencia-vencida.component';
import { TrialBannerComponent } from './licencia/trial-banner.component';

@Component({
  selector: 'app-root',
  standalone: true,
  // Los cuatro componentes solo se usan dentro de bloques @defer en la
  // plantilla: el compilador los saca del bundle inicial.
  imports: [RouterOutlet, SetupInicial, IniciarPruebaComponent, LicenciaVencidaComponent, TrialBannerComponent],
  templateUrl: './app.html',
  styleUrls: ['./app.css']
})
export class App implements OnInit {
  listo = false;
  necesitaSetup = false;

  constructor(public license: LicenseService, private caps: CapabilityService) {}

  async ngOnInit() {
    await this.license.iniciar();
    await this.refrescarSetup();
    this.listo = true;

    // Re-valida la prueba contra la nube en segundo plano (corrige ediciones locales).
    this.license.revalidarPrueba();
  }

  // Tras iniciar la prueba o activar una licencia: recargar estado y setup.
  async onLicenciaLista() {
    await this.license.cargarEstado();
    await this.refrescarSetup();
  }

  private async refrescarSetup() {
    const st = await (window as any).electronAPI?.setupStatus?.();
    this.necesitaSetup = !st?.configurado;
  }

  /**
   * Salida del asistente hacia la aplicacion.
   *
   * Es la transicion de "sin configurar" a "configurado", asi que es aqui
   * donde las capacidades tienen que quedar al dia: el menu, las rutas y los
   * guards que se montan a continuacion leen de ellas. Antes solo se ocultaba
   * el asistente, y Hospitality no aparecia hasta el siguiente arranque.
   */
  async onSetupCompletado() {
    await this.caps.load(true);
    this.necesitaSetup = false;
  }
}
