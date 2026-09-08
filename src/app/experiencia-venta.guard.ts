import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { CapabilityService } from '../core';

/**
 * Manda la venta a la experiencia que tiene ESTA caja AHORA.
 *
 * QUE PASABA
 * ----------
 * La unica linea que miraba el perfil del dispositivo estaba en el login. Una
 * vez dentro, "Hacer venta" era un enlace fijo a `/dashboard/venta` y nadie
 * volvia a preguntarlo. Cambiar la experiencia en Configuracion guardaba el
 * JSON y actualizaba el estado en memoria, pero ninguna decision de navegacion
 * lo leia: por eso Touch "solo funcionaba" despues de cerrar sesion y volver a
 * entrar. La sesion no tenia nada que ver; era el unico momento en que alguien
 * lo preguntaba otra vez.
 *
 * COMO SE RESUELVE
 * ----------------
 * Un solo guard, en las dos rutas de venta, que compara la ruta pedida con
 * `caps.rutaDeVenta` -la definicion unica de donde vende esta caja- y redirige
 * si no coinciden. Se ejecuta en CADA navegacion, asi que lee el valor del
 * momento y no el que habia al iniciar sesion.
 *
 * No hay bucle posible: `rutaDeVenta` devuelve UNA ruta, de modo que solo una
 * de las dos puede redirigir para un perfil dado.
 */
export const experienciaDeVenta: CanActivateFn = async (_ruta, estado) => {
  const caps = inject(CapabilityService);
  const router = inject(Router);

  // Sin forzar: si ya esta cargado devuelve al instante. Quien cambia el
  // perfil es responsable de refrescar, y lo hace por `setDeviceProfile`.
  await caps.load();

  const destino = caps.rutaDeVenta;
  return estado.url.startsWith(destino) ? true : router.createUrlTree([destino]);
};
