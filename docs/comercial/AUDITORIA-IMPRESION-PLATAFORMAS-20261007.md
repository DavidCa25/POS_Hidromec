# Impresión configurable, pagos y pedidos de plataformas

Fecha: 7 de octubre de 2026. Complementa y actualiza `AUDITORIA-EXPANSION-20261007.md`. Este documento describe evidencia y diseño propuesto; no certifica hardware ni conexiones de producción. Repaflash fuera de alcance.

## Conclusiones de código

- Windows imprime HTML mediante Electron y las impresoras instaladas en el sistema (`electron/lib/imprimir-html.js`). El motor admite dimensiones personalizadas, pero la interfaz de configuración y la interpretación en `electron/main.js` limitan el recorrido a 58/80 mm. El panel no persiste correctamente el ancho seleccionado. No basta añadir más botones de medidas.
- `src/app/ticket-panel/ticket-panel.component.ts` configura impresora, pero no ofrece selección/orden de campos ni editor de corte. `src/venta/appCorte/corte.ts` calcula el corte; falta conectarlo a una plantilla e impresión/reimpresión.
- POS Mobile Android: `lib/impresion.ts` ofrece TCP local ESC/POS y servicio de impresión del sistema. Bluetooth directo no está implementado. Red y sistema son recorridos distintos, con capacidades diferentes.
- `lib/escpos.ts` usa columnas de caracteres y HTML de ancho fijo. Ambos deben recibir el mismo perfil de papel para que el visor y la impresión coincidan. USB/Windows o Wi-Fi no implica por sí solo ESC/POS.
- La PWA usa diálogo de impresión del navegador (`lib/impresion.web.ts`); no tiene el recorrido TCP nativo. No promete impresión silenciosa ni confirmación física automática. En iOS hay que validar AirPrint o el SDK/protocolo del modelo elegido.
- Windows guarda un método de pago por venta. Mobile ya acepta arreglos de pagos en su contrato y ticket, pero `app/caja/vender.tsx` selecciona un método y envía un arreglo de un elemento con el total. Tener un arreglo no significa que el cliente pueda dividir el pago desde la interfaz.

## Papel: un perfil, no una lista cerrada

Separar tipo de soporte, ancho nominal, ancho imprimible, margen, alto y capacidades del dispositivo. «70×80» puede describir ancho y diámetro de rollo o ancho y alto de etiqueta/hoja: el diámetro no es el alto del ticket.

| Perfil | Configuración propuesta | Validación necesaria |
|---|---|---|
| Rollo continuo | Presets 58, 70, 76, 80 y 112 mm; ancho personalizado; largo automático | Ancho admitido por el modelo, área imprimible y cortador |
| Hoja | A4, Carta, medida personalizada y orientación | Papel y márgenes admitidos por el controlador; paginación |
| Etiqueta | Ancho × alto fijo, por ejemplo 70×80 mm | Protocolo/controlador, sensor, separación y límites; no tratar ZPL/TSPL como ESC/POS |
| Formato personalizado | Medidas en mm y perfil por impresora | No ofrecer impresión si excede las capacidades verificadas |

Los presets son propuestas de interfaz, no una afirmación de soporte universal. Guardar resolución cuando se rasteriza, columnas cuando se usa ESC/POS textual, ancho imprimible, escalado y tipo de corte. Permitir impresoras distintas para ticket, corte y cocina. No cambiar datos contables al cambiar plantilla.

## Impresoras y conexiones

| Conexión | Windows | Android | Web/iOS | Trabajo pendiente |
|---|---|---|---|---|
| USB | Mediante impresora/controlador del sistema | Servicio de impresión si el dispositivo/controlador lo permite; USB directo requiere adaptador propio | Diálogo del sistema según plataforma | Enumeración, permisos y prueba por modelo |
| Wi-Fi/Ethernet | Impresora instalada en Windows; TCP directo sería otro recorrido | TCP ESC/POS existente o servicio de impresión | Impresión del sistema; sin socket TCP nativo en PWA | IP/puerto, prueba, timeout y aislamiento de errores |
| Bluetooth | Solo si hay controlador/puerto del sistema compatible; transporte directo pendiente | Transporte directo pendiente | Depende de plataforma/modelo; no asumir acceso universal desde navegador | SPP/BLE según modelo, permisos Android, reconexión y pruebas físicas |
| Sistema/AirPrint | Impresoras instaladas | Servicio de impresión y complementos compatibles | Diálogo de navegador/iOS e impresora compatible | Verificar modelo y capacidades reales |

