# Evidencia final — comercial

7 de octubre de 2026. Pruebas sobre bases, navegador y equipos de QA desechables. El instalador de demo se construyó con el árbol de trabajo indicado en `proveniencia.json`; los cambios aún no están publicados.

| Verificación | Resultado | Registro |
| --- | --- | --- |
| Motor comercial, cantidades, horarios, 2x1, extras, combos y cancelación | 17/17 | comercial-engine-qa.log |
| Flujo Electron: comercial, Core/permisos, Apps, Servicios y Mesas/KDS | 30/30 | comercial-e2e-final-qa.log |
| SQL comercial: doble migración, cotización, stock, devoluciones, cupón concurrente y pago congelado | Correcto | comercial-migracion-qa.log |
| Regresión SQL de mesas y comandas | 66/66 | comercial-mesas-qa.log |
| Sesión y permisos | 84/84 | comercial-security-qa.log |
| Tickets | 43/43 | comercial-ticket-qa.log |
| Contrato IPC | Completo | comercial-ipc-qa.log |
| Baseline construido desde Git | Correcto | comercial-baseline-qa.log |
| Plantilla con verificación completa | Correcta | comercial-template-qa.log |
| Instalación limpia | Correcta | comercial-install-qa.log |
| Guardas y apertura de demo | 69 + 80 comprobaciones correctas | comercial-demo-guardas-qa.log |
| Contenido real de ASAR y recursos del paquete | 68 comprobaciones correctas | comercial-demo-content-qa.log |

El recorrido comercial comprueba un mismo SKU a $32 en plataforma y 2x1 a $25 en Mostrador, stock compartido, reinicios de canal por cuenta, permisos de cajera, selección real de componentes y cobro/devolución de combo de $59, creación de 2x1 mediante configuración y vista previa sin venta/stock. El recorrido entre estaciones cancela la dona, conserva el café a $35, cobra una sola venta y libera la mesa. Las cinco regresiones de mesas comprueban opciones, envío incremental, preparación/entrega, cliente y cobro de pedidos para llevar.

La ejecución histórica `comercial-e2e-qa.log` contiene una falla de localización del selector de prueba de administración. El selector se corrigió y la pasada final completa terminó 30/30. No usar ese registro histórico como resultado de entrega.

Las capturas `combo-venta.png` y `configuracion-vista-previa.png` muestran la interfaz real sobre datos ficticios. El SHA256 del instalador está en `demo-sha256.json`.

La evidencia de Mobile/nube está en `C:/Users/Casillas/Documents/wybix-owner/docs/evidencia/comercial-20261007/`. No hubo prueba física de Point, impresión ni teléfono nativo; los APK públicos y el adaptador pos-sync requieren una publicación posterior.
