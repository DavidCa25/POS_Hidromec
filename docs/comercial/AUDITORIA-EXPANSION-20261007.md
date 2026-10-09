# Auditoría de nuevas necesidades comerciales y operativas

Fecha: 7 de octubre de 2026. Alcance: Wybix Windows Retail/Touch, contratos compartidos con POS Mobile/Owner y estudio de integración Uber Eats, Rappi y DiDi Food. Repaflash queda expresamente fuera de esta auditoría.

Documento de auditoría y propuesta: no representa funcionalidades implementadas ni integraciones desplegadas. Se revisó el código local y documentación pública oficial; no se hicieron llamadas a comercios ni cambios de datos remotos.

## Hallazgos sobre el estado actual

| Necesidad | Evidencia actual | Falta |
|---|---|---|
| Descuento prioritario | `shared/comercial.ts`: promociones ordenadas por prioridad ascendente; cada unidad reservada por oferta o combo queda bloqueada para otras ofertas. El editor ya expone prioridad. | Definir exclusión por unidad frente a exclusión de toda la cuenta; explicar la regla ganadora y coordinar cupones/premios. |
| Mayoreo por cantidad | Precios por canal y variante ya existen; se resuelven por producto sin mínimo de cantidad. | Mínimo configurable, grupo de productos que cuentan y precio de retorno al quedar debajo del mínimo. |
| Promociones del día | El motor filtra fechas, días, ventanas horarias, canales y elegibilidad. | Ofertas visibles dentro de Venta, actualización al cruzar horarios y consistencia de reloj/zona del negocio. |
| Pago mixto | `Payment`/`SaleIntent` y `sp_register_sale` usan un método por venta. La validación exige que ese pago cubra el total. | Colección de pagos, persistencia, terminal, caja, devoluciones, reportes y sincronización. |
| Ticket de corte | Corte calcula apertura, ventas por método, movimientos y esperado. No se encontró una acción de impresión en `src/venta/appCorte/corte.ts`/`.html`. | Datos congelados del cierre, plantilla, impresión/reimpresión y vista previa. |
| Editor de impresión | Ticket de venta tiene constructor compartido para HTML/PDF. Configuración ofrece rollos de 58/80 mm. | El panel no persiste el tamaño seleccionado; faltan selección de campos y visor de corte. Revisar diferencias de valores predeterminados entre HTML/PDF. |
| Acciones al terminar Touch | Touch ofrece Reimprimir y Listo. Retail tiene Facturar esta venta y Enviar ticket por WhatsApp. | Componente compartido de acciones, PDF/factura/correo en Touch y conservar los datos de la venta cobrada. |
| Correo de tickets | Backend Owner contiene adaptador Resend para notificaciones. La factura acepta correo del receptor. | No equivale a envío de tickets: faltan endpoint, adjunto, destinatario, cola/reintento y estados visibles. Configuración del proveedor/remitente requiere verificación. |
| Plataformas | Canales, precios, folio externo, método PLATAFORMA y ventas por plataforma ya tienen base local. | Integraciones, identificación de tiendas/productos, recepción de órdenes, estados y conciliación. Un canal no es una conexión automática. |

## 1. Promociones, prioridad y acumulación

El bloqueo actual es **por unidad**, no por cuenta completa. Dos ofertas pueden coexistir cuando afectan productos diferentes. Los combos se resuelven antes que las promociones y bloquean sus componentes; la prioridad numérica de una promoción no desplaza automáticamente a un combo.

En Windows, el cupón FREE_PRODUCT sustituye las promociones de la cotización; no se permite en canales distintos de Mostrador ni con combos. Los cupones de porcentaje/importe siguen sin habilitarse en ese camino. Revisar también premios de fidelidad y cualquier ruta de edición/devolución antes de afirmar exclusión universal.

Propuesta:

- Conservar una oferta por unidad como comportamiento predeterminado.
- Añadir una opción explícita «Exclusiva en toda la cuenta» para negocios que necesiten impedir cualquier combinación. Definir orden frente a combos/cupones; no asumir que un valor de prioridad cambia la semántica de un combo.
- Mostrar «Aplicada: Martes de donas» y, cuando corresponda, por qué otra promoción quedó excluida.
- No convertir «prioritario» en «el mayor descuento» automáticamente: son políticas diferentes. La prioridad configurada manda; una política de mejor beneficio sería otra opción.
- Congelar regla, importe y componentes al cobrar; una modificación posterior no altera la devolución histórica.

