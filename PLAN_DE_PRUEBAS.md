# Plan de pruebas — Wybix POS

Checklist para probar el sistema completo antes de lanzar. Marca cada punto al validarlo.
Prueba idealmente en una **VM limpia** (como cliente real) y también en tu equipo de trabajo.

---

## 1. Instalación y primer arranque (máquina limpia)

- [ ] El instalador `.exe` instala sin errores.
- [ ] SQL Server Express se instala **solo** (sin el error -196608).
- [ ] Se restaura la base `template.bak` y arranca la app.
- [ ] Aparece el **asistente inicial** (porque el template va sin usuarios).
- [ ] Crear usuario **administrador** + datos del negocio → entra al sistema.
- [ ] Aparece la pantalla de **prueba gratis** (30 días) y se inicia.
- [ ] Onboarding: cargar **catálogo por giro** (Abarrotes/Ferretería/Refaccionaria/Farmacia) — importa 50+ productos con marca real, **sin el error de `bar_code` NULL**.
- [ ] Reiniciar la app: ya NO vuelve a pedir el asistente (queda configurado).

## 2. Licencia y prueba de 30 días

- [ ] Chip "Prueba gratis · N días" visible; botón **Comprar** abre la landing en el navegador.
- [ ] Avisos automáticos a los **15, 7, 3 y 1** días (probar cambiando la fecha de expiración).
- [ ] **Config → Licencia**: activar una clave **durante** la prueba (sin esperar 30 días).
- [ ] Clave **inválida/inexistente** → muestra error claro (ya no se queda muda).
- [ ] Clave **MonoCaja** válida → activa, y NO aparece el mosaico "Cajas".
- [ ] Clave **MultiCaja** válida → activa, y SÍ aparece "Cajas".
- [ ] **Liberar esta computadora** → vuelve a prueba/sin licencia.
- [ ] Al **vencer** la prueba (forzar expiración) → pantalla de bloqueo con "Activar clave".
- [ ] **Anti-tamper**: editar/borrar el `license.json` a mano → estado "tamper" y bloqueo.

## 3. Venta (núcleo del POS)

- [ ] Cobro en **efectivo** (con cambio), **tarjeta**, **transferencia**, **crédito/fiado**, **Terminal Mercado Pago**.
- [ ] Solo aparecen las **formas de pago activadas** en Configuración.
- [ ] **Escanear** código de barras → encuentra el producto.
- [ ] Buscar producto en el **modal** (por nombre, No. parte, marca, categoría).
- [ ] Cambiar cantidades, quitar renglón, aplicar descuento.
- [ ] **Ticket** imprime en 58mm con todo el contenido (no sale en blanco).
- [ ] El **cajón** se abre al cobrar.
- [ ] **Cuentas en espera** (multi-ventana): abrir varias, alternar, cobrar cada una.

## 4. Inventario

- [ ] Alta de producto (marca, categoría, precio, stock, **código de barras**, claves SAT, IVA).
- [ ] Editar producto: el código de barras se guarda y se ve.
- [ ] Crear **marca** y **categoría** nuevas desde sus modales.
- [ ] **Proveedores** por producto (costo, proveedor default).
- [ ] **Conteo físico**: capturar conteo, ver descuadre, aplicar ajuste de stock.
- [ ] **Modo oscuro** en todos los modales (producto, marca, categoría, proveedores, selector SAT).

## 5. Compras (reabastecer)

- [ ] Registrar compra: **sube stock** y **actualiza el precio sugerido** (compra + IVA + % ganancia).
- [ ] Modo oscuro del modal de seleccionar producto.

## 6. Clientes y crédito

- [ ] Alta de cliente.
- [ ] Venta a **crédito (fiado)**; registrar **abonos**.
- [ ] Alerta de **crédito vencido / cobranza**.

## 7. Corte de caja / turno

- [ ] Apertura y cierre de turno.
- [ ] Arqueo: efectivo esperado vs. contado, **descuadre**.
- [ ] El corte respeta la caja de esta máquina.

## 8. Alertas

- [ ] Reorden inteligente, stock mínimo, agotados, sin rotación, ventas $0.
- [ ] Descuadre de caja, devoluciones por cajero, crédito vencido (robo hormiga).
- [ ] **Badge** de alertas en el menú con el conteo correcto.

## 9. Estadísticas / dashboard

- [ ] Ventas (día/semana/mes), tickets, ticket promedio.
- [ ] Clientes (activos, nuevos, top).
- [ ] Productos (top vendidos, sin rotación).
- [ ] **Utilidad** correcta (usa `sp_get_profit_overview`, con costo de `product_suppliers`).

## 10. Configuración (revisar cada panel + modo oscuro)

- [ ] Datos del negocio (carga y guarda).
- [ ] Formas de pago.
- [ ] Usuarios y permisos (crear, cambiar rol, resetear contraseña, activar/desactivar).
- [ ] Licencia.
- [ ] Actualizaciones (muestra versión, busca nuevas).
- [ ] Respaldos, Dispositivos (impresora/scanner/cajón), Ticket, Facturación, Diagnóstico, Cajas.
- [ ] **Modo oscuro legible en TODOS los paneles** (sin letras invisibles ni cajas blancas).

## 11. Facturación (CFDI 4.0)

- [ ] Configurar RFC, régimen, CP, cargar CSD (.cer/.key + contraseña).
- [ ] **Timbrar** una factura de una venta.
- [ ] **Cancelar** una factura.

## 12. Respaldos

- [ ] Exportar `.bak` manual.
- [ ] Importar/restaurar un `.bak`.
- [ ] Respaldo **automático** diario a la hora configurada.
- [ ] Copia fuera de la máquina (OneDrive/Google Drive).

## 13. Multicaja (solo con licencia Multi)

- [ ] Instalar **máquina principal** (servidor) y anotar su IP.
- [ ] Instalar **caja secundaria**, conectar por IP + clave.
- [ ] Ambas comparten inventario, ventas y clientes en **tiempo real**.
- [ ] Cada caja lleva su **propio turno y corte**.
- [ ] Si se apaga la principal, las secundarias no pueden cobrar (esperado).

## 14. App del dueño / nube

- [ ] Emparejamiento QR con la nube.
- [ ] La app móvil ve el negocio (ventas/inventario).

## 15. Actualizaciones automáticas

- [ ] Publicar una versión nueva (GitHub Release) y verificar que la app la **detecta e instala**.

---

## Pendientes / riesgos a cerrar antes de lanzar

- [ ] **Función `license-check` desplegada en Supabase** (la activación de claves depende de ella; `trial-license` ya está).
- [ ] **Cómo generas las claves** cuando alguien te paga (para mandarlas por WhatsApp) — falta ese proceso/panel.
- [ ] **Instalador `.exe` final** subido y `DOWNLOAD.windowsUrl` apuntando a él en la landing.
- [ ] **Firma de código** (certificado) para evitar la advertencia de SmartScreen en Windows.
- [ ] **Facturación en producción** con Fiscalapi (timbrado real, no solo sandbox).
- [ ] Confirmar la **URL de compra** definitiva (hoy: `wybix-landing.vercel.app`; ¿dominio propio?).
