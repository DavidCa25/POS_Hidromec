# Auditoría · Compras que aprenden

Fecha: 2026-11-24 · Rama: `feat/vista-negocio-recetas` · Migración: 0092

## La pregunta

¿Cómo hacemos que Wybix sea más listo conforme se registran compras? Cada
compra deja datos (proveedor, presentación, costo, ganancia, cantidad, fecha).
Hoy se usan casi solo para escribir `products.cost` y `products.price`, y el
resto se queda guardado sin trabajar.

## Lo que ya aprende hoy

| Qué | Dónde | Límite |
|---|---|---|
| Qué producto es cada renglón del ticket de un proveedor | `supplier_item_aliases` (0077), `compras-doc:aprender` | Solo con ticket subido. Capturar a mano no enseña nada. |
| Último costo por unidad base | `products.cost` (`sp_register_purchase`) | Un solo número: no se sabe de qué proveedor ni si subió. |
| Ritmo de venta para el reorden | `sp_reorder_suggestions` | Divide entre 30 días aunque el producto haya estado agotado o sea nuevo: pide de menos justo lo que más se vende. |
| Pedido por proveedor | `sp_purchase_order_suggestions` (0090) | Proveedor y presentación salen solo de lo configurado a mano (`is_default`). Si nunca se ligó, sale en «Sin proveedor» aunque se le haya comprado 20 veces. Cubre 7 días fijos sin importar cada cuánto viene el proveedor. |

## Hallazgos

### H1 · Capturar a mano no aprovecha la compra anterior
Al agregar «Cerveza clara» a una compra de Modelo, la línea nace con:
- la presentación `is_default`, aunque a ese proveedor siempre se le compre en
  «Cartón 24»;
- precio de compra 0;
- la ganancia calculada del precio actual, no la que la persona fijó la última vez.

Fue el origen del error de los $54: la presentación y el precio había que
escribirlos cada vez y es fácil equivocarse.

### H2 · Nadie avisa cuando el costo sube
`sp_register_purchase` reescribe el costo y el precio de la pieza, pero:
- el precio de los **paquetes de venta** (`product_presentations.sale_price`,
  0089) no se toca: el six de refresco puede quedar por debajo del costo sin
  que nadie lo note;
- un precio editado a mano en Inventario puede quedar por debajo de
  costo + IVA;
- una subida del 10 % de un proveedor no se ve hasta que alguien compara
  tickets a mano.

### H3 · Otro proveedor lo da más barato y no se sabe
Si el mismo producto se compra a dos proveedores, la diferencia está en
`purchase_detail`, pero ninguna pantalla la muestra.

### H4 · El pedido sugerido ignora el historial
- **Agotados:** un producto agotado 12 de los últimos 30 días vende en 18 días
  lo que se divide entre 30. Su ritmo sale 40 % bajo y el pedido también.
- **Productos nuevos:** pasa lo mismo con uno dado de alta hace 10 días.
- **Proveedor y presentación:** salen solo de la configuración manual.
- **Ciclo del proveedor:** si viene cada 10 días, pedir para 7 deja 3 días sin
  producto.
- **Tiempo de entrega:** no se mide; el pedido enviado por WhatsApp no deja
  registro.

### H5 · Un error de captura entra sin aviso
Capturar 240 cartones en vez de 24, o $4,800 en vez de $480, se registra sin
pregunta. Infla el inventario o el costo, y como el precio de venta se
recalcula con ese costo, la caja vende a un precio absurdo desde ese momento.

## Cambios (todos en 0092)

### C1 · Memoria de compra por proveedor · `sp_compra_memoria`
Por producto, con lo que se le compró a ESTE proveedor (si nunca se le compró,
con lo de cualquier proveedor):
- última presentación, precio de esa presentación, costo por pieza y fecha;
- última ganancia fijada (> 0);
- cantidad típica y máxima en piezas (últimas 6 compras) y cuántas compras hay;
- el proveedor más barato de los últimos 90 días, si es al menos 3 % más
  barato.

En **Registrar compra**, al agregar un producto:
- la línea nace con la presentación, el precio y la ganancia de la última
  compra;
- abajo dice «Última compra: $480 por Cartón 24 · 12 nov»;
- si otro proveedor lo dio más barato: «Con Distribuidora B costó $18.50 por
  pza (8 % menos) · 3 nov».

Al cambiar de proveedor, las líneas que no se han tocado se vuelven a llenar.

### C2 · Revisión antes de registrar · `shared/compra-memoria.ts`
Función pura y probada en node. Antes de guardar avisa:
- cantidad en piezas mayor a 3× la típica y a 1.5× la máxima (con ≥ 2 compras
  previas);
- costo por pieza 35 % arriba o abajo del último.

Decide la persona con «Corregir» o «Está bien, registrar». No bloquea.

### C3 · Alerta «Costos y márgenes» · `sp_alertas_costos`
Nueva categoría en Alertas, con tres tipos:
- **Vende con pérdida:** precio de la pieza menor a costo + IVA. Crítica.
- **Paquete bajo costo:** el precio por pieza de una presentación de venta es
  menor a costo + IVA. Crítica.
- **Subió el costo:** entre las dos últimas compras el costo por pieza subió
  ≥ 5 % (últimos 60 días), con proveedor y porcentaje. Informativa.

### C4 · Pedido sugerido con memoria · `sp_purchase_order_suggestions`
- **Ritmo por días con existencia:** se descuentan los días agotado (desde la
  última salida si hoy no hay) y los días antes de su primera entrada. Mínimo
  7 días, para no exagerar con un producto de 2 días.
- **Proveedor aprendido:** si no hay proveedor ligado, el de la última compra.
- **Presentación aprendida:** la de la última compra gana a `is_default`.
- **Costo:** el de la última compra a ese proveedor.
- **Ciclo del proveedor:** días promedio entre compras (con ≥ 3 en 120 días).
  El pedido cubre lo que tarde en volver, no 7 días fijos, y entran los
  productos que se acaban antes de su próxima visita.
- **Tiempo de entrega:** nueva tabla `purchase_order_sent`. Al mandar o
  copiar el pedido se anota la fecha, y la compra que llega después (≤ 14 días)
  mide cuánto tardó. El pedido suma esos días.

En Alertas, el pedido de cada proveedor dice: «Le compras cada ~7 días ·
tarda 2 días en llegar · próxima compra: mar 2 dic».

## Lo que NO se hace
- Nada de IA externa: son reglas sobre el historial y funcionan desde la
  segunda o tercera compra.
- No se cambia ningún precio solo. Se avisa y decide la persona.
- `sp_reorder_suggestions` (la lista de reorden de Alertas) no cambia: el
  ritmo corregido vive en el pedido.

## Pruebas
- `npm run test:compra-memoria`: avisos de cantidad y costo, textos.
- e2e `abarrotes`: memoria de compra (presentación, precio y ganancia de la
  última compra), aviso de captura de 10× y alerta de paquete bajo costo.
