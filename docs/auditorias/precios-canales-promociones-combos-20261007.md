# Auditoría: precios por canal, promociones y combos

Fecha: 7 de octubre de 2026. Auditoría estática de código, contratos y migraciones de filtros_lubs_rios y wybix-owner. Sin cambios de lógica, consultas a datos de producción ni despliegues. Las imágenes de I Do Nut son ejemplos comerciales, no reglas ya autorizadas para activarse.

## Conclusión

Conservar un solo producto y su inventario. Añadir tres conceptos separados: canales/listas de precios, promociones de venta y combos con componentes. No crear una Dona Uber, Dona DiDi y Dona Rappi ni usar modificadores de preparación para representar plataformas.

El precio por canal cambia cuánto se cobra. La receta/variante decide qué se consume. Una promoción cambia el importe de unidades elegibles. Un combo agrupa productos reales; los componentes conservan su inventario y preparación.

## Estado encontrado

1. products.price contiene un precio base. CartLine calcula base + deltas de modificadores; CartService.setPrice permite cambiar el precio de una línea. Venta.onPriceChange registra PRICE_CHANGE. No encontré entidades de listas de precios o canales comerciales configurables.
2. ServiceMode solo admite DINE_IN y TAKEAWAY, tanto en TypeScript como en el CHECK SQL. Para llevar no distingue un pedido de Uber de uno recogido por un cliente. Canal y modalidad de entrega deben ser dimensiones independientes.
3. sp_register_sale consume DIRECT, RECIPE o NONE, congela precios/costos y registra inventario en una transacción. Cuando hay opciones con delta de precio, compara el importe con products.price + deltas: un precio de plataforma o descuento necesita cambiar esta validación, no solo la pantalla. En líneas sin esas opciones se admite el precio enviado por el frontend.
4. Fidelización tiene campañas por producto, importe mínimo, cliente, fecha, día y horario. Su evaluación reparte beneficios después de la venta; no constituye un motor de ofertas automático de la cuenta actual.
5. Cupones/recompensas contemplan FREE_PRODUCT, AMOUNT y PERCENT. sp_coupon_validate devuelve aplicable=1 solo para FREE_PRODUCT. CuponVenta declara que importe y porcentaje no se aplican porque el contrato de venta no maneja descuentos.
6. CuponVenta.aplicar pone a cero unitPrice de una línea, sin separar una unidad cuando qty>1, pero amountApplied guarda un precio unitario. Hay un riesgo de regalar más unidades que las reportadas y de dejar extras de modificadores cobrados. Hallazgo de lectura de código, pendiente de prueba ejecutada.
7. SaleService canjea el cupón después del COMMIT de la venta. Si otra caja lo consume primero, la venta conserva el beneficio y devuelve una advertencia. El canje de una oferta con usos limitados debe reservarse/consumirse atómicamente junto con el cobro local; no heredar este patrón como diseño nuevo.
8. No encontré modelo de combos comerciales con grupos de selección, precio cerrado y exclusiones. Las recetas y modificadores son reutilizables para los componentes, pero no reemplazan un combo comercial.
9. POS Mobile tiene catálogo versionado y precio decidido por dominio: congelarLinea usa price + deltas; registrarVenta no recibe canal, descuentos o combo. sp_catalog_publication publica productos, recetas, modificadores y categorías, sin listas ni promociones. La versión web usa esa misma lógica de POS Mobile.
10. La nube recibe hechos de venta/partidas con precios congelados. Extender solo Windows dejaría Owner/reportes y Mobile sin el contexto necesario.

## Opciones

A. Cambio manual de precio por venta: el POS Windows ya tiene parte del mecanismo. Es un recurso operativo limitado, con auditoría, pero no identifica plataforma, vigencia, oferta, comisión o componentes. No resuelve todo y choca con validaciones de opciones con precio.

B. Listas de precios por canal: cada producto conserva su UUID, receta y existencias; tiene un precio explícito por canal y sucursal cuando corresponda. Adecuado para resolver primero plataformas. Todavía requiere promociones y combos adicionales.

