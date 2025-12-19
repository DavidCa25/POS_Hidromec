# Filtros Lubs Ríos POS (Angular + Electron)

Punto de venta de escritorio para **Filtros y Lubricantes Ríos**, construido con **Angular** (frontend) + **Electron** (shell desktop) y empaquetado con **electron-builder**.

---

## Stack

- **Angular 20** + RxJS
- **Electron 37**
- **SQL Server** (driver `mssql`)
- Generación de **PDFs** (PDFKit) y reportes/impresión con **Puppeteer**

> Requisitos de Node para Angular 20: `^20.19.0 || ^22.12.0 || ^24.0.0`. :contentReference[oaicite:0]{index=0}  
> Puppeteer requiere **Node 18+**. :contentReference[oaicite:1]{index=1}

---

## Requisitos

- **Node.js**: recomendado **Node 20.19+** (por compatibilidad con Angular 20). :contentReference[oaicite:2]{index=2}
- **npm**
- Windows (recomendado) para generar instalador **NSIS**

---

## Instalación

## bash
npm install

---- 
## Desarrollo (modo dev)

Este modo levanta:

Angular en http://localhost:4200

Electron con electronmon en modo development

npm run dev

Scripts relevantes:

npm run start:ng → ng serve

npm run start:electron → cross-env NODE_ENV=development electronmon ./electron/main.js

npm run dev → corre ambos con concurrently y espera a Angular con wait-on

----

## Producción local (sin instalador)

Compila Angular (con --base-href ./) y abre Electron cargando el build:

npm run start

Este comando usa:

npm run build → ng build --configuration production --base-href ./

npm run electron → electron ./electron/main.js

----

## Variables de entorno (.env)

Crea un archivo .env en la raíz del proyecto (mismo nivel que package.json).

El token GH_TOKEN se usa solo para publish, no es necesario para correr la app si no publicas.

DB_USER=
DB_PASSWORD=
DB_HOST=
DB_PORT=
DB_NAME=
DB_ENCRYPT=
DB_TRUST_SERVER_CERT=
GH_TOKEN=

¿Qué significa cada variable?

DB_USER: usuario de SQL Server

DB_PASSWORD: contraseña del usuario

DB_HOST: host o IP del servidor SQL (ej. localhost o 192.168.1.50)

DB_PORT: puerto (por defecto 1433)

DB_NAME: nombre de la base de datos

DB_ENCRYPT: habilita cifrado en la conexión (recomendado true)

DB_TRUST_SERVER_CERT: útil en entornos locales/autofirmados (común true en LAN)

GH_TOKEN: token para publicar releases en GitHub (solo si usarás npm run publish)

---- 

## Empaquetado y distribución
Unpacked (carpeta)

Genera una build “sin instalador” (útil para validar rápido):

npm run pack

Instalador (NSIS)

Genera el instalador en release/:

npm run dist

---- 

## Publicar a GitHub Releases (auto-update)

Este repo está configurado para publicar con:

"publish": { "provider": "github", "owner": "DavidCa25", "repo": "POS_Hidromec" }

Para publicar necesitas un GitHub Personal Access Token con permisos de repo y exportarlo como GH_TOKEN (o GITHUB_TOKEN). 
electron.build

Publicar (siempre)

El script ya viene listo:

npm run publish

## Estructura del proyecto

electron/ → proceso principal, assets e integración desktop

electron/main.js → entrypoint de Electron

electron/assets/ → íconos y recursos (incluye FILURI.ico)

electron/templates/ → plantillas copiadas como extraResources

dist/filtros_lubs_rios/ → salida del build de Angular (producción)

release/ → salida de electron-builder (instalador/artefactos)

electron-builder incluye:

dist/filtros_lubs_rios/**/*

electron/**/*

node_modules/**/*

package.json

y copia como recursos extra:

electron/templates → templates

electron/assets → assets

----

## Troubleshooting rápido

Pantalla en blanco en producción: asegúrate de compilar con --base-href ./ (ya está en npm run build).

Electron abre antes que Angular en dev: el dev usa wait-on http://localhost:4200 (si cambias el puerto, actualiza el script).

Publish falla por token: define GH_TOKEN / GITHUB_TOKEN (PAT) antes de correr npm run publish.

----

## Scripts

npm run dev → Angular + Electron (hot reload)

npm run start → build prod + abrir Electron

npm run pack → build unpacked (carpeta)

npm run dist → instalador NSIS (release)

npm run publish → build + publicar a GitHub Releases
