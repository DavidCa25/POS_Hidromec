# Addons de cliente (`custom-addons/`)

Personalizaciones que solo lleva el Wybix de un cliente. Parecido a los
`custom-addons` de Odoo, pero **incluidos al compilar**, no cargados en tiempo de
ejecución: un build sin addon no lleva ni un byte del cliente.

```
custom-addons/
└── wybix_<cliente>/
    ├── manifest.json     id, nombre, versión, wybixMin, canal, huecos
    ├── index.ts          exporta (default) un AddonWybix
    ├── assets/           imágenes; se publican en assets/addon/
    └── …                 lo que el addon necesite (mascota, marca, fuentes)
```

## Cómo funciona

1. El núcleo define **huecos** en `src/app/marca/marca.ts` (hoy: `mascota`,
   `mascotaEnTouch`, `fondoTouch`). Pregunta por el hueco, nunca por el cliente.
2. `scripts/addons.mjs` corre antes de cada build. Sin `WYBIX_ADDON` deja la app
   sin addon. Con él genera, **sin versionar**:
   - `src/app/marca/addons.generated.ts`: el import del addon;
   - `src/assets/addon/`: sus imágenes;
   - `electron/addon.generated.json`: su id y canal de actualización.
3. `npm run dist:addon -- wybix_<cliente>` arma su instalador en
   `release-<canal>/`. Usa el mismo appId que Wybix, así que se instala encima del
   Wybix del cliente y conserva su base, licencia y configuración.

## Reglas

- **Un addon nunca edita archivos del núcleo.** Si necesita algo que el núcleo no
  ofrece, se agrega un hueco nuevo a `marca.ts` (de forma general, opcional y sin
  romper a los demás) y el addon lo llena.
- **El núcleo nunca nombra a un cliente.** `npm run test:addons` falla si
  `src/`, `electron/` o `shared/` mencionan a uno.
- **Los cambios generales no borran personalizaciones.** `tsconfig.app.json`
  incluye `custom-addons/`: si un cambio del núcleo rompe un hueco, `npm run build`
  falla, también en el Wybix general.
- **Canal propio.** El build del cliente busca actualizaciones en `<canal>.yml`,
  nunca en `latest.yml`, así que nunca le baja el Wybix general encima.
- **Nada original del cliente en el repositorio.** El repositorio es público: los
  archivos de diseño (PDF/AI) y las fuentes editables de una mascota se quedan
  fuera (`.gitignore`); el addon versiona solo lo que ya viaja en el instalador
  (motor compilado, SVG de logo y fondo).
- **Datos del cliente, no código.** Precios, productos o textos se configuran en
  la app; un addon es para lo que la configuración no cubre (identidad visual,
  flujos exclusivos).

## ¿Addon o módulo oficial?

| Si la petición… | Va a… |
|---|---|
| le serviría a otros clientes del mismo giro | módulo oficial (núcleo + capacidad/licencia) |
| es identidad del cliente (mascota, logo, colores, textos de marca) | addon |
| es un flujo que solo tiene sentido en ese negocio | addon |
| empieza como addon y la pide un segundo cliente | se sube al núcleo como hueco o módulo |

## Nueva mascota de otro cliente

El motor de la mascota (`wybix_idonut/mascota/wybix-mascot.esm.js`) acepta
`options.character`: otro personaje no necesita otro motor. Cuando llegue el
segundo cliente con mascota, el motor se mueve al núcleo y cada addon aporta solo
su personaje.

## Addons actuales

| Addon | Cliente | Huecos |
|---|---|---|
| `wybix_idonut` | I Do Nut | mascota I DO NUT ME, mascota en Touch, logo como fondo de Touch |
