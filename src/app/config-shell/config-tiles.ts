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
    /** Un panel que necesita espacio (un mapa, una tabla ancha) abre el cajon amplio. */
    amplio?: boolean;
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
            },
            {
                id: 'conceptos-egreso',
                title: 'Conceptos de egreso',
                desc: 'Renta, luz, Uber, Didi, gas… en qué gasta tu negocio',
                icon: 'receipt',
                color: 'orange',
                size: '1x1',
                load: () => import('../conceptos-egreso-panel/conceptos-egreso.component').then(m => m.ConceptosEgresoPanelComponent)
            }
        ]
    },
    /* «Pago de servicios» (TAECEL) se mudo a Aplicaciones: es una integracion
       con un proveedor, no un ajuste. Hoy aparece ahi como no disponible. */
    {
        id: 'dispositivos',
        title: 'Dispositivos',
        tiles: [
            { id: 'impresora', amplio: true, title: 'Impresora de tickets', desc: 'Impresora y formato del ticket', icon: 'printer', color: 'purple', size: '1x1', statusKey: 'printer', load: ticket },
            { id: 'scanner', title: 'Lector de códigos', desc: 'Scanner por USB o serial', icon: 'barcode', color: 'orange', size: '1x1', statusKey: 'scanner', load: devices },
            { id: 'cajon', title: 'Cajón de dinero', desc: 'Apertura automática al cobrar', icon: 'vault', color: 'blue', size: '1x1', statusKey: 'drawer', load: devices },
            { id: 'bascula', title: 'Báscula', desc: 'Captura de peso (opcional)', icon: 'gauge', color: 'gray', size: '1x1', load: devices },
            { id: 'customer-display', title: 'Pantalla de cliente', desc: 'Muestra la venta en un segundo monitor', icon: 'monitor', color: 'purple', size: '2x1',
              load: () => import('../customer-display-panel/customer-display.component').then(m => m.CustomerDisplayPanelComponent) },
            { id: 'dispositivos-locales', title: 'Dispositivos locales', desc: 'Tablets y pantallas de trabajo por la red del local', icon: 'device-tablet', color: 'green', size: '2x1', amplio: true,
              load: () => import('../dispositivos-locales-panel/dispositivos-locales.component').then(m => m.DispositivosLocalesPanelComponent) }
        ]
    },
    /*
     * La nube no es un dispositivo.
     *
     * Estas tres entradas vivian entre la impresora y la bascula, que es
     * donde nadie las busca: hablan de la app del dueno, no de algo que se
     * enchufa a la caja. Se agrupan con el borrado de cuenta, que tambien es
     * de la cuenta en la nube y estaba en "Personalizacion", al lado del pie
     * del ticket.
     */
    {
        id: 'nube',
        title: 'Nube y cuenta',
        tiles: [
            { id: 'sync-nube', title: 'Sincronización en la nube', desc: 'Activa el envío de datos a la app del dueño', icon: 'cloud-arrow-up', color: 'blue', size: '2x1',
              load: () => import('../sync-nube-panel/sync-nube.component').then(m => m.SyncNubePanelComponent) },
            { id: 'eliminar-cuenta', title: 'Eliminar cuenta', desc: 'Borra tu cuenta y datos en la nube', icon: 'user-minus', color: 'orange', size: '1x1',
              load: () => import('../eliminar-cuenta-panel/eliminar-cuenta.component').then(m => m.EliminarCuentaPanelComponent) }
        ]
    },
    {
        /* Lo que es de ESTA maquina y no del negocio: como se escribe en ella
           y si se usa solo para operar. Vive en device-config.json. */
        id: 'equipo',
        title: 'Este equipo',
        tiles: [
            { id: 'teclado', title: 'Teclado en pantalla', desc: 'Automático, siempre o nunca, en esta máquina', icon: 'keyboard', color: 'blue', size: '1x1',
              load: () => import('../teclado-panel/teclado-panel.component').then(m => m.TecladoPanelComponent) },
            { id: 'modo-terminal', title: 'Modo terminal', desc: 'Usar este equipo solo para operar', icon: 'lock-key', color: 'gray', size: '1x1',
              load: () => import('../modo-terminal-panel/modo-terminal.component').then(m => m.ModoTerminalPanelComponent) }
        ]
    },
    {
        id: 'personalizacion',
        title: 'Personalización',
        tiles: [
            { id: 'ticket', amplio: true, title: 'Tickets y cortes', desc: 'Papel, campos, vista previa e impresión', icon: 'receipt', color: 'purple', size: '1x1', load: ticket },
            { id: 'negocio', title: 'Datos del negocio', desc: 'Nombre, RFC, dirección y moneda', icon: 'storefront', color: 'green', size: '2x1',
              load: () => import('../negocio-panel/negocio-panel.component').then(m => m.NegocioPanelComponent) }
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
            /* «Usuarios y permisos» tiene vista propia (/dashboard/usuarios): el
               organigrama del negocio y lo que puede hacer cada rol. */
            { id: 'actualizaciones', title: 'Actualizaciones', desc: 'Buscar e instalar nuevas versiones', icon: 'arrows-clockwise', color: 'blue', size: '1x1',
              load: () => import('../actualizaciones-panel/actualizaciones.component').then(m => m.ActualizacionesPanelComponent) },
            { id: 'diagnostico', title: 'Diagnóstico', desc: 'Revisa los registros del sistema', icon: 'pulse', color: 'gray', size: '1x1',
              load: () => import('../diagnostico-panel/diagnostico-panel.component').then(m => m.DiagnosticoPanel) },
            { id: 'experiencia', title: 'Experiencia de esta caja', desc: 'Retail, Touch o solo administración', icon: 'devices', color: 'purple', size: '1x1',
              load: () => import('../device-profile-panel/device-profile.component').then(m => m.DeviceProfilePanelComponent) },
        ]
    },
    /*
     * MultiCaja, en su propio grupo.
     *
     * Las dos entradas estaban sueltas en "Sistema", entre la licencia y el
     * diagnostico. Juntas se explican la una a la otra -una prepara la red, la
     * otra reparte las cajas- y, sobre todo, con una licencia de una sola caja
     * desaparece el GRUPO ENTERO en vez de quedar un hueco: `aplicarPlan`
     * borra las secciones que se quedan sin mosaicos.
     */
    {
        id: 'multicaja',
        title: 'MultiCaja',
        tiles: [
            { id: 'cajas', title: 'Cajas', desc: 'Identidad de esta máquina y catálogo de cajas', icon: 'desktop-tower', color: 'blue', size: '2x1',
              load: () => import('../register-panel/register-panel.component').then(m => m.RegistersPanel) },
            { id: 'red-multicaja', title: 'Red MultiCaja', desc: 'Prepara esta máquina para que otras cajas se conecten', icon: 'wifi-high', color: 'blue', size: '2x1',
              load: () => import('../red-multicaja-panel/red-multicaja.component').then(m => m.RedMulticajaPanel) }
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