Casos: 2x1 + estudiante sobre las mismas donas; combo + porcentaje; ofertas sobre productos distintos; empate de prioridad; elegibilidad no confirmada; extras; cupón; devolución parcial.

## 2. Mayoreo por cantidad

Una lista «Mayoreo» por sí sola aplica el precio desde una pieza. No resuelve el requisito nuevo.

Añadir reglas de volumen con mínimo configurable y selector por producto/categoría/variante. Permitir contar varias donas elegibles en la misma cuenta, aunque estén en renglones o sabores distintos. Los cafés, extras y productos ajenos no suman al mínimo. Por defecto, componentes ya reservados en combos no se reutilizan para obtener otra oferta.

Ejemplo ilustrativo, no valor confirmado del cliente: con mínimo 6, 5 donas conservan precio normal; 6 acceden a mayoreo; al quitar una se recalculan las 5 a precio normal. Mostrar «Falta 1 dona para mayoreo». La cantidad real y el precio los configura cada negocio.

Aplicación en el motor compartido y en el proceso principal, no solo en tarjetas. Mantener canales de distribución (Mostrador/Uber/etc.) y condiciones comerciales de volumen como dimensiones distintas. Prever migración/versión de política, catálogo, snapshot Mobile, sincronización y compatibilidad de clientes anteriores.

Casos: mínimo−1/mínimo/mínimo+1; mismo producto en varios renglones; sabores mezclados; variantes; quitar unidades; devolución parcial; servicio por tiempo o cantidades fraccionadas; canal sin precio; interacción con promociones.

## 3. Promociones de hoy dentro de Venta

Añadir un acceso pequeño «Ofertas de hoy» dentro del catálogo, sin aumentar la columna del carrito. Un panel reutiliza las tarjetas de ofertas existentes; permite añadir combos o productos elegibles y explica cantidades y condiciones. No todos los descuentos requieren un botón de aplicación: los automáticos deben seguir cotizándose solos.

Separar «vigente hoy» de «aplicable ahora»: una oferta de estudiante puede estar vigente pero requerir verificación; la de café +10 necesita las donas; la de horario debe mostrar la próxima ventana o su fin. Combos actualmente no tienen fechas/días/horarios en el contrato: deben recibir programación para poder mostrar ofertas temporales de manera coherente.

Hallazgo temporal: Windows cotiza con `GETDATE()` de SQL Server. La firma del carrito no incluye el reloj y el servicio reacciona a cambios del carrito/catálogo; no hay en ese servicio un temporizador de cambio de horario. Debe renovarse la cotización al cruzar una frontera temporal y usar la misma zona del negocio para decidir y presentar condiciones. Revisar el reloj usado por Mobile en el mismo cambio.

Casos: lunes/martes/miércoles; medianoche; ventana de 7:30–10:00 y 19:00–21:00; cuenta abierta sin tocar; cambio de zona/reloj; promoción que vence durante una cuenta; factura y devolución mantienen el precio cobrado.

## 4. Pago mixto

Una compra y un folio, con varios pagos. Ejemplo: total $200, efectivo $80 y tarjeta $120. La venta y el inventario se registran una vez. Solo el efectivo entra al esperado del cajón; tarjeta/transferencia/plataforma tienen sus propios totales.

UI: «Dividir pago» dentro de Cobrar; filas con método e importe; total abonado/saldo pendiente; cambio calculado sobre efectivo. Separar el dinero entregado de la porción de efectivo aplicada a la venta. No dividir artificialmente la venta en dos tickets para simularlo.

Persistencia propuesta: pagos relacionados con la venta, con importe aplicado, método, referencia, estado y dinero recibido/cambio cuando corresponda. Compatibilidad con ventas antiguas de un método. Terminal integrada requiere cobros parciales reales: si una porción falla o el proceso se reinicia, recuperar la referencia y los pagos confirmados sin volver a cobrarlos.

Cambios inseparables: SP de venta, transacciones, IPC, Retail/Touch, POS Mobile, movimientos de caja, corte, devoluciones por método, factura, cloud/outbox y resúmenes Owner. Factura de venta mixta: revisar el adaptador fiscal/PAC antes de elegir automáticamente una forma de pago.

Casos: efectivo+tarjeta; efectivo+transferencia; efectivo con cambio; suma insuficiente/excesiva; pago rechazado; reinicio; doble clic; devolución parcial; corte y reporte; venta sin red. No declarar cobro real de terminal validado por mocks.

## 5. Corte imprimible y editor por campos

