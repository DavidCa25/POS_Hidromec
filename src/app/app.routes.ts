import { Routes } from '@angular/router';
import { Login } from '../login/login';
import { Dashboard } from '../dashboard/dashboard';
import { Inventario } from '../inventario/inventario';
import { Compras } from '../compras/compras';
import { Estadisticas } from '../estadisticas/estadisticas';
import { Venta } from '../venta/appVenta/venta';
import { Corte } from '../venta/appCorte/corte';
import { Cajon } from '../venta/appCajon/abrirCajon';

export const routes: Routes = [
  { path: 'login', component: Login },
  {
    path: 'dashboard',
    component: Dashboard,
    children: [
      { path: 'inventario', component: Inventario },
      { path: 'compras', component: Compras },
      { path: 'estadisticas', component: Estadisticas },
      { path: 'venta', component: Venta},
      { path: 'corte-dia', component: Corte},
      { path: 'abrir-cajon', component: Cajon}
    ]
  },
  { path: '', redirectTo: '/login', pathMatch: 'full' },
  { path: '**', redirectTo: '/login' }
];
