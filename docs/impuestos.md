# Impuestos además del IVA (0083)

El IVA de cada producto sigue en su ficha (`products.tasa_iva`, `objeto_impuesto`), como siempre. La migración 0083 agrega un **catálogo** de los demás impuestos.

## Qué hay en el catálogo

| Clase | Por | Ejemplos sembrados | Estado inicial |
|---|---|---|---|
| IEPS | tasa | Alimentos no básicos de alta densidad calórica 8% · bebidas alcohólicas hasta 14° 26.5%, de 14° a 20° 30%, más de 20° 53% · energizantes 25% · plaguicidas 9 / 7 / 6% | encendidos |
| IEPS | cuota | Bebidas saborizadas con azúcar ($ por litro) · cigarros ($ por cigarro) | **apagados y sin valor**: la cuota cambia cada año y la captura el negocio |
| IEPS | tasa | Tabacos labrados | apagado, sin tasa (verificar la del año) |
| Local | tasa | Impuesto sobre hospedaje (2–5% según el estado; **fuera de la base del IVA**) | apagado, sin tasa |

- Cada negocio puede agregar los suyos: IEPS o local, por tasa o por cuota.
- Uno sembrado solo deja cambiar su valor, su nota y si está encendido.
- Ninguno se borra: se apaga.
- **Verifica tasas y cuotas con tu contador:** la ley cambia y Wybix no se actualiza solo.

Se administran en **Configuración → Impuestos**, solo con el paquete de administrador (`impuestos:guardar` → `CONFIGURACION_ADMINISTRAR`).

## En el producto

En **Inventario → editar** se ven:

- **Otros impuestos**: se marcan los que lleva el producto. Uno por cuota pide cuánto trae una pieza, por ejemplo 0.6 litros. Necesita `CATALOGO_EDITAR`.
- **Costo sin IVA**: ahora se escribe en la ficha. Solo lo ve y lo cambia quien tiene `VER_COSTOS`; el canal lo vuelve a exigir. La próxima compra lo vuelve a poner. El cambio queda en la bitácora de seguridad.
- El desglose se recalcula mientras se escribe: precio final, sin impuestos, cada impuesto, IVA, costo y ganancia.

## La cuenta

El precio de Wybix **incluye todos los impuestos**. Para un renglón:

```
P = (B·(1 + ΣTasaIEPS) + ΣCuotaIEPS)·(1 + IVA) + B·ΣTasaLocal + ΣCuotaLocal
B = (P − ΣCuotaIEPS·(1+IVA) − ΣCuotaLocal) / ((1 + ΣTasaIEPS)·(1 + IVA) + ΣTasaLocal)
```

El IEPS forma parte de la base del IVA; un impuesto local, no.

Ejemplos (los mismos de `npm run db:test-impuestos`):

| Producto | Precio | Base sin impuestos | Otro impuesto | IVA |
|---|---|---|---|---|
| Papas, IEPS 8% | $58 | $46.30 | IEPS $3.70 | $8.00 |
| 2 refrescos 600 ml, cuota $1.50/L | $40 | $32.68 | IEPS $1.80 | $5.52 |
| Noche de hotel, hospedaje 3% | $1,190 | $1,000.00 | hospedaje $30 | $160 |

## Al vender

`sp_register_sale` y `sp_update_sale` llaman a `sp_venta_impuestos`. Ese procedimiento deja la **foto** de cada renglón con el valor de ese día:

- `sale_detail.base_neta`: el precio sin ningún impuesto.
- `sale_detail.otros_impuestos`: cuánto fue de impuestos además del IVA.
- `sale_detail_impuestos`: el desglose por impuesto.

Cambiar una tasa después no reescribe ventas pasadas. Un producto sin otros impuestos no cambia: `base_neta` queda en NULL y todo se calcula como antes.

La utilidad usa la base sin impuestos, así que el IEPS ya no cuenta como ganancia. Esto aplica en:

- `sp_get_profit_overview`, `sp_get_weekly_profit`, `sp_income_statement` y `sp_cloud_daily_profit`.
- El asistente (`cubo.js`, `finanzas.js`).

## Ticket, factura, corte y sucursales (0085)

- **Ticket:** «IEPS 8% incluido», «IEPS cuota incluido» e «Imp. local 3% incluido» salen antes del IVA (`electron/lib/ticket.js`, con la foto de `sp_get_sale_ticket`).
- **Factura (CFDI):**
  - Por omisión, el IEPS va **dentro** del valor unitario. Es lo que pide la ley cuando no se traslada expresamente: público en general y clientes que no lo acreditan.
  - Si el cliente lo acredita, la factura ofrece «El cliente acredita el IEPS: desglosarlo». El concepto va sin IEPS, con el traslado 003 (Tasa o Cuota) junto al IVA.
  - Un impuesto local (hospedaje) va en el complemento de impuestos locales.
  - La caja manda el desglose **aparte** del concepto de siempre. La nube (`wybix-owner`, `_shared/fiscal.ts`) primero pide a Fiscalapi el cálculo (`/invoices/calculate`, no gasta timbre). Solo desglosa si el total es exactamente lo cobrado; si no, timbra como siempre y lo dice. Una nube sin actualizar ignora el desglose y timbra como siempre.
- **Corte:** el IVA es lo cobrado menos la base sin impuestos y menos los otros impuestos. Los otros impuestos salen aparte: «IEPS y otros impuestos» en el comprobante y `otrosImpuestos` en el corte por correo. Antes, un impuesto local inflaba el IVA.
- **Sucursales:** el catálogo corporativo lleva `taxes` y `product_taxes`.
  - Los sembrados viajan por su clave.
  - Los propios de la matriz llegan como `M_<clave>`, para no pisar los de la sucursal.
  - En la sucursal no se cambian los impuestos de un producto de la matriz.
  - Un catálogo de una matriz sin actualizar no borra nada.

## Lo que todavía no hace

- **Retenciones** (ISR e IVA retenidos, RESICO): dependen del cliente que pide la factura, no del producto. Van en Facturación, no en este catálogo.
- **Pantalla de Venta:** el «IVA» que estima el carrito antes de cobrar no separa el IEPS. El ticket y los reportes sí.

## Pruebas

- `npm run db:test-impuestos` hace 27 comprobaciones contra SQL de verdad:
  - el catálogo;
  - las validaciones;
  - la venta con IEPS por tasa, por cuota y un impuesto local, que suma exactamente lo cobrado;
  - que un producto sin otros impuestos no cambie;
  - la utilidad;
  - que cambiar o apagar un impuesto no reescriba el pasado;
  - el ticket, el folio de la factura y el corte (0085).
- `npm run db:test-multisucursal`: los impuestos viajan de la matriz a la sucursal.
- `wybix-owner`: `supabase/functions/_shared/test/fiscal-ieps.test.ts`, el desglose del CFDI con un Fiscalapi simulado.
- `npx playwright test e2e/impuestos.spec.js` revisa en la app:
  - Configuración → Impuestos;
  - la ficha del producto con costo, IEPS por tasa y por cuota;
  - lo que queda guardado en la base.