La fotografía sirve de referencia funcional: encabezado/turno, caja, ventas por método, impuestos/descuentos, conteos y declaración de cajero. No todos esos datos están disponibles con la misma semántica en Wybix. Los importes de la fotografía son históricos; no se usan como datos del piloto. Las anotaciones manuscritas no se convierten automáticamente en campos.

Propuesta: preset «Compacto» con encabezado, folio/caja, periodo, total vendido y número de ventas. Opciones para incluir desglose por método, fondo inicial, retiros/egresos, devoluciones, esperado, entregado, diferencia, descuentos, impuestos y firma. Los campos elegidos afectan la impresión, no el cálculo ni la auditoría del cierre.

Editor: columnas «Campos» y «Vista previa», selector 58/80 mm, orden de bloques, imprimir prueba y guardar preset. Reutilizar componentes wx; previsualización del mismo HTML que imprime, no una recreación distinta. Mantener versión del formato y datos cerrados para reimpresión consistente. Identificar claramente un reporte previo como «Provisional», separado de un corte cerrado.

Guardar ancho y márgenes efectivos por dispositivo. 58/80 mm es ancho nominal del rollo: el área imprimible depende de impresora/driver. Probar texto largo, números grandes, campos vacíos y cortes de página; queda prueba física en las impresoras del cliente.

## 6. Acciones compartidas después de vender

Componente común para Retail/Touch: Listo/nueva venta como principal, Reimprimir, PDF, Facturar y Enviar por correo como secundarias. Mantener WhatsApp donde ya funciona. Cargar facturación bajo demanda y respetar licencia/permisos; facturar/emails/reimprimir no vuelven a registrar la venta.

Conservar folio, comprador y líneas de la venta final, no el carrito vacío ni una cuenta diferente. Un fallo de impresión/correo no revierte una venta ya cobrada ni muestra un envío como entregado.

## 7. Correo

Supabase y una librería no son alternativas equivalentes: Supabase ejecuta y autentica el backend; Resend es el proveedor que entrega el correo; un SDK solo facilita la llamada.

Propuesta: aprovechar Supabase + Resend existente, con ruta específica para tickets y reutilización de proveedor/estilos. Adjuntar PDF de la venta y, si se solicita una factura ya timbrada, sus archivos correspondientes. La nube verifica negocio/folio y permisos; no confía en importe arbitrario enviado por el navegador. Credenciales de correo solo en backend.

Necesita destinatario confirmado, remitente/dominio verificado, cola con reintentos, deduplicación propia y estado Pendiente/Enviado/Error. Sin red, la venta permanece cobrada y el envío queda pendiente. El adaptador actual de avisos no implementa automáticamente adjuntos de tickets. No reutilizar indiscriminadamente el cron de alertas para enviar comprobantes de clientes.

Resend documenta adjuntos y claves de idempotencia; su ventana de deduplicación no sustituye el registro persistente de Wybix.

## 8. Pedidos de plataformas: auditoría y arquitectura

### Hallazgo

Wybix ya puede capturar manualmente una venta con canal/precio y pago PLATAFORMA. Eso conserva el mismo producto e inventario. No se encontró en los caminos revisados un adaptador que reciba pedidos automáticamente de Uber Eats, Rappi o DiDi Food.

### Conexión propuesta

Plataforma → webhook/backend de Wybix → bandeja durable por negocio/sucursal → caja principal → cuenta/pedido → cocina → estados hacia plataforma. La caja de Windows no necesita aceptar conexiones públicas de Internet. Mantener operación local cuando la conexión se pierde; los pedidos remotos recibidos se recuperan al reconectar.

Cada conexión relaciona tienda externa, empresa/sucursal y canal comercial. Mapear SKU/UUID del producto, variantes, grupos y modificadores; no duplicar productos solo por la plataforma. Persistir proveedor + tienda + pedido externo como identidad única y registrar eventos para tolerar reintentos y mensajes fuera de orden.

Pedidos desconocidos o con productos sin correspondencia van a revisión: no inventar un producto ni cobrarlo con precio genérico. Prever aceptar/rechazar, preparación, listo, cancelación, indisponibilidad de productos y cambios de menú.

El pedido externo trae lo que el cliente ya aceptó pagar. Guardar ese importe, descuentos y responsable de la promoción; no aplicar de nuevo las promociones locales ni recalcular silenciosamente un pedido pagado con la lista actual. Separar venta bruta, cobro de plataforma, comisiones y depósito conciliado. El importe prepagado no entra al cajón; los pedidos con efectivo a recibir por el comercio requieren tratamiento explícito según proveedor. Véase la auditoría complementaria de impresión/plataformas.

