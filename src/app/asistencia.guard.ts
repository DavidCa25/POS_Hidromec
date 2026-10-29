import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { CapabilityService } from '../core';
import { AuthService, PAQUETES } from '../services/auth.service';

/**
 * ¿ESTA PERSONA ENTRA A ASISTENCIA?
 *
 * Igual que Servicios, dos preguntas:
 *
 *   CAPACIDAD  ¿el negocio la activó en Aplicaciones? Si no, la ruta no existe
 *              para nadie: lleva a Aplicaciones, que es donde se decide.
 *   PERMISO    ¿gestiona al equipo (ASISTENCIA_GESTIONAR)? Checar no pasa por
 *              aquí: es un diálogo de la caja para cualquiera con sesión.
 *
 * Se pregunta en cada navegación. Y no es la seguridad: el proceso principal
 * vuelve a exigir el paquete en cada canal.
 */
export const puedeVerAsistencia: CanActivateFn = async () => {
  const caps = inject(CapabilityService);
  const auth = inject(AuthService);
  const router = inject(Router);
  await caps.load();
  if (!caps.asistencia) return router.createUrlTree(['/dashboard/aplicaciones']);
  if (!auth.puede(PAQUETES.ASISTENCIA_GESTIONAR)) return router.createUrlTree(['/dashboard/inicio']);
  return true;
};
