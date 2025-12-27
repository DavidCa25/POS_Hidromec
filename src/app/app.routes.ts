import { Routes } from '@angular/router';
import { Login } from '../login/login';
import { Dashboard } from '../dashboard/dashboard';
import { Inventario } from '../inventario/inventario';
import { Compras } from '../compras/compras';
import { Estadisticas } from '../estadisticas/estadisticas';
import { Venta } from '../venta/appVenta/venta';
import { Corte } from '../venta/appCorte/corte';
import { Cajon } from '../venta/appCajon/abrirCajon';
import { Clientes } from '../clientes/clientes';
import { RegistrarCompra } from '../compras/appRegistrarCompra/registrarCompra';
import { TablaCompra } from '../compras/appTablaCompra/tablaCompra';
import { CrearUsuarioComponent } from '../sign_up/sign_up';
import { Facturacion } from '../facturacion/facturacion';
import { TablaVentaComponent } from '../venta/tablaVenta/tablaVenta';
import { ConfigurationApp } from '../configuration/configurationApp';

export const routes: Routes = [
  { path: 'login', component: Login },
  { path: 'sign_up', component: CrearUsuarioComponent },
  {
    path: 'dashboard',
    component: Dashboard,
    children: [
      { path: 'inventario', component: Inventario },
      { path: 'compras', component: Compras },
      { path: 'registrarCompra', component: RegistrarCompra},
      { path: 'tablaCompra', component: TablaCompra},
      { path: 'tablaVenta', component: TablaVentaComponent},
      { path: 'estadisticas', component: Estadisticas},
      { path: 'venta', component: Venta},
      { path: 'corte-dia', component: Corte},
      { path: 'abrir-cajon', component: Cajon},
      { path: 'clientes', component: Clientes },
      { path: 'facturacion', component: Facturacion },
      { path: 'configuracion', component: ConfigurationApp }
    ]
  },
  { path: '', redirectTo: '/login', pathMatch: 'full' },
  { path: '**', redirectTo: '/login' }
];