### Acceso y documentación

- **Uber Eats:** API Marketplace, OAuth, tiendas/menú y webhooks. La guía exige preparación de acceso/partner y acuerdos, además de sandbox. Candidato inicial por su documentación pública completa. Eso no garantiza acceso comercial de Wybix.
- **Rappi:** documentación oficial de comercios confirma integración directa con su API o mediante un bridge/agregador. Falta obtener el contrato técnico de restaurantes y acceso de partner para México; la documentación Turbo no se asume compatible con restaurantes.
- **DiDi Food:** existe portal oficial de desarrolladores para integración de menú/pedidos. La auditoría complementaria leyó el portal renderizado y verificó módulos de pedidos, firma, ACK y requisitos de piloto. Acceso de partner, disponibilidad regional y aprobación de Wybix siguen sin confirmar.

No se contactó a proveedores ni se activaron tiendas. Repaflash no se investigó. Sin acceso de cada proveedor se puede desarrollar el modelo/bandeja y fixtures, pero no certificar llegada real de pedidos.

## Orden de desarrollo propuesto

1. Política comercial: prioridad/exclusión, volumen y programación; ofertas visibles de hoy. Migración/compatibilidad y pruebas Windows/Mobile en el mismo bloque.
2. Pagos mixtos: contrato, transacciones y caja/reportes/devoluciones primero; interfaz de cobro después sobre ese contrato.
3. Corte imprimible y editor de papel personalizado usando los métodos e importes definitivos del paso anterior.
4. Acciones posventa comunes y envío de correo con backend/proveedor verificados.
5. Bandeja de plataformas y primer adaptador con acceso sandbox; después cada proveedor real.

No dejar migraciones para el final. Cada incremento incluye fuente SQL canónica, migración, ensayo restaurado, permisos/smoke, historial y versión/snapshot cuando cambia nube. No publicar ni desplegar por el mero hecho de terminar esta auditoría.

## Otras funciones que conviene evaluar

- Separar cuenta por producto/comensal: distinta necesidad a pagar una compra con dos métodos. Soft Restaurant Payments documenta división por comensal/grupo.
- Agotados y disponibilidad por canal: aprovecha catálogo/inventario y evita pedidos que cocina no puede preparar.
- Favoritos y accesos rápidos configurables en Touch: acelerar productos frecuentes sin ensanchar el carrito.
- Extender conciliación y motivos de devolución/cancelación sobre los controles ya existentes, en lugar de duplicarlos.

Mesas, cocina/estaciones, modificadores y recetas ya tienen implementación en Wybix: revisar lo existente antes de añadir otra versión de esas capacidades.

## Evidencia y límites

Se ejecutó `npm run test:comercial`: **17/17 correctas**, incluidas exclusión de 2x1/porcentaje, horarios, elegibilidad, combos, redondeos y devolución de componentes. Estas pruebas certifican el motor actual, no mayoreo nuevo, pagos mixtos, impresión física ni conectores futuros.

Archivos revisados: `shared/comercial.ts`, `electron/comercial/servicio.cjs`, `src/core/commercial.service.ts`, `src/core/cart.service.ts`, `src/core/models.ts`, `src/core/sale.service.ts`, `src/touch/touch-pos.html`, `src/venta/appVenta/venta.ts`/`.html`, `src/venta/appCorte/corte.ts`/`.html`, `src/app/ticket-panel/ticket-panel.component.ts`, `electron/lib/ticket.js`, `electron/main.js`, `sql/procedures/sales/sp_register_sale.sql`; adaptador de notificaciones en `wybix-owner/supabase/functions/_shared/notificaciones.ts`.

Fuentes oficiales consultadas el 7 de octubre de 2026:

- Uber: https://developer.uber.com/docs/eats/guides/getting-started
- Webhook Uber: https://developer.uber.com/docs/eats/references/api/webhooks/orders-release
- Rappi: https://merchants.rappi.com/es-mx/-como-funciona-la-integracion-por-pos-en-rappi
- Rappi ayuda: https://help.partners.rappi.com/es/ests-a-un-paso-de-crecer-tus-ventas-integrando-tu-pos-con-rappi-rk1HjWTule
- DiDi Food: https://developer.didi-food.com/ (contenido detallado no accesible mediante extracción estática)
- Resend: https://resend.com/changelog/idempotency-keys
- Adjuntos: https://github.com/resend/resend-openapi/blob/main/resend.yaml
- Soft Restaurant Payments: https://softrestaurant.com/terminal-punto-venta-soft-restaurant-payments