No usar un selector que haga parecer operativa una conexión aún no implementada. Mostrar «Compatible», «Requiere configuración» o «No disponible en este dispositivo» a partir de capacidades reales. Bluetooth BLE y Bluetooth SPP no son equivalentes.

Definir trabajos de impresión durables con documento/folio, plantilla y perfil congelados, estado pendiente/enviado/error y reintento explícito. Enviado al spooler/socket no equivale a papel confirmado. Una reimpresión no genera otra venta ni otro corte; distinguir original/copia y registrar errores sin revertir cobros.

## Campos y visor antes/después de guardar

Propuesta recomendada: editor lado a lado. Lista de campos a la izquierda; ticket a la derecha; papel e impresora bajo una acción secundaria. Alternativas: edición sobre el ticket y asistente por pasos.

Campos de corte: identidad/turno, ventas/total, desglose de pagos, fondo/entradas/retiros, descuentos, devoluciones, impuestos, declaración/diferencias y firmas. Plantilla inicial sencilla para I Do Nut: identidad, ventas y total. El negocio activa el resto y puede ordenar bloques. Para venta, usar campos correspondientes a esa venta; no reutilizar totales de cierre.

Guardar plantilla versionada por negocio y tipo de documento. El visor distingue borrador y última versión guardada; guardar no es imprimir. Reabrir debe recuperar los campos y medidas. El renderizador usado para el visor, PDF e impresión debe compartir estructura y reglas de ajuste. Separar la plantilla de los datos congelados del corte; una reimpresión histórica conserva cantidades reales.

En alto fijo: paginar o bloquear cuando no quepa, sin cortar campos silenciosamente. El visor debe representar saltos de página y área imprimible. El concepto actual advierte desbordamiento, pero no implementa paginación física. Prever nombres largos, valores negativos, totales grandes y anchos pequeños.

## Punto de venta: tres conceptos

1. **Barra contextual:** Ofertas de hoy y Pedidos junto al catálogo. Acciones abre caja/funciones secundarias. Cliente y precio conservan filas compactas; carrito libre. Recomendado por menor cambio al flujo existente.
2. **Panel de acciones:** tres accesos laterales Ofertas/Pedidos/Caja. Abre el contenido en el área de catálogo, conservando la cuenta visible.
3. **Navegación por tareas:** Productos/Ofertas/Pedidos/Caja cambian la zona central. Cuenta permanece en el costado; útil si cocina/pedidos se vuelven frecuentes.

En los tres, Dividir pago pertenece a Cobrar y factura/correo/reimpresión aparecen tras el cobro. No llenar una cuadrícula permanente con cada función disponible. Mantener teclado, permisos y disponibilidad sin depender del hover.

## Pago mixto

Una venta y un folio; varias filas de método/importe aplicado. Efectivo recibido separado de efectivo aplicado, cambio solo sobre efectivo. Ejemplo del concepto: total $200, efectivo aplicado $80, recibido $100, tarjeta $120, cambio $20. Suma aplicada exacta al centavo; rechazar negativos, saldo pendiente, exceso y recibido insuficiente.

El concepto demuestra la interfaz; no cobra. Desarrollo real incluye tablas/procedimientos Windows, validación transaccional, contrato Mobile, corte/reportes, devoluciones por pago, sincronización y compatibilidad histórica. Una terminal integrada exige estado/referencia de cada cobro: si tarjeta fue aprobada y se reinicia el POS, no volver a cobrarla. El botón de confirmar no puede ejecutar dos veces la misma venta. Reservas, stock y factura pertenecen a la venta única.

## Integraciones: estado comprobado

Las listas de precios sirven para cotizar/capturar manualmente el canal. No reciben órdenes, autorizan tiendas ni transmiten estados. No se encontró integración automática de estos tres proveedores en los recorridos auditados. Evitar prometer una conexión lista por el hecho de tener un canal.

