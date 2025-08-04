import { Routes } from '@angular/router';
import { Dashboard } from './dashboard';
import { Inventario } from '../inventario/inventario';
import { Compras } from '../compras/compras';

export const DashboardRoutes: Routes = [
  {
    path: 'dashboard',
    component: Dashboard,
    children: [
      { path: 'inventario', component: Inventario },
      { path: 'compras', component: Compras },
      { path: '', redirectTo: 'inventario', pathMatch: 'full' }
      ]
  },
  { path: '', redirectTo: '/dashboard', pathMatch: 'full' }
];
