import { Injectable, Injector, inject } from '@angular/core';
import type { GuiaRunnerService } from './guia-runner.service';

/**
 * LA PUERTA DE WYBIX GUIDE.
 *
 * El tablero vive en el dock, que va en la carga inicial de la aplicacion. El
 * motor de recorridos -escenarios, Driver, la voz- no: se descarga la primera
 * vez que alguien abre el tablero o cuando el presentador se monta (en reposo,
 * despues del arranque). Esta puerta es lo unico que el dock conoce.
 */
@Injectable({ providedIn: 'root' })
export class GuiaPuertaService {
  private readonly injector = inject(Injector);
  private cargado: Promise<GuiaRunnerService> | null = null;

  runner(): Promise<GuiaRunnerService> {
    this.cargado ??= import('./guia-runner.service').then(m => this.injector.get(m.GuiaRunnerService));
    return this.cargado;
  }
}
