import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { CapabilityService } from '../core';
import { AuthService, PAQUETES } from '../services/auth.service';

/**
 * ¿ESTA CAJA ENTRA A SERVICIOS?
 *
 * Dos preguntas, no una:
 *
 *   CAPACIDAD  ¿el negocio tiene el módulo encendido? Si no, la ruta no
 *              existe para nadie, ni siquiera para el dueño: encenderla es
 *              una decisión que se toma en Aplicaciones.
 *   PERMISO    ¿esta persona puede operar servicios? Un Operador sí; alguien
 *              con un rol que esta versión no conoce, no.
 *
 * SE PREGUNTA EN CADA NAVEGACIÓN
 * ------------------------------
 * Y no una vez al entrar. Apagar el módulo desde otra caja tiene que surtir
 * efecto sin que nadie cierre sesión, igual que retirar un permiso. Si esto se
 * resolviera al arrancar, un módulo apagado seguiría abriéndose toda la tarde.
 *
 * Y NO ES LA SEGURIDAD
 * --------------------
 * Es la navegación. El proceso principal vuelve a comprobar el paquete Y el
 * módulo antes de ejecutar cualquier canal de escritura: si alguien llegara a
 * la ruta de otra forma, no podría hacer nada.
 */
export const puedeVerServicios: CanActivateFn = async () => {
  const caps = inject(CapabilityService);
  const auth = inject(AuthService);
  const router = inject(Router);

  await caps.load();

  if (!caps.servicios) {
    return router.createUrlTree(['/dashboard/aplicaciones']);
  }
  if (!auth.puede(PAQUETES.SERVICIOS_OPERAR) && !auth.puede(PAQUETES.SERVICIOS_ADMINISTRAR)) {
    return router.createUrlTree(['/dashboard/estadisticas']);
  }
  return true;
};
