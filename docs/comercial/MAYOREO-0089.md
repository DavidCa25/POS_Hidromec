# Mayoreo: presentaciones de venta y lista de precios por cliente (0089)

Hay tres formas de cobrar mayoreo. Cada una responde a una pregunta distinta:

| Forma | Pregunta | Dónde se configura |
|---|---|---|
| Presentación de venta | ¿Vendo el cartón como unidad, con su código? | Inventario → ficha del producto → Presentaciones |
| Precio por cantidad | ¿Cuántas piezas lleva, sea quien sea? | Promociones y combos → Precio por cantidad |
| Lista de precios de clientes | ¿Quién compra? | Promociones y combos → Canales, y Clientes → Lista de precios |

Las tres se resuelven en la misma cotización comercial (`shared/comercial.ts` y
`electron/comercial/servicio.cjs`). `sp_register_sale` vuelve a comprobar lo que
la pantalla no puede garantizar.

## Presentación de venta (el cartón)

`product_presentations` ya servía para comprar: «Cartón 24» entraba al
inventario como 24 piezas. La 0089 le agrega dos columnas:

- `bar_code`: el código impreso en el cartón. Es único y no puede repetir el
  código de un producto.
- `sale_price`: el precio del cartón completo. Si está en NULL, la presentación
  no se vende, solo se compra.

Para venderse, el contenido es un número entero de piezas, de 2 a 1000
(`CK_product_presentations_venta`).

**En la caja (Retail).** Escanear el código del cartón agrega 24 piezas del
producto en una línea «Producto · Cartón 24». Con +/−, la línea sube o baja un
cartón entero. Una cantidad tecleada se redondea a cartones completos. Las
piezas sueltas del mismo producto van en otra línea.

**Precio.** La caja manda solo `presentationId`. La cotización lee de la base
el precio, el contenido y si la presentación sigue a la venta, y pasa al motor
`pack: { id, name, qty, price }`. El motor:

- reparte el precio del cartón entre sus piezas; el centavo que no divide
  exacto queda en la última pieza de cada cartón. Por ejemplo, $380 / 24
  queda en 23 × $15.83 + 1 × $15.91, y $384 / 24 en un solo renglón;
- bloquea esas piezas, así que ninguna promoción ni combo se aplica encima;
- deja el bruto a precio de pieza, para que el ahorro se vea como descuento.
  Si el cartón cuesta más que las piezas sueltas, no muestra descuento negativo.

**Registro.** `sale_detail` guarda piezas, no cartones. Existencias,
devoluciones, reportes y factura funcionan igual que siempre. La nota del
renglón lleva el nombre de la presentación, para que el ticket diga
«Cartón 24». Si el precio del cartón cambia o la presentación se da de baja
entre cotizar y cobrar, el cobro se detiene: el payload trae
`presentations: [{ id, price }]`.

## Lista de precios de clientes

Un canal comercial también funciona como lista de precios.
`customers.price_channel` guarda la lista que paga un cliente. Al asignarlo a
la cuenta (`CartService.setCustomer`), la caja cambia a ese canal. Si se quita
el cliente, la cuenta regresa a Mostrador, pero solo cuando el canal lo había
puesto el cliente. Un canal elegido a mano no se toca.

Un canal marcado **«Lista de precios de clientes»** (`customersOnly`):

- no aparece en el selector de canal de la caja;
- solo se cotiza con `priceCustomerId` de un cliente activo que tenga
  asignada esa lista. La cotización guarda `priceCustomerId`;
- solo se cobra si la venta es de ese mismo cliente. Si no, `sp_register_sale`
  responde: «Esos precios son de la lista de otro cliente».

La lista se asigna en Clientes con el permiso `COMERCIAL_ADMINISTRAR`, por el
canal `commercial:customer-price-list`, que llama a
`sp_customer_price_list_set`. Mostrador (`LOCAL`) equivale a «sin lista».

## Pruebas

- `npm run test:comercial`: el motor (cartón, reparto del centavo, bloqueo de
  ofertas y validación de `customersOnly`).
- `npm run db:test-mayoreo`: la migración, la ficha, la cotización real contra
  la base, el cobro, el precio cambiado y la lista de clientes (23
  comprobaciones).
- `npm run e2e:mayoreo`: en la app, escanear dos cartones y una pieza ($420,
  25 piezas) y la tiendita con su lista ($17 la pieza, venta a su nombre).

## Fuera de alcance

- **Touch.** El escáner de Touch todavía no reconoce códigos de cartón.
- **Copia móvil.** La copia de `shared/comercial.ts` del dominio móvil no conoce
  `pack` ni `customersOnly`. Ambos son opcionales: una política que no los usa
  sigue siendo idéntica.
