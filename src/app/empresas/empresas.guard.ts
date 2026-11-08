import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService, PAQUETES } from '../../services/auth.service';

/**
 * ¿ESTA PERSONA ENTRA A MIS EMPRESAS? (0080, docs/multiempresa.md)
 *
 * EMPRESAS_CAMBIAR: Administrador, o a quien se le otorgó (un cajero que
 * cobra para dos empresas en el mismo mostrador). No depende de un módulo:
 * una empresa sola también puede dar de alta la segunda desde aquí.
 *
 * No es la seguridad: el proceso principal vuelve a exigir el paquete en
 * cada canal.
 */
export const puedeVerEmpresas: CanActivateFn = () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  return auth.puede(PAQUETES.EMPRESAS_CAMBIAR) ? true : router.createUrlTree(['/dashboard/inicio']);
};
