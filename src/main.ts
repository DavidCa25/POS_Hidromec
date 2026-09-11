import { bootstrapApplication } from '@angular/platform-browser';
import { registerLocaleData } from '@angular/common';
import localeEsMX from '@angular/common/locales/es-MX';
import { appConfig } from './app/app.config';
import { App } from './app/app';

/*
 * El locale es-MX se registra aqui, una sola vez, ANTES de arrancar.
 *
 * Antes lo registraban Compras y Registrar compra como efecto secundario de su
 * import; con todas las rutas en el bundle inicial eso ocurria siempre. Con
 * lazy loading (ADR-001) ya no: el POS usaba `date:'longDate':undefined:'es-MX'`
 * y fallaba con NG0701 si Compras no se habia abierto antes.
 */
registerLocaleData(localeEsMX, 'es-MX');

bootstrapApplication(App, appConfig)
  .catch((err) => console.error(err));
