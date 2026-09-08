import { Type } from '@angular/core';

export type TileSize = '1x1' | '2x1' | '1x2' | '2x2';

export type StatusKey = 'mp' | 'printer' | 'scanner' | 'drawer' | 'backup' | string;

/** Carga perezosa del componente de un mosaico. */
export type TileLoader = () => Promise<Type<unknown>>;

export interface ConfigTile {
    id: string;
    title: string;
    desc: string;
    icon: string;
    color: 'blue' | 'green' | 'purple' | 'orange' | 'gray';
    size: TileSize;
    /**
     * Antes cada mosaico referenciaba su componente directamente, asi que los
     * 19 paneles (y sweetalert2, qrcode, xlsx...) viajaban en el bundle
     * inicial aunque el usuario nunca abriera Configuracion. Ahora cada panel
     * se importa solo al abrir su mosaico.
     */
    load?: TileLoader;
    statusKey?: StatusKey;
}

export interface ConfigSection {
    id: string;
    title: string;
    tiles: ConfigTile[];
}

const devices: TileLoader = () => import('../devices-panel/devices-panel.component').then(m => m.DevicesPanelComponent);
const ticket: TileLoader = () => import('../ticket-panel/ticket-panel.component').then(m => m.TicketPanelComponent);

export const CONFIG_SECTIONS: ConfigSection[] = [
    {
        id: 'cobros',
        title: 'Cobros',
        tiles: [
            {
                id: 'mp',
                title: 'Terminal Mercado Pago',
                desc: 'Configura tu Point y déjala lista para cobrar',
                icon: 'credit-card',
                color: 'blue',
                size: '2x1',
                load: () => import('../mp-wizard/mpWizard').then(m => m.MpWizard),
                statusKey: 'mp'
            },
            {
                id: 'formas-pago',
                title: 'Formas de pago',
                desc: 'Efectivo, tarjeta, transferencia, crédito',
                icon: 'coins',
                color: 'green',
                size: '1x1',
                load: () => import('../formas-pago-panel/formas-pago.component').then(m => m.FormasPagoPanelComponent)
            }
        ]
    },
    {
        id: 'servicios',
        title: 'Servicios',
        tiles: [
            { id: 'pago-servicios', title: 'Pago de servicios', desc: 'Recargas y pago de luz, agua, gas… (TAECEL)', icon: 'device-mobile', color: 'green', size: '2x1',
              load: () => import('../servicios-panel/servicios-config.component').then(m => m.ServiciosPanelComponent) }
        ]
    },
    {
        id: 'dispositivos',
        title: 'Dispositivos',
        tiles: [
            { id: 'impresora', title: 'Impresora de tickets', desc: 'Impresora y formato del ticket', icon: 'printer', color: 'purple', size: '1x1', statusKey: 'printer', load: ticket },
            { id: 'scanner', title: 'Lector de códigos', desc: 'Scanner por USB o serial', icon: 'barcode', color: 'orange', size: '1x1', statusKey: 'scanner', load: devices },
            { id: 'cajon', title: 'Cajón de dinero', desc: 'Apertura automática al cobrar', icon: 'vault', color: 'blue', size: '1x1', statusKey: 'drawer', load: devices },
            { id: 'bascula', title: 'Báscula', desc: 'Captura de peso (opcional)', icon: 'gauge', color: 'gray', size: '1x1', load: devices },
            { id: 'customer-display', title: 'Pantalla de cliente', desc: 'Muestra la venta en un segundo monitor', icon: 'monitor', color: 'purple', size: '2x1',
              load: () => import('../customer-display-panel/customer-display.component').then(m => m.CustomerDisplayPanelComponent) },
            { id: 'sync-nube', title: 'Sincronización en la nube', desc: 'Activa el envío de datos a la app del dueño', icon: 'cloud-arrow-up', color: 'blue', size: '2x1',
              load: () => import('../sync-nube-panel/sync-nube.component').then(m => m.SyncNubePanelComponent) },
            { id: 'pairing-qr', title: 'Emparejamiento QR', desc: 'Código QR para emparejar con la nube', icon: 'qr-code', color: 'green', size: '1x1',
              load: () => import('../pairing-qr-panel/pairing-qr.component').then(m => m.PairingQr) },
            { id: 'descarga-app', title: 'Descarga la app movil', desc: 'QR para instalar la app del dueño', icon: 'device-mobile', color: 'blue', size: '1x1',
              load: () => import('../descarga-app-panel/descarga-app.component').then(m => m.DescargaAppPanel) }
        ]
    },
    {
        id: 'personalizacion',
        title: 'Personalización',
        tiles: [
            { id: 'ticket', title: 'Ticket', desc: 'Logo, pie de página y datos fiscales', icon: 'receipt', color: 'purple', size: '1x1', load: ticket },
            { id: 'negocio', title: 'Datos del negocio', desc: 'Nombre, RFC, dirección y moneda', icon: 'storefront', color: 'green', size: '2x1',
              load: () => import('../negocio-panel/negocio-panel.component').then(m => m.NegocioPanelComponent) },
            { id: 'eliminar-cuenta', title: 'Eliminar cuenta', desc: 'Borra tu cuenta y datos en la nube', icon: 'user-minus', color: 'orange', size: '1x1',
              load: () => import('../eliminar-cuenta-panel/eliminar-cuenta.component').then(m => m.EliminarCuentaPanelComponent) }
        ]
    },
    {
        id: 'datos',
        title: 'Datos y respaldos',
        tiles: [
            { id: 'backups', title: 'Respaldos', desc: 'Exporta e importa tu base de datos', icon: 'database', color: 'green', size: '2x1', statusKey: 'backup',
              load: () => import('../backups-panel/backups-panel.component').then(m => m.BackupsPanelComponent) }
        ]
    },
    {
        id: 'sistema',
        title: 'Sistema',
        tiles: [
            { id: 'licencia', title: 'Licencia', desc: 'Activa tu clave y revisa tu plan', icon: 'key', color: 'green', size: '2x1',
              load: () => import('../licencia-panel/licencia.component').then(m => m.LicenciaPanelComponent) },
            { id: 'usuarios', title: 'Usuarios y permisos', desc: 'Cajeros, supervisores y accesos', icon: 'identification-badge', color: 'gray', size: '2x1',
              load: () => import('../usuarios-panel/usuarios.component').then(m => m.UsuariosPanelComponent) },
            { id: 'actualizaciones', title: 'Actualizaciones', desc: 'Buscar e instalar nuevas versiones', icon: 'arrows-clockwise', color: 'blue', size: '1x1',
              load: () => import('../actualizaciones-panel/actualizaciones.component').then(m => m.ActualizacionesPanelComponent) },
            { id: 'diagnostico', title: 'Diagnóstico', desc: 'Revisa los registros del sistema', icon: 'pulse', color: 'gray', size: '1x1',
              load: () => import('../diagnostico-panel/diagnostico-panel.component').then(m => m.DiagnosticoPanel) },
            { id: 'cajas', title: 'Cajas', desc: 'Identidad de esta máquina y catálogo de cajas', icon: 'desktop-tower', color: 'blue', size: '2x1',
              load: () => import('../register-panel/register-panel.component').then(m => m.RegistersPanel) },
            { id: 'experiencia', title: 'Experiencia de esta caja', desc: 'Retail, Touch o solo administración', icon: 'devices', color: 'purple', size: '1x1',
              load: () => import('../device-profile-panel/device-profile.component').then(m => m.DeviceProfilePanelComponent) },
        ]
    },
    {
        id: 'facturacion',
        title: 'Facturación',
        tiles: [
            { id: 'facturacion', title: 'Facturación', desc: 'Configura tu facturación electrónica', icon: 'file-text', color: 'purple', size: '2x1',
              load: () => import('../facturacionConfig-panel/facturacion-config.component').then(m => m.FacturacionConfig) }
        ]

    }
];