| Proveedor | Evidencia oficial | Requisitos y límites |
|---|---|---|
| Uber Eats Marketplace | Órdenes por webhook, consulta de detalle, aceptar/rechazar, tiempos de preparación, incidencias y conciliación. OAuth y acceso sujeto a aprobación. | Solicitar acceso/scopes, sandbox, tienda de prueba y proceso de salida a producción. Uber Direct es reparto, no sustituye Marketplace. Confirmar deadlines del contrato seleccionado. |
| DiDi Food Open Platform | Portal público renderizado: módulos de autorización, tienda, menú, stock, pedidos; eventos de nuevo/cancelado/completado, entrega, solicitud de cancelación/reembolso y cancelación parcial. | Negociación, NDA, calificación de partner, app/tienda de prueba, QA, piloto y producción. Una tienda solo se vincula a una app de producción. No se cambió una conexión existente. |
| Rappi restaurantes | Página oficial México confirma API directa o agregador, menú, disponibilidad, pedidos y estados. Describe credenciales/tokens y sandbox. | Falta contrato técnico de restaurantes/partner para Wybix y México. No asumir que las APIs Turbo son la API de restaurantes. Autenticación exacta, firma, plazos, estados y payload necesitan documentación de partner. |
| Agregador, p. ej. Deliverect | Documenta normalización de pedidos de canales y entrega al POS por webhook. | Sigue requiriendo integración/certificación POS, mapeo, estados y pruebas. Confirmar cobertura de cada canal en México, contrato, coste, soporte y capacidades. No equivale a instalar un complemento sin desarrollo. |

### Hallazgos específicos de DiDi

- IDs de app, tienda y pedido de 64 bits: no usar `Number` ni `JSON.parse` sin preservación de enteros grandes. Conservar identidad como texto/entero exacto desde el cuerpo original, incluidos registros de deduplicación.
- Firma de callback documentada en `didi-header-sign`: MD5 de cuerpo crudo concatenado con secreto de app. Implementar el contrato específico, no copiar HMAC de Uber. Verificar antes de procesar; comparación constante, HTTPS, protección de secretos y control de replays. No registrar cuerpo completo con datos personales en logs generales.
- Callback con límite de seis segundos; respuesta JSON con `errno: 0` evita reenvíos. Guardar duraderamente el evento antes de responder; procesar después. Responder correctamente al callback no equivale a confirmar comercialmente el pedido.
- El módulo de pedidos expone consulta de detalle, confirmación, cancelación, aceptar/rechazar solicitud de cancelación/reembolso, listo y entregado. Gestionar todos los estados relevantes, incluida cancelación parcial; no reducirlo a Nuevo/Listo.
- Checklist de producción incluye precios/promociones, tokens/renovación, entrega propia/DiDi y efectivo si la tienda lo acepta (`shop_paid_money`). No clasificar automáticamente todo pedido DiDi como pagado fuera de caja.
- Una sola app de producción por tienda: comprobar si Soft Restaurant u otro integrador ya está conectado antes del piloto y planear cambio coordinado. No desvincular durante esta auditoría.

### Uber: dinero y eventos

Validar la firma HMAC-SHA256 del cuerpo crudo mediante el secreto y el header del contrato de webhook. Consultar el pedido completo y preservar líneas, modificadores, instrucciones y precios finales. La guía actual incluye resolver faltantes y recibir actualización del pedido; aceptar/rechazar no cubre todo el ciclo.

El detalle documenta descuentos y financiación de promociones (`promo_funding_splits`); distinguir quién los financia. También contempla `cash_amount_due` en ciertos pedidos de entrega del comercio. No sumar al cajón dinero cobrado por la plataforma/repartidor; sí reconocer el efectivo que realmente recibe el negocio según el pedido. Los importes y disponibilidades exactos dependen del contrato habilitado.

### Arquitectura recomendada para Wybix

Proveedor → backend público autenticado por firma → inbox durable por empresa/sucursal → conexión de caja principal → pedido local → cocina/venta → outbox de estados → proveedor.