C. Listas de precios + reglas de promoción + combos componibles: recomendación para la necesidad completa. Reutiliza inventario, preparación, fidelización y catálogo. Construye una única política comercial consistente en Windows/Touch/Mobile, con contratos versionados, en lugar de excepciones por giro.

No recomendar duplicar el catálogo por plataforma: fragmenta stock, recetas, cambios de precio y reportes. Una tarifa o regla porcentual puede ser una herramienta administrativa para preparar una lista, pero el cajero debe cobrar precios publicados y verificables. No asumir comisiones universales: dependen de cada acuerdo y sus cargos.

## Diseño propuesto

- Canales: Mostrador, Uber Eats, DiDi Food, Rappi y canales personalizados. Independientes de DINE_IN/TAKEAWAY y de la forma de pago.
- Listas: precio por producto y, cuando sea necesario, variante; alcance de sucursal/canal, vigencia y versión. Política explícita ante precio ausente: heredar base si el administrador lo permite o impedir la venta en ese canal. No cambiar silenciosamente al precio de mostrador.
- Promociones: selector de productos/categorías/variantes, condición de cantidades/importe, beneficio (precio especial, porcentaje, importe, compra N/paga M o producto adicional a precio especial), días, varias ventanas horarias, fechas, sucursales, canales, prioridad, límite de usos y grupos de exclusión. Sin código obligatorio para promociones automáticas. Elegibilidad de descuentos especiales debe confirmarse con permiso y motivo.
- Combos: una oferta comercial con precio y componentes; fijo o grupos elegibles (elige una dona y un café). Cantidades exactas, tamaños, exclusiones, recargos de variantes, componentes obligatorios y sustituciones permitidas. Evitar combos anidados en la primera versión.
- Cálculo: resolver canal/lista, elecciones y extras, evaluar reglas vigentes, aplicar política de acumulación y distribuir ajustes por unidad/componente con decimales exactos. El redondeo debe conservar exactamente el total prometido. No recalcular una venta histórica usando reglas actuales.
- Acumulación: por defecto ofertas no acumulables sobre las mismas unidades; una unidad no participa en dos 2x1/combos. Si existen varias ofertas, usar una prioridad o política explícita de mejor beneficio, con desempate determinista; no confiar en el orden de clics. Cupón y descuento especial también deben participar de esas exclusiones.
- Auditoría: guardar canal, lista/versión, base, extras, beneficio, regla/versión, unidades elegibles, componentes elegidos y actor/autorizador. Tickets muestran combo y ahorro; cocina recibe componentes y sus notas, sin descontar inventario dos veces.
- Reportes: separar venta bruta, descuentos, venta neta por canal y comisión/liquidación real. Una venta pagada por una plataforma no debe incrementar efectivo del cajón si no se recibió ese efectivo. Registrar referencia externa del pedido. No confundir un aumento del precio con ingreso neto después de comisión.
- Devoluciones: devolver lo efectivamente cobrado por componente/unidad con su asignación del descuento; reponer consumos congelados. Definir devolución parcial de combos para evitar devolver a precio normal artículos comprados en oferta.
- Sin conexión: publicar listas/reglas/combos dentro del catálogo versionado de Mobile y usar reloj corregido/zonas horarias existentes. Las reglas locales sin límite global pueden evaluarse offline. Cupones únicos o cupos compartidos entre cajas necesitan conexión/reserva o una restricción explícita; no prometer exclusividad global sin red.
- Ligereza: reglas tipadas y acotadas, índices por producto/categoría/canal, recálculo solo al cambiar la cuenta; nada de un lenguaje arbitrario de fórmulas ni optimización combinatoria sin límite.

## Casos I Do Nut de las imágenes

