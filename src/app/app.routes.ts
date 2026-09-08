import { Routes } from '@angular/router';
import { Login } from '../login/login';
import { experienciaDeVenta } from './experiencia-venta.guard';

/*
 * Rutas de Wybix.
 *
 * Solo `Login` viaja en el bundle inicial: es la primera pantalla y no
 * depende de nada pesado. Todo lo demas se carga por `loadComponent` cuando
 * el usuario entra a esa pantalla. Asi el arranque no paga Estadisticas
 * (ApexCharts), Migracion (xlsx), Facturacion, ni los ~20 paneles de
 * Configuracion, y queda sitio para la experiencia Touch sin volver a
 * engordar el inicio.
 *
 * Cada experiencia es un chunk independiente: Retail (`venta`), Backoffice
 * (inventario, compras, estadisticas...) y, mas adelante, Touch. Una caja
 * Retail nunca descarga el codigo de Touch y viceversa.
 */
export const routes: Routes = [
  { path: 'login', component: Login },
  {
    path: 'sign_up',
    loadComponent: () => import('../sign_up/sign_up').then(m => m.CrearUsuarioComponent),
  },
  {
    // Experiencia Touch: pantalla completa, sin el rail del Backoffice.
    // Mismo Core, misma base, misma venta.
    path: 'touch',
    canActivate: [experienciaDeVenta],
    loadComponent: () => import('../touch/touch-pos').then(m => m.TouchPos),
  },
  {
    path: 'dashboard',
    loadComponent: () => import('../dashboard/dashboard').then(m => m.Dashboard),
    children: [
      // ---- Retail POS ----
      // El guard decide, en cada navegacion, si esta caja vende aqui o en
      // Touch. Es lo que hace que cambiar la experiencia surta efecto sin
      // reiniciar ni volver a entrar.
      { path: 'venta', canActivate: [experienciaDeVenta], loadComponent: () => import('../venta/appVenta/venta').then(m => m.Venta) },
      { path: 'corte-dia', loadComponent: () => import('../venta/appCorte/corte').then(m => m.Corte) },
      { path: 'abrir-cajon', loadComponent: () => import('../venta/appCajon/abrirCajon').then(m => m.Cajon) },
      { path: 'tablaVenta', loadComponent: () => import('../venta/tablaVenta/tablaVenta').then(m => m.TablaVentaComponent) },

      // ---- Backoffice ----
      { path: 'inventario', loadComponent: () => import('../inventario/inventario').then(m => m.Inventario) },
      { path: 'importador', loadComponent: () => import('./importador-productos/importador-productos.component').then(m => m.ImportadorProductos) },
      { path: 'migracion', loadComponent: () => import('./migracion/migracion.component').then(m => m.Migracion) },
      { path: 'proveedores', loadComponent: () => import('./proveedores/proveedores.component').then(m => m.Proveedores) },
      { path: 'compras', loadComponent: () => import('../compras/compras').then(m => m.Compras) },
      { path: 'registrarCompra', loadComponent: () => import('../compras/appRegistrarCompra/registrarCompra').then(m => m.RegistrarCompra) },
      { path: 'tablaCompra', loadComponent: () => import('../compras/appTablaCompra/tablaCompra').then(m => m.TablaCompra) },
      { path: 'estadisticas', loadComponent: () => import('../estadisticas/estadisticas').then(m => m.Estadisticas) },
      { path: 'alertas', loadComponent: () => import('../alertas/alertas').then(m => m.Alertas) },
      { path: 'conteo', loadComponent: () => import('../conteo/conteo').then(m => m.Conteo) },
      { path: 'clientes', loadComponent: () => import('../clientes/clientes').then(m => m.Clientes) },
      { path: 'servicios', loadComponent: () => import('../servicios/servicios').then(m => m.Servicios) },
      { path: 'facturacion', loadComponent: () => import('../facturacion/facturacion').then(m => m.Facturacion) },
      { path: 'recetas', loadComponent: () => import('../hospitality/hospitality-admin').then(m => m.HospitalityAdmin) },
      { path: 'configuracion', loadComponent: () => import('./config-shell/configShell').then(m => m.ConfigShell) },
    ]
  },
  { path: '', redirectTo: '/login', pathMatch: 'full' },
  { path: '**', redirectTo: '/login' }
];