1. Guardar conexión de tienda externa a empresa/sucursal/canal; credenciales solamente en backend. Autorizar comercio y revocar por tienda. Nunca aceptar `company_id` arbitrario del callback.
2. Identidad única proveedor+tienda+pedido, y eventos identificados/deduplicados por contrato. Folio visible para repartidor separado del ID técnico.
3. Mapear producto/variante/modificador por IDs externos estables. Si no hay mapeo, mandar a revisión/rechazo según tiempo disponible; no crear productos genéricos automáticamente.
4. Guardar snapshot externo de importes, impuestos, descuentos y financiación. Las ofertas locales y el mayoreo no se aplican otra vez a lo aceptado en la plataforma. Precios por canal alimentan publicación de menú, no reescriben pedidos históricos.
5. Máquina de estados por proveedor: recibido/pendiente de aceptación/aceptado/preparación/listo/entregado/cancelado, con estados de solicitud y parcial cuando existan. No inferir transiciones solo por la llegada de callbacks.
6. Stock/recetas se afectan una sola vez. Definir reserva y liberación; cancelar después de preparación no devuelve automáticamente ingredientes consumidos.
7. ACK de transporte después de persistir; confirmación comercial después de verificar caja/capacidad. Si el POS está desconectado, no aceptar indefinidamente esperando su regreso. Reconciliar tras reconexión sin duplicar tickets.
8. Cola de estados salientes con reintentos y consulta/reconciliación cuando hay timeout ambiguo. No imprimir dos comandas por callback repetido. Impresión fallida aparece en bandeja para reintentar.
9. Conciliar venta bruta, cobro por responsable, descuentos financiados, comisión y depósito. Comisión configurable/contratada, no porcentaje universal ni fórmula fiscal inferida.
10. Separar permisos de conexión, aceptación, cancelación, reembolso y configuración. Proteger datos de cliente/repartidor y retención de payloads; consultas entre empresas prohibidas.

Tablas propuestas (a diseñar con migraciones en el mismo bloque): conexiones, mapeos de menú, pedidos externos, eventos recibidos, estados salientes, pagos/conciliación y trabajos de impresión. Unique keys y transacciones antes de interfaz. Aprovechar outbox existente donde el contrato sea compatible.

### Directo frente a agregador

Directo ofrece más control, pero tres proveedores significan tres contratos, certificaciones, auth, webhooks y mantenimiento. Agregador reduce diversidad del formato entrante, pero añade contrato/coste/dependencia y no elimina estados, pagos ni QA. Recomendación provisional: construir una bandeja independiente del proveedor; comparar acceso directo y agregador con cobertura/cotización real antes de escoger. No hay base para prometer un plazo o ahorro concreto todavía.

### Pruebas necesarias antes de activar clientes

- Pedido normal con precio por canal; variante y modificadores; combo con componentes; artículo agotado/sin mapeo.
- Firma inválida, replay, ID DiDi mayor que límite seguro JS, callback duplicado y fuera de orden.
- Reinicio después de guardar evento/confirmar/imprimir; dos cajas conectadas; POS offline, deadline vencido y reconexión.
- Cancelación antes/después de preparación; cancelación parcial; reembolso total/parcial y confirmación ambigua por timeout.
- Promo financiada por tienda/plataforma; importes finales preservados; efectivo comercio vs repartidor vs prepago; propina/envío según contrato.
- Tienda de otro negocio, token vencido/renovado/revocado, menú actualizado y ventana horaria.
- Cambio de integrador en tienda existente; pruebas sandbox y piloto con estados y conciliación completos.

Estas pruebas no se ejecutaron contra proveedores porque no hay acceso sandbox confirmado. Los conceptos locales sí prueban cambio de campos/guardado y cálculo visual de pago, no integración ni impresión física.

## Fuentes primarias

- [Uber: acceso](https://developer.uber.com/docs/eats/guides/getting-started)
- [Uber: ciclo de órdenes](https://developer.uber.com/docs/eats/guides/order-integration)
- [Uber: webhook](https://developer.uber.com/docs/eats/references/api/webhooks/orders-release)
- [Uber: detalle y dinero del pedido](https://developer.uber.com/docs/eats/references/api/v2/get-eats-order-orderid)
- [DiDi: documentación](https://developer.didi-food.com/en-US/openapi), leído mediante portal renderizado: Basic Process Overview, Our Orders API Module, Webhooks y Before Going Live.
- [Rappi México: integración POS](https://merchants.rappi.com/es-mx/-como-funciona-la-integracion-por-pos-en-rappi)
- [Deliverect: recepción normalizada](https://resources.developers.deliverect.com/en/articles/14468795-receive-orders)

No se solicitaron credenciales ni se enviaron formularios/contactos. Las fuentes y el código fundamentan la auditoría; disponibilidad regional, acuerdos, modelos de impresora y pruebas físicas siguen pendientes de comprobación.
