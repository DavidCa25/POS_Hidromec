import { Component, OnInit } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { CommonModule } from '@angular/common';
import { LicenseService } from '../services/license.service';
import { SetupInicial } from './setup-inicial/setup-inicial.component';
import { IniciarPruebaComponent } from './licencia/iniciar-prueba.component';
import { LicenciaVencidaComponent } from './licencia/licencia-vencida.component';
import { TrialBannerComponent } from './licencia/trial-banner.component';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, CommonModule, SetupInicial, IniciarPruebaComponent, LicenciaVencidaComponent, TrialBannerComponent],
  templateUrl: './app.html',
  styleUrls: ['./app.css']
})
export class App implements OnInit {
  listo = false;
  necesitaSetup = false;

  constructor(public license: LicenseService) {}

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

  onSetupCompletado() {
    this.necesitaSetup = false;
  }
}
