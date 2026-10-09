# Auditoría: lo que dejó Codex sin cerrar (2026-10-08)

Alcance: el trabajo comercial sin commit en `filtros_lubs_rios` (rama `Feature/Fase2-PosMobile`)
y en `wybix-owner` (rama `feature/fase2-pos-mobile`). Aún no se desarrolló nada: esto es el inventario.

## 1. Pruebas ejecutadas

| Prueba | Resultado |
|---|---|
| `test:comercial` | 19/19 |
| `scripts/pruebas/pagos-comprobantes.test.mjs` | 5/5 (no está en `package.json`) |
| `test:ticket` · `test:ui-contract` · `test:ipc` | 43 · 8/8 · contrato completo |
| `test:seguridad` · `test:fase1` | 84/84 · 45/45 |
| BD: check-template, pagos-comprobantes, comercial, turno, egresos, mesas, fase1, 0052, core, servicios | Todas OK |
| BD: `db:test-cajas` | **1 falla de 39** (ver 3.1) |
| E2E `operacion-ofertas.spec.js` · editor de ticket y corte histórico | OK |
| E2E `operacion-ofertas.spec.js` · Touch: mayoreo, pago dividido, posventa | **Falla al final** (ver 3.2) |
| Owner `test:full` | Node 106/106, SQL 84/84 |
| Paridad `shared/comercial.ts` ↔ `packages/domain/src/comercial.ts` | Idénticos |

El "fallo al confirmar la venta" que Codex estaba resolviendo **ya no ocurre**: en el E2E la
venta con pago dividido se registra y aparecen las acciones posventa.

## 2. Estado por funcionalidad

| Funcionalidad | Estado |
|---|---|
| Mayoreo por cantidad (`VOLUME`) | Hecho en el motor, Windows y Mobile (motor compartido); la nube pide actualizar a las tablets viejas |
| Prioridad de descuentos | Hecho (`priority`; una unidad reservada no recibe otra oferta) |
| Ofertas del día en Touch | Hecho: botón lateral que abre el panel en el área del catálogo |
| Pagos mixtos (BD, Touch, Venta, devoluciones, corte) | Hecho. Migración 0054, `sale_payments`, `refund_payments`; editar una venta mixta se bloquea con un mensaje (se corrige con una devolución) |
| Editor de ticket lado a lado, papel personalizado | Hecho (E2E verde) |
| Corte guardado al cerrar, reimpresión e historial | Hecho (E2E verde) |
| Posventa: Ver ticket / Facturar / Correo | Hecho en la interfaz; el correo depende de la función de nube `ticket-email` (**no desplegada**) |
| Bandeja de pedidos de plataformas | **No iniciada**. Hoy solo existe el método de pago `PLATAFORMA`. Ver `AUDITORIA-SISTEMA-DELIVERY-20261007.md` |

## 3. Lo que falta

### 3.1 Limpieza de pruebas rota por las llaves nuevas (bloqueante para las pruebas)
`scripts/db/pruebas/cajas.mjs:253` y `receta-por-variante.mjs:214` borran `sales` y `cash_closures`
sin borrar antes `sale_payments` / `refund_payments` ni soltar `sales.closure_id`.
Solo afecta a scripts de prueba; ningún código de la aplicación borra ventas.

### 3.2 E2E de Touch: selector ambiguo
`e2e/operacion-ofertas.spec.js:195-197` busca el botón "Cerrar" en `app-receipt-email`, pero hay dos
(la X con `aria-label="Cerrar"` y el botón de texto del pie). Es un error de la prueba, no de la app.
Los pasos que siguen (Facturar) no llegaron a ejecutarse.

### 3.3 Cobertura sin conectar
- `pagos-comprobantes.test.mjs` y `scripts/db/pruebas/pagos-comprobantes.mjs` no tienen script en `package.json`.
- Owner: `supabase/tests/comercial.test.sql` prueba `commercial_schema` 1 pero no la compuerta de
  la versión 2 (mayoreo y horarios de combo) de `20261012150000_comercial_volumen_compatibilidad.sql`.
- Owner: `20261012140000_ticket_email.sql` no tiene prueba SQL (sí tiene prueba de la función).

### 3.4 Gates (necesitan autorización, no código)
- Desplegar `ticket-email` y sus migraciones; configurar el secreto de Resend.
- Publicar la versión de Mobile que anuncia `commercial_schema: 2` **antes** de activar mayoreo en
  una sucursal con tablets; si no, las tablets viejas reciben "Actualiza" (409).
- Commit de todo lo anterior (nada tiene commit).

## 4. Simplificaciones posibles (sin quitar nada)

- `receipt-email` y `receipt-viewer` repiten estilos de diálogo inline que ya están en
  `src/styles/dialogo.css`; pueden usar la clase compartida.
- En el diálogo de correo, la X y "Cerrar" hacen lo mismo; basta uno (un paso menos y quita la
  ambigüedad de 3.2). Lo mismo vale revisar en el visor.
- Touch, pago dividido: al elegir un método se precarga con el saldo pendiente; el último método
  podría cubrir el saldo sin teclear (ya ocurre al agregarlo; confirmar que también al editar).

---

## 5. Cierre (2026-10-08)

Hecho:

- **3.1** `cajas.mjs` y `receta-por-variante.mjs` limpian antes `ticket_email_jobs` y `sale_payments`.
  `db:test-cajas` y `db:test-variante`: OK.
- **3.2 y simplificación** Los diálogos de correo y de ver ticket tenían dos botones que cerraban
  (la X y "Cerrar"). Queda solo "Cerrar", junto a la acción principal; Escape sigue cerrando.
  Ambos usan ahora la primitiva compartida `.wx-dialogo` (`src/styles/dialogo.css`) en lugar de
  repetir fondo, borde y color.
- E2E: la descripción del concepto en Facturar es un campo editable; la prueba lee su valor.
  `npm run e2e:comercial`: 2/2.
- **3.3** Nuevos scripts: `test:pagos`, `db:test-pagos`, `e2e:comercial`.
  Owner: `supabase/tests/comercial.test.sql` prueba la compuerta de mayoreo (`commercial_schema` 1 → 409;
  2 → catálogo) y el correo de ticket (sin RPC público, equipo desconocido, reintento ocupado,
  contenido distinto, enviado una sola vez). `probar-fase3.mjs`: 84/84.
- **Supabase (producción `swlpspgmkwzlrowllvvj`)**
  - Migraciones aplicadas: `20261012140000_ticket_email`, `20261012150000_comercial_volumen_compatibilidad`.
  - Funciones desplegadas con `--no-verify-jwt` (se autentican con la credencial del equipo):
    `pos-sync` (acepta `commercial_schema` 2) y `ticket-email` (nueva). Sin credencial responden 401.

Pendiente del dueño:

- Crear los secretos `RESEND_API_KEY` y `TICKET_EMAIL_FROM` (remitente verificado en Resend). Mientras
  no existan, "Correo" responde "Falta configurar el remitente de tickets" (503) y no envía nada.
- Publicar la versión de Mobile con `commercial_schema: 2` antes de activar mayoreo o combos con
  horario en una sucursal con tablets.
- Commit de los dos repositorios.
- Bandeja de pedidos de plataformas: sin iniciar; requiere aprobación aparte.
