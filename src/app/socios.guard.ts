import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { CapabilityService } from '../core';
import { AuthService, PAQUETES } from '../services/auth.service';

/**
 * ¿ESTA PERSONA ENTRA A SOCIOS / PROPINAS? (0079)
 *
 * Igual que Asistencia, dos preguntas:
 *
 *   CAPACIDAD  ¿el negocio la activó en Aplicaciones? Si no, lleva a
 *              Aplicaciones, que es donde se decide.
 *   PERMISO    Socios: SOCIOS_GESTIONAR (dinero de los dueños).
 *              Propinas: CAJA_CORTES (repartir mueve el cajón).
 *              El asistente de Socios: CONFIGURACION_ADMINISTRAR; se abre
 *              también ANTES de activar, porque es como se activa.
 *
 * No es la seguridad: el proceso principal vuelve a exigir el paquete en
 * cada canal.
 */
export const puedeVerSocios: CanActivateFn = async () => {
  const caps = inject(CapabilityService);
  const auth = inject(AuthService);
  const router = inject(Router);
  await caps.load();
  if (!caps.socios) return router.createUrlTree(['/dashboard/aplicaciones']);
  if (!auth.puede(PAQUETES.SOCIOS_GESTIONAR)) return router.createUrlTree(['/dashboard/inicio']);
  return true;
};

export const puedeConfigurarSocios: CanActivateFn = async () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  if (!auth.puede(PAQUETES.CONFIGURACION_ADMINISTRAR)) return router.createUrlTree(['/dashboard/inicio']);
  return true;
};

export const puedeVerPropinas: CanActivateFn = async () => {
  const caps = inject(CapabilityService);
  const auth = inject(AuthService);
  const router = inject(Router);
  await caps.load();
  if (!caps.propinas) return router.createUrlTree(['/dashboard/aplicaciones']);
  if (!auth.puede(PAQUETES.CAJA_CORTES)) return router.createUrlTree(['/dashboard/inicio']);
  return true;
};
