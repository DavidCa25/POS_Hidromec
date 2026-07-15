import { Component, OnInit } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { CommonModule } from '@angular/common';
import { LicenseService } from '../services/license.service';
import { SetupInicial } from './setup-inicial/setup-inicial.component';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, CommonModule, SetupInicial],
  templateUrl: './app.html',
  styleUrls: ['./app.css']
})
export class App implements OnInit {
  listo = false;
  necesitaSetup = false;

  constructor(public license: LicenseService) {}

  async ngOnInit() {
    await this.license.iniciar();

    const st = await (window as any).electronAPI?.setupStatus?.();
    this.necesitaSetup = !st?.configurado;

    this.listo = true;
  }

  onSetupCompletado() {
    this.necesitaSetup = false;
  }
}