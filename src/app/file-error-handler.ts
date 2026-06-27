import { ErrorHandler, Injectable } from '@angular/core';

/**
 * Captura los errores no manejados de Angular y los reenvía al proceso
 * principal para que queden en el archivo de logs (junto con los del backend).
 */
@Injectable()
export class FileErrorHandler implements ErrorHandler {
  handleError(error: any): void {
    try {
      const message = error?.message || String(error);
      const stack = error?.stack || '';
      (window as any).electronAPI?.logToFile?.('error', `[Angular] ${message}`, { stack });
    } catch { /* noop */ }

    // Mantiene también el error en la consola de DevTools
    console.error(error);
  }
}