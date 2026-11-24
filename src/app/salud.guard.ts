import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { CapabilityService, GiroSaludService } from '../core';
import { AuthService, PAQUETES } from '../services/auth.service';

/**
 * ¿ESTA CAJA ENTRA A SALUD?
 *
 * Mismas dos preguntas que Servicios, en cada navegación: el módulo
 * encendido (Aplicaciones) y que la persona tenga algo que hacer ahí. La
 * farmacia la ve quien vende; el expediente, solo quien tiene
 * SALUD_EXPEDIENTE. Cada pestaña filtra lo suyo y el proceso principal lo
 * vuelve a comprobar en cada canal.
 *
 * El giro se carga ANTES de resolver la pestaña de entrada: la redirección
 * de la ruta vacía es síncrona y pregunta por él.
 */
export const puedeVerSalud: CanActivateFn = async () => {
  const caps = inject(CapabilityService);
  const giro = inject(GiroSaludService);
  const auth = inject(AuthService);
  const router = inject(Router);

  await caps.load();
  if (!caps.salud) return router.createUrlTree(['/dashboard/aplicaciones']);

  await giro.cargar();
  const farmacia = giro.farmacia() && auth.puede(PAQUETES.VENTAS_OPERAR);
  const clinica = (giro.clinica() || giro.estudios()) && auth.puede(PAQUETES.SALUD_EXPEDIENTE);
  if (!farmacia && !clinica) return router.createUrlTree(['/dashboard/inicio']);
  return true;
};

/** La pestaña de entrada, según el giro y lo que la persona puede ver. */
export function inicioSalud(): string {
  const giro = inject(GiroSaludService);
  const auth = inject(AuthService);
  if (giro.farmacia() && auth.puede(PAQUETES.VENTAS_OPERAR)) return 'farmacia';
  if (!giro.clinica() && giro.estudios()) return 'estudios';
  return 'pacientes';
}
