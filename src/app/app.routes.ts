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
import { ConfigShell } from './config-shell/configShell';
import { ImportadorProductos } from './importador-productos/importador-productos.component';
import { Migracion } from './migracion/migracion.component';
import { Proveedores } from './proveedores/proveedores.component';
import { Alertas } from '../alertas/alertas';
import { Conteo } from '../conteo/conteo';

export const routes: Routes = [
  { path: 'login', component: Login },
  { path: 'sign_up', component: CrearUsuarioComponent },
  {
    path: 'dashboard',
    component: Dashboard,
    children: [
      { path: 'inventario', component: Inventario },
      { path: 'importador', component: ImportadorProductos },
      { path: 'migracion', component: Migracion },
      { path: 'proveedores', component: Proveedores },
      { path: 'compras', component: Compras },
      { path: 'registrarCompra', component: RegistrarCompra},
      { path: 'tablaCompra', component: TablaCompra},
      { path: 'tablaVenta', component: TablaVentaComponent},
      { path: 'estadisticas', component: Estadisticas},
      { path: 'alertas', component: Alertas},
      { path: 'conteo', component: Conteo},
      { path: 'venta', component: Venta},
      { path: 'corte-dia', component: Corte},
      { path: 'abrir-cajon', component: Cajon},
      { path: 'clientes', component: Clientes },
      { path: 'facturacion', component: Facturacion },
      { path: 'configuracion', component: ConfigShell },
    ]
  },
  { path: '', redirectTo: '/login', pathMatch: 'full' },
  { path: '**', redirectTo: '/login' }
];
