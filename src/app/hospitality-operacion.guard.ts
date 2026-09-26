import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { CapabilityService } from '../core';
import { AuthService, PAQUETES } from '../services/auth.service';

/*
 * Las tres puertas de la operacion de Hospitality.
 *
 * Cada una pregunta dos cosas, igual que el guard de Servicios: si el MODULO
 * esta encendido en el negocio y si la PERSONA tiene el paquete. El proceso
 * principal vuelve a preguntar lo mismo en cada canal; esto solo evita
 * ensenar una pantalla que despues no podria hacer nada.
 */

async function comprobar(modulo: 'mesas' | 'comandas' | 'salon', paquete: string) {
  const caps = inject(CapabilityService);
  const auth = inject(AuthService);
  const router = inject(Router);
  await caps.load();

  const encendido = modulo === 'salon' ? (caps.mesas || caps.comandas) : caps[modulo];
  if (!encendido) return router.createUrlTree(['/dashboard/aplicaciones']);
  if (!auth.puede(paquete)) return router.createUrlTree(['/dashboard/inicio']);
  return true;
}

export const puedeUsarMesas: CanActivateFn = () => comprobar('mesas', PAQUETES.VENTAS_OPERAR);
export const puedeUsarCocina: CanActivateFn = () => comprobar('comandas', PAQUETES.VENTAS_OPERAR);
export const puedeConfigurarSalon: CanActivateFn = () => comprobar('salon', PAQUETES.CONFIGURACION_ADMINISTRAR);
