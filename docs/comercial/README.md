# Precios por canal, promociones y combos

Implementación de la opción C aprobada el 7 de octubre de 2026. Windows POS 1.4.0; Owner y POS Mobile 0.2.0. Los precios de las pruebas son ilustrativos; no se activaron ofertas de I Do Nut ni se duplicaron sus productos.

## Probar la demo

1. Instalar `C:/Users/Casillas/filtros_lubs_rios/release-internal/Wybix-Demo-Setup.exe` y abrir **Wybix Demo**. Su identidad es distinta de Wybix POS y permite conservar la instalación de producción.
2. En el gestor, crear un entorno **Hospitality** o **Retail** y pulsar **Abrir**. Usar `demo` / `demo1234`, credenciales públicas del entorno demo. Si el entorno ya existe, abrirlo; no hace falta restablecerlo.
3. Entrar a **Más → Configuración → Precios y ofertas → Precios, promociones y combos**. Las pestañas son Canales, Precios, Promociones, Combos y Vista previa.
4. Agregar un canal, por ejemplo Uber Eats. Dejar desmarcado «Usar precio base si falta uno» para exigir una lista completa, o marcarlo si se quiere heredar el precio del catálogo.
5. En Precios, asignar un importe al mismo producto en ese canal. Es un precio base: los ajustes de tamaño y los demás extras del catálogo se suman por separado. El selector de variante limita a qué tamaño corresponde la regla; no crea otro producto.
6. En Promociones, crear «Compra N / paga M», con Compra 2, Paga 1 y productos elegibles. Las reglas nuevas comienzan inactivas. Elegir canales, días y horarios si corresponde. Para un descuento de estudiante, usar Porcentaje y una elegibilidad que confirme un supervisor.
7. En Combos, crear un precio conjunto y grupos, por ejemplo una dona y un café. Cada grupo tiene su cantidad y opciones de productos reales. Los extras siguen cobrando su importe del catálogo.
8. Usar Vista previa para probar cuentas por canal, fecha, hora y elegibilidad antes de **Publicar cambios**. La vista previa de productos no registra ventas ni mueve inventario. La selección de componentes de un combo se revisa en Venta mediante **Agregar combo**.
9. Abrir un turno en Venta. Elegir el canal en la cuenta, agregar productos o armar un combo, revisar total y ahorro y cobrar. Para una venta ya pagada en Uber/DiDi/Rappi, elegir **Pagado en plataforma**; se registra el total sin incrementar el efectivo esperado del cajón. El folio de plataforma es opcional.
10. Revisar el ticket, inventario y corte. En una cuenta nueva el canal vuelve a Mostrador. Una devolución devuelve el importe realmente cobrado y repone las unidades correspondientes.

Para I Do Nut pueden configurarse un precio especial del martes, frappés 2x1, media docena con seis elecciones, café adicional al comprar dos donas y descuento por elegibilidad. No cargar automáticamente los precios de los carteles: aparecen importes distintos para algunos combos y deben confirmarse comercialmente.

## Comportamiento

- Un producto conserva UUID, receta e inventario en todos los canales. El canal de venta, Aquí/Para llevar y forma de pago son decisiones distintas.
- La cuenta se recalcula al cambiar y se verifica otra vez antes de cobrar. Si cambió el total, se pide revisarlo antes de confirmar.
- Las mismas unidades no acumulan combo y promoción. Una prioridad menor se aplica primero; los empates se resuelven de forma estable. El 2x1 descuenta las unidades elegibles más baratas.
- Los horarios usan el reloj del negocio. El extremo inicial se incluye y el final se excluye; las ventanas pueden cruzar medianoche. La vigencia por fecha incluye ambos días.
- Las ofertas por piezas y los combos exigen cantidades completas. Las ventas ordinarias y descuentos simples conservan cantidades fraccionadas.
- La cotización de Windows se calcula en el proceso principal con catálogo, opciones, actor y caja reales. SQL comprueba y consume una sola cotización dentro de la transacción. El cupón se consume junto con la venta y un intento concurrente perdedor revierte venta e inventario.
- Se congelan canal, reglas, importes y componentes. Las devoluciones parciales distribuyen el importe neto con centavos exactos; nunca usan el precio normal para devolver una venta promocional.
- Cocina recibe productos y opciones reales. La cuenta conserva canal y componentes al reabrirse. Si cancelar una comanda deja un combo incompleto, aparece un aviso y los productos restantes vuelven a precio individual; se revisa el nuevo total. Otro combo de la misma cuenta conserva su composición.
- POS Mobile usa el mismo motor, conserva consumos y precios dentro de SQLite y envía los hechos congelados por outbox. La PWA conserva las ventas al recargarse sin conexión.
- Owner muestra venta y devoluciones por canal. El neto mostrado es **antes de las comisiones de la plataforma**.

## Estado de entrega y publicación

La demo y los exports web son locales. No se publicó este cambio ni se reemplazaron los APK/enlaces públicos existentes.

La migración SQL Server `0053_comercial` está incluida en el instalador y la plantilla limpia. Las migraciones de nube `20261012120000` y `20261012130000` se ensayaron, aplicaron, verificaron y registraron durante el desarrollo. El smoke remoto volvió a confirmar columnas, permisos e historial.

Antes de activar ofertas para clientes hay que publicar el adaptador `pos-sync` actualizado, distribuir Windows 1.4.0 y POS Mobile 0.2.0, publicar los exports/APK pertinentes y actualizar las tablets. La función fuente envía la capacidad `commercial_schema: 1`; el gateway público todavía requiere ese despliegue. Un cliente antiguo con catálogo cacheado puede vender sin conexión hasta actualizarse: el bloqueo de snapshot no sustituye la actualización de esos equipos.

No se implementó conexión automática a pedidos de plataformas, cálculo contractual de comisiones/liquidaciones ni combos anidados. Los cupones legados de porcentaje/importe siguen inactivos; las promociones automáticas de porcentaje/importe sí funcionan. Windows conserva la restricción existente de no cobrar una cuenta cuyo total completo sea cero.

Las pruebas de terminal Point validaron congelación, referencia e idempotencia con fixtures; queda una prueba física con terminal y pago real. También queda validar impresión física y uso nativo en teléfonos del piloto. No se prometen esas verificaciones a partir de las pruebas automatizadas.

## Código y evidencia

- Motor: `shared/comercial.ts`, copiado exactamente a `wybix-owner/packages/domain/src/comercial.ts`.
- Proceso principal y cotizaciones: `electron/comercial/` y `electron/ipc/comercial.js`.
- Administración y venta: `src/app/commercial-panel/`, `src/app/commercial-sale/` y `src/core/commercial.service.ts`.
- Contratos canónicos y migración: `sql/schema/changes/0053_comercial.sql`, `sql/procedures/` y `electron/migrations/0053_comercial.sql`.
- Evidencia: `docs/evidencia/comercial-20261007/`. Incluye capturas de la interfaz real sobre datos ficticios y registro de las pruebas.

Pruebas principales: `npm run test:comercial`, `npm run db:test-comercial`, `npm run db:test-mesas`, `npm run test:seguridad`, `npm run test:ticket`, pruebas Electron de comercial/Core/Apps/Servicios/Mesas, reconstrucción del baseline, plantilla, instalación limpia y contenido del instalador demo. En Owner: `npm test`, `npm run typecheck`, `npm run test:fase3`, exports PWA y recorridos WebKit aislados.
