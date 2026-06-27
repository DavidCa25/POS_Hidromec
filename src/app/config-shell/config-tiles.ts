import { Type } from '@angular/core';
import { MpWizard } from '../mp-wizard/mpWizard';
import { DevicesPanelComponent } from '../devices-panel/devices-panel.component';
import { TicketPanelComponent } from '../ticket-panel/ticket-panel.component';
import { BackupsPanelComponent } from '../backups-panel/backups-panel.component';
import { NegocioPanelComponent } from '../negocio-panel/negocio-panel.component';


export type TileSize = '1x1' | '2x1' | '1x2' | '2x2';

export type StatusKey = 'mp' | 'printer' | 'scanner' | 'drawer' | 'backup' | string;

export interface ConfigTile {
    id: string;
    title: string;
    desc: string;
    icon: string;    
    color: 'blue' | 'green' | 'purple' | 'orange' | 'gray';
    size: TileSize;
    component?: Type<unknown>;  
    statusKey?: StatusKey;
}

export interface ConfigSection {
    id: string;
    title: string;
    tiles: ConfigTile[];
}

export const CONFIG_SECTIONS: ConfigSection[] = [
    {
        id: 'cobros',
        title: 'Cobros',
        tiles: [
            {
                id: 'mp',
                title: 'Terminal Mercado Pago',
                desc: 'Configura tu Point y déjala lista para cobrar',
                icon: 'credit-card-2-back-fill',
                color: 'blue',
                size: '2x1',
                component: MpWizard,
                statusKey: 'mp'
            },
            {
                id: 'formas-pago',
                title: 'Formas de pago',
                desc: 'Efectivo, tarjeta, transferencia, crédito',
                icon: 'cash-coin',
                color: 'green',
                size: '1x1'
            }
        ]
    },
    {
        id: 'dispositivos',
        title: 'Dispositivos',
        tiles: [
            { id: 'impresora', title: 'Impresora de tickets', desc: 'Impresora y formato del ticket', icon: 'printer', color: 'purple', size: '1x1', statusKey: 'printer', component: TicketPanelComponent },
            { id: 'scanner', title: 'Lector de códigos', desc: 'Scanner por USB o serial', icon: 'upc-scan', color: 'orange', size: '1x1', statusKey: 'scanner', component: DevicesPanelComponent },
            { id: 'cajon', title: 'Cajón de dinero', desc: 'Apertura automática al cobrar', icon: 'safe2', color: 'blue', size: '1x1', statusKey: 'drawer', component: DevicesPanelComponent },
            { id: 'bascula', title: 'Báscula', desc: 'Captura de peso (opcional)', icon: 'speedometer2', color: 'gray', size: '1x1', component: DevicesPanelComponent }
        ]
    },
    {
        id: 'personalizacion',
        title: 'Personalización',
        tiles: [
            { id: 'ticket', title: 'Ticket', desc: 'Logo, pie de página y datos fiscales', icon: 'receipt', color: 'purple', size: '1x1', component: TicketPanelComponent },
            { id: 'negocio', title: 'Datos del negocio', desc: 'Nombre, RFC, dirección y moneda', icon: 'shop', color: 'green', size: '2x1', component: NegocioPanelComponent }
        ]
    },
    {
        id: 'datos',
        title: 'Datos y respaldos',
        tiles: [
            { id: 'backups', title: 'Respaldos', desc: 'Exporta e importa tu base de datos', icon: 'database-fill', color: 'green', size: '2x1', statusKey: 'backup', component: BackupsPanelComponent }
        ]
    },
    {
        id: 'sistema',
        title: 'Sistema',
        tiles: [
            { id: 'usuarios', title: 'Usuarios y permisos', desc: 'Cajeros, supervisores y accesos', icon: 'person-badge', color: 'gray', size: '1x1' },
            { id: 'actualizaciones', title: 'Actualizaciones', desc: 'Buscar e instalar nuevas versiones', icon: 'arrow-repeat', color: 'blue', size: '1x1' }
        ]
    }
];