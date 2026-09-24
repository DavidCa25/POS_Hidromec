import { inject } from '@angular/core';
import { Routes } from '@angular/router';
import { GiroServiciosService } from '../core';
import { Login } from '../login/login';
import { experienciaDeVenta } from './experiencia-venta.guard';
import { puedeVerServicios } from './servicios.guard';

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
    /* Servicios en Touch: el mismo modulo, la misma base y el mismo servicio;
       lo unico propio es la ergonomia. Pasa por el MISMO guard que la version
       de escritorio -modulo encendido y paquete- porque son la misma puerta:
       tener otra aqui seria tener dos sitios donde equivocarse. */
    path: 'touch/servicios',
    canActivate: [puedeVerServicios],
    loadComponent: () => import('../touch/servicios/touch-servicios').then(m => m.TouchServicios),
  },
  {
    path: 'dashboard',
    loadComponent: () => import('../dashboard/dashboard').then(m => m.Dashboard),
    children: [
      /*
       * INICIO. El panel no tenia pantalla de entrada: se caia en la ultima
       * ruta o en un hueco. Con el rail lateral eso se disimulaba -habia
       * dieciocho enlaces a la vista-, pero con el dock abajo la primera
       * pantalla tiene que decir algo por si misma.
       */
      { path: '', pathMatch: 'full', redirectTo: 'inicio' },
      { path: 'inicio', loadComponent: () => import('../dashboard/inicio/inicio.component').then(m => m.Inicio) },

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
      { path: 'quickstart', loadComponent: () => import('./wx-quickstart/wx-quickstart.component').then(m => m.WxQuickstartComponent) },
      /* `/importador` era el camino viejo. Se conserva como REDIRECCION y no
         como pantalla: mantener dos motores de importacion vivos garantiza
         que uno de los dos se quede atras sin que nadie se entere. */
      { path: 'importador', redirectTo: 'quickstart', pathMatch: 'full' },
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
      // Fidelizacion es un chunk aparte: un negocio que no la enciende no
      // descarga ni una linea de campanas, dinamicas o rifas.
      { path: 'fidelizacion', loadComponent: () => import('../loyalty/loyalty-admin').then(m => m.LoyaltyAdmin) },

      /*
       * Servicios: el negocio que ademas de vender cobra por trabajo.
       *
       * El guard pregunta dos cosas en CADA navegacion: si el negocio tiene el
       * modulo encendido y si esta persona puede operarlo. Apagarlo desde otra
       * caja tiene que surtir efecto sin que nadie cierre sesion.
       *
       * Las pantallas son hijas de una carcasa con pestanas propias: cuatro
       * entradas sueltas en el rail lateral -que ya tiene dieciocho- lo
       * convertirian en una lista que hay que leer entera.
       */
      {
        /*  YA estaba ocupado por Pago de servicios -recargas y recibos-,
           que lleva tiempo en produccion. Reutilizar la ruta habria dejado el
           modulo nuevo inalcanzable: Angular resuelve la primera que coincide. */
        path: 'ordenes-de-servicio',
        canActivate: [puedeVerServicios],
        loadComponent: () => import('../modulo-servicios/servicios-shell.component').then(m => m.ServiciosShell),
        children: [
          /* La pestaña de entrada la decide el GIRO, no una constante.
             Una barbería abre en la agenda porque su día es la agenda; un
             taller abre en órdenes porque su día son las órdenes. El guard de
             arriba ya dejó el giro cargado, así que esto puede ser síncrono,
             que es lo único que Angular admite aquí. */
          {
            path: '',
            pathMatch: 'full',
            redirectTo: () => inject(GiroServiciosService).inicio,
          },
          { path: 'ordenes', loadComponent: () => import('../modulo-servicios/ordenes/ordenes.component').then(m => m.ServiciosOrdenes) },
          { path: 'agenda', loadComponent: () => import('../modulo-servicios/agenda/agenda.component').then(m => m.ServiciosAgenda) },
          { path: 'activos', loadComponent: () => import('../modulo-servicios/activos/activos.component').then(m => m.ServiciosActivos) },
          { path: 'catalogo', loadComponent: () => import('../modulo-servicios/catalogo/catalogo.component').then(m => m.ServiciosCatalogo) },
          { path: 'profesionales', loadComponent: () => import('../modulo-servicios/profesionales/profesionales.component').then(m => m.ServiciosProfesionales) },
          { path: 'comisiones', loadComponent: () => import('../modulo-servicios/comisiones/comisiones.component').then(m => m.ServiciosComisiones) },
        ],
      },
      /* El detalle va FUERA de la carcasa: ocupa la pantalla entera y su propio
         carril lateral ya lleva la navegacion que hace falta. Meterlo dentro
         habria dejado dos filas de pestanas compitiendo por el mismo sitio. */
      {
        path: 'ordenes-de-servicio/orden/:id',
        canActivate: [puedeVerServicios],
        loadComponent: () => import('../modulo-servicios/orden/orden.component').then(m => m.ServiciosOrden),
      },
      { path: 'configuracion', loadComponent: () => import('./config-shell/configShell').then(m => m.ConfigShell) },
      // Aplicaciones: que capacidades opcionales tiene encendidas el negocio.
      // Vive fuera de Configuracion a proposito: configurar la impresora y
      // decidir que Wybix tenga Fidelizacion no son la misma clase de cosa.
      { path: 'aplicaciones', loadComponent: () => import('./aplicaciones/aplicaciones.component').then(m => m.Aplicaciones) },
    ]
  },
  { path: '', redirectTo: '/login', pathMatch: 'full' },
  { path: '**', redirectTo: '/login' }
];
