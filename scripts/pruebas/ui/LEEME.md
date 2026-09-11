# Pruebas de interfaz

Todas se ejecutan sobre la ventana **real** de Electron, no sobre un DOM
simulado: lo que se mide es lo que ve el cajero.

```bash
npx electron ./electron/main.js --remote-debugging-port=9222
node scripts/pruebas/conducir-app.mjs scripts/pruebas/ui/<guion>.mjs
```

| Guion | Para que sirve |
|---|---|
| `responsive.mjs` | 1366x768, 1600x900, 1920x1080 y el escalado de Windows al 125%. Rechaza recortes, scroll horizontal, totales fuera de pantalla y objetivos tactiles pequenos. |
| `casos-limite.mjs` | Nombres largos, precios de cinco cifras, carritos de diez lineas, notas largas, agotados. Mide desbordes, no criterio. |
| `accesibilidad.mjs` | Nombre accesible en botones de icono, anillo de foco con tabulaciones reales, deshabilitado de verdad, estados que no dependen solo del color. |
| `medir-imagenes.mjs` | Cuanto cuesta el catalogo con fotos: miniaturas convertidas, tiempo, memoria del renderer. |
| `capturas.mjs` | Evidencia visual en `docs/evidencias/touch-v1/`. Registra UNA venta real. |
| `overlays.mjs` | Que cada desplegable abra sobre SU campo en 1366x768, 1600x900 y 1920x1080, y que un aviso nunca quede detras del modal que lo provoca. |
| `perfiles-en-caliente.mjs` | Cambiar la experiencia de la caja (Retail/Touch/Backoffice) y el giro del negocio surte efecto sin reiniciar, sin recargar y sin perder la sesion. |
| `producto-hospitality.mjs` | El modal de producto: Retail sigue simple, Hospitality gana el control del producto, el Stock desaparece en las recetas, y los desplegables responden a raton y teclado. |
| `catalogo-fresco.mjs` | El catálogo de Touch se relee al entrar: cambiar el stock fuera de la pantalla se ve sin reiniciar. |
| `venta-solo-vendibles.mjs` | El buscador de la venta en Retail no ofrece ingredientes: marca un producto como "no se vende" desde Inventario y comprueba que desaparece del buscador y del escáner, pero no del catálogo. |
| `tabla-compras.mjs` | La tabla de compras muestra producto y proveedor, no celdas en blanco: comprueba las columnas que llegan por el canal y el texto que se pinta en la fila y en el detalle. |
| `turno.mjs` | Sin turno abierto no se vende: Retail pide abrirlo, Touch bloquea el cobro y checkout se niega. Abre el turno por el flujo de siempre y comprueba que vuelve a permitir. |
| `producto-extras.mjs` | Código de barras e imagen: opcionales, se guardan y vuelven al editar. Crea su producto de prueba y lo retira al terminar. |
| `baja-producto.mjs` | Dar de baja desde Inventario: pregunta antes de actuar, no promete nada hasta saber el resultado, y la tabla se rehace desde SQL sin recargar. |
| `cajas.mjs` | Configuración > Cajas con licencia MultiCaja: el catálogo se ve, se asigna una caja a la máquina, la asignación persiste en el device-config tras recargar, elegir caja no toca `dbo.registers`, y una caja sin asignar no desaparece. No crea ni borra cajas. Desde el arriendo de caja comprueba ademas que esta maquina tiene identidad estable, que su caja figura como suya -con el reloj del SERVIDOR- y que renovarla la RENUEVA en vez de pelearla. La carrera entre dos equipos por la misma caja se prueba con cuatro procesos reales en `scripts/db/pruebas/cajas.mjs`. |
| `tabla-barra.mjs` | Filtrar / Agrupar / Columnas en las CINCO tablas (Inventario, Compras, Ventas, Proveedores, Clientes): los tres paneles abren completos, ocultar una columna quita encabezado y celdas, una columna obligatoria no se puede quitar, el filtro deja justo lo que anuncia, agrupar no pierde filas y la preferencia sobrevive a salir y volver. |
| `tablas-y-exportar.mjs` | Contraste WCAG medido de la barra de las tablas en claro y en oscuro (Compras, Inventario, Ventas), que las tres midan lo mismo -una sola definicion-, y que el menu de Exportar abra entero y genere un PDF y un XLSX de verdad. |
| `licencia-texto.mjs` | Que cada estado de licencia se llame por su nombre: la prueba no se anuncia como un plan comprado. |
| `customer-display.mjs` | La pantalla de cliente es otra ventana: se ejecuta directo con `node`, sin `conducir-app`. |

`casos-limite.mjs` necesita productos de prueba (nombres largos, precios
grandes, agotados). Se siembran en la base de PRUEBAS con el prefijo `QA-` y
se borran al terminar; nunca contra la base del cliente.
