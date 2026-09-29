# Licenciamiento V2: QA manual en staging

**Estado: STAGING REQUIRED.** La web, el checkout y `/licencia` están
probados en local con un PostgREST mínimo sobre Postgres 17: 120 pruebas,
incluido el rollout por HTTP con los manejadores reales. Lo que **no** se
puede probar sin desplegar se hace aquí:

- el navegador contra Supabase real;
- PayPal sandbox de verdad;
- el correo;
- el POS instalado activando contra el servidor.

**No se ejecuta en producción.** Todo con PayPal **sandbox**: las licencias
que salgan quedan con `origin = TEST` y no cuentan como clientes.

## Preparación

| # | Qué | Cómo |
| --- | --- | --- |
| 0.1 | Proyecto Supabase de **staging**, no el de producción | `supabase link --project-ref <staging>` |
| 0.2 | Clave de firma de staging (KID propio, p. ej. `wybix-lic-900`) | Ceremonia de `wybix-owner/docs/licenciamiento-despliegue.md` con salida fuera del repo. **Nunca** la de producción. |
| 0.3 | Secretos | `LICENSE_SIGNING_KEY`, `LICENSE_SIGNING_KID`, `LICENSE_PUBLIC_KEYS` |
| 0.4 | PARTE A + funciones | `license-check`, `trial-license`, `pos-sync` |
| 0.5 | Web en un preview de Vercel | `SUPABASE_URL`/`SUPABASE_ANON_KEY` del staging; PayPal **sandbox** (`PAYPAL_ENV` ≠ `live`) |
| 0.6 | POS de QA sin empaquetar | La pública de staging en `PRODUCCION` solo en esa copia local, sin commitear, o como clave extra de QA |
| 0.7 | Un equipo o VM limpio y otro con datos | Para activar, liberar y reactivar |

## Recorrido

Cada paso tiene un resultado esperado. Anotar **PASS / FAIL** y evidencia
(captura o consulta).

| # | Paso | Esperado |
| --- | --- | --- |
| A | Abrir la web (preview) | Precios de MonoCaja **$2,499** y MultiCaja **$3,999** tomados del catálogo. `index.html` (ver código fuente) trae los mismos en schema.org. Productos sin precio: «por anunciar». |
| B | Seleccionar **MonoCaja** | El carrito muestra $2,499 + IVA. |
| C | Elegir giro **Para Comercios** | Seleccionado en el checkout. |
| D | Checkout | «Confirmando el precio…» y después el total **del servidor**, $2,898.84. Con la red al catálogo cortada, **no aparece PayPal** y sale el aviso; nunca se cobra un total adivinado. |
| E | Pago de prueba con cuenta **sandbox** | PayPal captura (COMPLETED). |
| F | Emitir licencia | Aparece la clave. En la base, `license_create_from_order` creó la licencia con `origin = TEST`, giro COMMERCE, compras al precio del catálogo y el evento `LICENSE_CREATED`. Correo recibido. |
| G | Descargar `.wybix-license` en `/licencia` | Primero se activa el equipo (H). Después, con clave y código del equipo, se descarga el archivo. Clave o código incorrectos: mensaje claro, sin archivo. |
| H | Activar el POS con la clave | Queda activado. |
| I | Confirmar ACTIVE | Panel de licencia: «Licencia activa», MonoCaja, giro Comercios. Si la licencia es de pruebas, lo dice. |
| J | Sin Internet | Desconectar la red: vende, cobra, imprime, turno. Ningún aviso bloqueante. |
| K | Local Host respeta la cuota | Emparejar 3 Pantallas Operativas de Comercio (inventario de piso): entran. La 4.ª se rechaza con «tu plan incluye hasta 3…». Revocar una libera el lugar. |
| L | Desvincular el equipo | Configuración → Licencia → liberar. El servidor registra `DEVICE_UNBOUND`. |
| M | Reactivar | En el mismo equipo u otro: activa (MonoCaja = 1 equipo a la vez). |
| N | Importar licencia desde archivo | Importar el `.wybix-license` de G: aplica. Un archivo editado a mano, de otro equipo o más viejo: rechazo sin tocar la licencia actual. |
| O | Trial: giro correcto | Equipo limpio → «Probar gratis» → en el alta elegir **Restaurantes y Cafeterías**. El certificado de prueba trae SOLO ese giro y 3 pantallas de ese giro; Servicios y Comercio no aparecen. Evento `TRIAL_VERTICAL_SELECTED`. |
| P | Cambio Mono → Multi de prueba | `select license_upgrade_to_multi('<id>', '{"price_paid":0,"provider":"MANUAL","ref":"QA-UP"}', 'qa')`. Tras «Actualizar licencia», el POS es MultiCaja y activa una segunda caja. |
| Q | Grace simulado | **En staging**: marcar los periodos vigentes `status = 'CANCELLED'` e insertar uno `MANUAL` que terminó hace 10 días. Refrescar: `GRACE`, «Tu suscripción venció. Te quedan N días». Todo funciona. |
| R | Sale Only simulado | Periodo vencido hace 50 días y refrescar: **Venta Esencial**. Vende y cobra; inventario, compras, mesas y pantallas en pausa. Vender un producto sin existencia no descuenta. |
| S | Renovar | `select license_renew('<id>', 'MANUAL', '{"days":30,"provider":"MANUAL","ref":"QA-REN"}', 'qa')` y refrescar: ACTIVE de inmediato, sin reinstalar. |
| T | Aviso de inventario | Tras S, el POS muestra el aviso de revisar el inventario con las fechas del periodo en Venta Esencial y el número de ventas. |

## Además, antes de producción

- `select * from license_review_queue` en staging: solo lo esperado.
- Cambio de precio de prueba **en staging**:
  1. `select license_catalog_update('EXTRA_CFDI_100', '{"list_price": 275}', 'QA staging', 'qa')`;
  2. el checkout cobra $275 sin recompilar;
  3. la compra de F conserva su precio;
  4. `license_catalog_price_periods` muestra ambos periodos;
  5. revertir.
- Licencia sin firma (formato anterior) en el POS nuevo: «Esta licencia necesita actualizarse.», con «Actualizar licencia» e «Importar archivo». Sin pantalla blanca ni errores técnicos.
- Instalador (cuando toque): `npm run dist` se detiene si `PRODUCCION` no tiene la clave de producción.
