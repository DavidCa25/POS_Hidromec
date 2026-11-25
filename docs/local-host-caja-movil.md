# Caja móvil por Local Host (0094)

Wybix POS Mobile puede ser una caja más de la sucursal, sin registrar un evento. La tablet vende con su base local (SQLite cifrado y outbox) y entrega cada hecho a **Local Host** por la red del local, que lo registra en SQL Server con los SP de siempre.

## Cómo se conecta

1. En la computadora principal: Configuración › Dispositivos locales › Conectar dispositivo › **Caja móvil (Wybix POS Mobile)** › Generar código.
2. En la tablet: Emparejar › **Caja de la sucursal** › Abrir cámara (o pegar la dirección que aparece bajo el QR).
3. La tablet recibe su credencial y el primer snapshot. Ese snapshot crea su caja en `dbo.registers` («Móvil · <nombre>») y trae el catálogo, el personal con PIN y las existencias.

## Contrato (`electron/local-host/caja-movil.js`)

Rutas con la credencial del dispositivo como Bearer, solo para dispositivos `CAJA_MOVIL`:

| Ruta | Qué hace |
|---|---|
| `POST /api/caja/snapshot` | `sp_catalog_publication`, `sp_staff_publication`, existencias y su caja. Catálogo y personal solo viajan si cambiaron |
| `POST /api/caja/eventos` | Registra cada evento en orden e idempotente (`caja_movil_eventos`) |
| `POST /api/caja/inbox` / `latido` | Por compatibilidad con el motor; no hay otras tablets que bajar |

| Evento de la tablet | SP |
|---|---|
| `SHIFT_OPENED` | `sp_open_shift` en su caja |
| `SALE_RECORDED` | `sp_register_sale` con `client_sale_key` = `sale_uuid` y `payments_json`. Los paquetes y la venta suelta se resuelven igual que en la caja |
| `SALE_REFUNDED` | `sp_refund_sale` |
| `CASH_MOVEMENT_RECORDED` | `sp_register_cash_in` / `sp_register_cash_out` |
| `INVENTORY_MOVEMENT_RECORDED` | `sp_inventory_count_apply` (existencia + diferencia) |
| `SHIFT_CLOSED` | `sp_close_shift` del turno abierto de su caja |

Un rechazo del negocio (`THROW 51000`, `RAISERROR` con mensaje) es `REJECTED`: la tablet lo muestra en Estado y no lo reintenta. Un error técnico es `ERROR`: se reintenta, y los eventos siguientes esperan su turno.

## Licencia

La caja móvil **cuenta como caja** (`registers_max`), no como Pantalla Operativa. Con una licencia de una sola caja, la tablet no puede emparejarse como caja de sucursal mientras la caja de la computadora esté activa. En Venta Esencial no se ofrece.

## Límites conocidos

- La versión web (PWA en HTTPS) no puede hablar con Local Host por HTTP en la red local: el navegador lo bloquea. La caja de sucursal es para la app de Android.
- Aprobación a distancia (Owner) solo existe en modo evento; en sucursal autoriza un encargado con su PIN.
- Clientes, crédito y listas de precio por cliente todavía no se eligen en la tablet.

## Pruebas

- `npm run e2e:caja-movil`: la app real con Local Host y el motor real de la tablet. Cubre emparejar, vender (cobro mixto, paquete, venta suelta), entrada, devolución, corte, reenviar sin duplicar, snapshot sin cambios y revocar.
- `scripts/pruebas/pantallas-operativas.mjs` y `e2e/dispositivos-locales.spec.js`: la función nueva aparece y una pantalla web no puede volverse caja móvil.
