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
| `turno.mjs` | Sin turno abierto no se vende: Retail pide abrirlo, Touch bloquea el cobro y checkout se niega. Abre el turno por el flujo de siempre y comprueba que vuelve a permitir. |
| `producto-extras.mjs` | Código de barras e imagen: opcionales, se guardan y vuelven al editar. Crea su producto de prueba y lo retira al terminar. |
| `baja-producto.mjs` | Dar de baja desde Inventario: pregunta antes de actuar, no promete nada hasta saber el resultado, y la tabla se rehace desde SQL sin recargar. |
| `licencia-texto.mjs` | Que cada estado de licencia se llame por su nombre: la prueba no se anuncia como un plan comprado. |
| `customer-display.mjs` | La pantalla de cliente es otra ventana: se ejecuta directo con `node`, sin `conducir-app`. |

`casos-limite.mjs` necesita productos de prueba (nombres largos, precios
grandes, agotados). Se siembran en la base de PRUEBAS con el prefijo `QA-` y
se borran al terminar; nunca contra la base del cliente.
