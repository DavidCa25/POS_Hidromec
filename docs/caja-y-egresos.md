# Control de caja y egresos (migración 0049)

Qué sale del negocio, de dónde sale y cómo aparece en el corte.

## Tres cosas distintas que salen del cajón

| Qué | Ejemplo | Dónde vive | En el corte |
|---|---|---|---|
| **Retiro de caja** | Llevar dinero al banco o al dueño | `cash_movements` (`WITHDRAW`) | Retiros |
| **Pago a proveedor** | Pagar la mercancía | `supplier_payments` + su `SUPPLIER_PAYMENT` | Pagos a proveedores |
| **Egreso** | Renta, luz, un Uber, el pago de la semana | `expenses` + su `EXPENSE` si es efectivo | Egresos, por concepto |

Un retiro **no es un gasto**: el dinero cambia de lugar. Las compras siguen en
su dominio (`purchase`); un egreso es lo que sale y **no** es una compra.

## La regla central de un egreso

- **Efectivo**: exige turno abierto en **esa** caja y deja un `cash_movement`
  negativo `EXPENSE` en ese turno. Todo en una transacción. Baja el efectivo
  esperado. La tabla lo exige también (`CK_expenses_cash`).
- **Transferencia, tarjeta u otro**: se registra el egreso y **no** toca el
  cajón ni el corte.
- Un egreso en efectivo se fecha hoy (sale hoy del cajón). Uno por otro medio
  puede capturarse después con su fecha.

## Pagos al personal

- Es un **egreso** de concepto **«Pago al personal»** (`kind = PERSONAL`,
  concepto del sistema). Una sola fuente de verdad: no hay tabla de nómina.
- La persona es un **usuario** (`users`), la entidad del personal en Wybix.
  No hay tabla de empleados aparte.
- Guarda: persona, monto, fecha, tipo de periodo (**Día**, **Semana**,
  **Otro**), `period_from`/`period_to`, forma de pago, caja si fue efectivo,
  nota, quién lo registró, y el `cash_movement` si salió del cajón.
  - Día sin fechas → el día del pago. Semana sin fechas → lunes a domingo de
    la fecha del pago. Otro → las dos fechas son obligatorias.
- **No es**: nómina fiscal, CFDI de nómina, ISR, IMSS, percepciones ni
  deducciones.

## Conceptos

`expense_categories`: se crean, renombran, activan/desactivan y ordenan desde
**Configuración → Conceptos de egreso**. No se borran: uno con egresos se
desactiva y su historial sigue en los reportes. «Pago al personal» se puede
renombrar pero no desactivar.

## Cancelar un egreso

No se borra: queda `voided_at`, quién y por qué, y deja de contar. Si fue en
efectivo, solo mientras su turno siga abierto: el dinero vuelve al cajón del
mismo turno (`EXPENSE` positivo). Un turno cerrado no se reescribe.

## De qué caja es cada peso

`sp_resolve_cash_register` es la única respuesta, para retiro, abono,
devolución, ajuste de venta, pago a proveedor y egreso:

1. la caja que manda quien llama;
2. la que este equipo tiene arrendada;
3. la del **único** turno abierto de ese usuario (apps viejas);
4. la única caja activa (MonoCaja).

Si nada responde, la operación en efectivo **falla** con un mensaje claro;
nunca cae a «la Caja 1». Con identidad de equipo valida el arriendo, igual
que abrir turno, vender y cerrar.

## El corte

Efectivo esperado = fondo inicial + la suma de **todos** los
`cash_movements` del turno (salvo `OPENING`). `sp_get_cash_movements` y
`sp_close_shift` arman el turno con la misma regla (los amarrados al turno y
los sueltos de **su caja** en su horario), así que lo que muestra el corte es
lo que guarda el cierre.

El desglose lo arma SQL con `cash_movement_types` (grupo y etiqueta de cada
tipo): Ventas, Abonos, Entradas, Retiros, Pagos a proveedores, Egresos (por
concepto), Devoluciones, Ajustes, Otros. La suma del desglose es exactamente
el neto: nada que sume al esperado queda sin explicar.

`typee` tiene llave foránea al catálogo. Un tipo nuevo se agrega al catálogo,
no se inventa en un procedure.

## Permisos

| Acción | Paquete |
|---|---|
| Retiro de caja | `VENTAS_OPERAR` (como siempre) |
| Pago a proveedor | `INVENTARIO_OPERAR` (como siempre) |
| Registrar o cancelar un egreso / pago al personal | `VENTAS_SUPERVISAR` |
| Conceptos de egreso | `CONFIGURACION_ADMINISTRAR` |
| Historial y reportes de egresos | `REPORTES_VER` |

## Pagos fijos (renta, internet, gas…)

En esta versión se registran a mano. Para no capturar lo mismo cada mes, cada
fila del historial tiene **Repetir**: abre el formulario con el mismo concepto,
monto, forma de pago y persona. **Nada se registra sin confirmación.**

Extensión futura, si se necesita: una tabla de plantillas (concepto, monto
sugerido, periodicidad, día) que solo **proponga** el egreso en la pantalla
cuando toque; el registro sigue siendo `sp_register_expense` con la
confirmación de una persona. No hay cuentas por pagar ni automatización
financiera.

## Compatibilidad

- Ninguna fila existente se modifica ni se borra.
- Los tipos de movimiento que ya existían en una base y nadie documentó se
  adoptan en el catálogo como `OTROS` antes de poner la llave foránea.
- Abonos con tarjeta o transferencia registrados **antes** de la 0049 siguen
  en `cash_movements` (así estaban). Solo cuentan en un corte si su turno
  sigue abierto al aplicar la migración; los cortes ya cerrados guardan su
  esperado y no se recalculan.

## Pruebas

`node scripts/db/pruebas/egresos.mjs` (contra SQL de verdad, sobre una
restauración del baseline con todas las migraciones).