- Martes: donas con cobertura a $25. Categoría/conjunto de productos y día; confirmar exclusiones y si la oferta aplica a plataformas.
- Frappés 2x1 / café 2x1: por cada par elegible, una unidad con beneficio. Definir si mezcla tamaños, si se bonifica la más barata y si extras quedan fuera. Tres unidades no son tres gratis.
- Miércoles: dona chica $12 y rellena $30. Precio especial por producto/variante y día.
- Jueves: media docena $138. Grupo con seis donas elegibles; stock descuenta las seis elecciones, no una caja ficticia. Definir recargos de sabores premium.
- Combo dona + café: precio cerrado y elecciones permitidas. Las referencias muestran $58 y $59: se necesita decidir cuál es vigente o registrar dos ofertas con distinta vigencia/sucursal. No activar ambas por inferencia.
- Frappé + dona $99: mismo modelo, con tamaños/extras configurados.
- Dos donas + café de olla mediano 12 oz por $10 adicionales: condición compra dos donas elegibles y beneficio sobre el café agregado. Ventanas 07:30–10:00 y 19:00–21:00 en la zona de la sucursal. No es un café gratis ni un precio fijo para toda la cuenta.
- Descuento de 20% a estudiantes/locatarios/servidores públicos: elegibilidad confirmada y exclusión con otras promociones/combos según el cartel; no asumir que todas las plataformas lo permiten.

Los mismos mecanismos sirven para retail (paquetes, compra N/paga M), servicios (servicio + producto), hospitality (menús) y otros giros. Un paquete de servicios debe conservar sus prestaciones; no forzarlo a consumir inventario físico.

## Experiencia propuesta

Venta muestra un selector visible de canal que pertenece a esa cuenta, no a toda la caja. Cambiarlo recalcula y pide confirmar importes; no permite cambiar una comanda enviada silenciosamente. El catálogo muestra el precio vigente y una marca sobria de oferta. Combos son accesos comerciales; abrir uno permite escoger componentes válidos. La cuenta explica base, oferta y total, y permite identificar por qué una promoción no aplica.

Administración: Catálogo → Precios por canal; Catálogo → Combos; Ventas → Promociones, reutilizando componentes de selectores/horarios existentes. El administrador configura reglas con plantillas comprensibles, vista previa y simulador de cuenta antes de publicar. No mezclar la administración de ofertas actuales con rifas o premios futuros.

## Implementación posterior y pruebas necesarias

Modificar contratos canónicos SQL Server + migración nueva, IPC/permisos, carrito/Touch/Retail, ticket/KDS/devoluciones/reportes. Extender publicación de catálogo, dominio TypeScript, SQLite/migraciones locales, hechos de nube/Owner y compatibilidad de versiones. Toda migración de nube se ensaya, aplica y verifica durante el bloque correspondiente; no al final.

Aceptación: un mismo UUID vendido en Mostrador/Uber consume el mismo stock; 2x1 con 2/3/4 unidades y distintos precios; cambio de canal sin arrastrarlo a otra cuenta; seis componentes de media docena; variantes y extras; límites horarios exactos; exclusiones; redondeo del combo; devoluciones parciales; reintentos y dos cajas con un mismo cupón; Mobile offline y sincronización conservando reglas/importe histórico; caja y liquidación por plataforma diferenciadas.

No implementar este alcance como un simple input de precio ni habilitar cupones porcentuales cambiando únicamente aplicable=1.

## Referencias del repositorio

- src/core/models.ts (ServiceMode y AppliedCoupon)
- src/core/cart.service.ts (CartLine.effectiveUnitPrice y setPrice)
- src/venta/appVenta/venta.ts (onPriceChange)
- sql/procedures/sales/sp_register_sale.sql (validación de modificadores/transacción)
- src/loyalty/cupon-venta.ts y sql/procedures/loyalty/sp_coupon_validate.sql (tipos aplicables)
- src/core/sale.service.ts (canje posterior al COMMIT)
- src/core/loyalty.service.ts y sql/procedures/loyalty/sp_loyalty_evaluate_sale.sql (reglas existentes)
- sql/procedures/sync/sp_catalog_publication.sql (contrato publicado)
- wybix-owner/packages/domain/src/venta.ts y packages/database/src/pos.ts (precio/venta offline)
