# Pago con una parte a crédito (0081)

«El cliente trae $100 y son $150: los otros $50 quedan a crédito.» Funciona en
todos los giros, en las dos cajas:

- **Venta (tienda):** *Dividir pago* → una línea en Efectivo, Tarjeta o
  Transferencia y otra **A crédito**. Aparece el selector de cliente con su
  crédito disponible y el aviso de cuánto se cobra ahora y cuánto queda a crédito.
- **Touch (restaurante, cafetería):** *Dividir pago* → **A crédito**. Usa al
  cliente de la cuenta; si no hay, pide elegirlo. Lo que no se teclea se llena
  solo con lo que falta: se teclean $100 de efectivo y el crédito queda en $50.

## Cómo queda en la base

Es una **venta a crédito con una parte pagada al vender** (enganche), la misma
forma que tiene una venta a crédito después de un abono:

| Campo | Valor |
|---|---|
| `sales.payment_method` | `CREDITO` |
| `sales.paid_amount` | lo cobrado al vender ($100) |
| `sales.balance` | lo fiado ($50); vence a los días de plazo del cliente |
| `sale_payments` | lo cobrado, por su método; lo fiado no es dinero y no va aquí |
| `cash_movements` | la parte en efectivo entra al cajón |

Por eso los abonos, la cobranza, las vencidas, el estado de cuenta y la app del
dueño la ven sin cambios.

## Reglas (las aplica `sp_register_sale`)

- La parte a crédito **necesita al cliente**.
- El **límite** del cliente se mide con lo fiado, no con el total: un cliente
  con $40 de crédito puede llevarse $150 si paga $110.
- Solo una línea a crédito por venta, y los pagos cubren exactamente el total.
- Todo a crédito (un solo pago CREDITO) es la venta a crédito de siempre.

## Devolución, edición y corte

- **Devolución:** primero se cancela lo que el cliente todavía debe; lo demás se
  regresa por los métodos con que pagó al vender, y lo que pagó después en
  abonos, en efectivo.
- **Edición:** como toda venta a crédito con pagos, no se edita: se devuelve.
- **Corte y resumen de la nube:** «Ventas a crédito» cuenta solo lo fiado; el
  enganche ya cuenta en su forma de pago.

## Pruebas

| Prueba | Qué asegura |
|---|---|
| `npm run test:pagos` | `validarPagos` con una parte a crédito |
| `npm run db:test-credito-parcial` | registro, cajón, límite con lo fiado, rechazos sin tocar inventario, abono, edición, devolución, corte y nube |
| `npm run e2e:credito-parcial` | el cobro por la pantalla en Venta y en Touch |
