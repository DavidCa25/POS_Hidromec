# Centro de ofertas · implementación aprobada

Diseño A aprobado por el usuario el 7 de octubre de 2026. Los distintivos 2×1, precios y porcentajes usan Geist, sin la tipografía decorativa del concepto.

- Administración en Inventario: acceso desde dock, menú lateral, paleta y pestañas del catálogo. Se retiró el mosaico comercial de Configuración.
- Tarjetas de promociones y combos con estado, regla, productos, calendario, canal y menú de acciones. Las ofertas activas aparecen primero; después las programadas y pausadas.
- Cuenta de prueba junto a la selección, con importes del motor comercial existente. Se pueden ajustar productos, cantidades, extras, variantes, canal, fecha, hora, elegibilidad y participación de otras ofertas.
- Editor dividido en Oferta, Productos y Vigencia. Reutiliza wx-select, wx-date y wx-menu; wx-multi-select añade búsqueda, casillas y chips sobre la misma primitiva de popover. No incorpora dependencias de interfaz.
- Guardar publica únicamente el borrador de la oferta. Cancelar y Escape descartan sus cambios. Pausar y eliminar conservan el historial de ventas; eliminar requiere confirmación.
- Venta utiliza también los selectores Wybix para canales, combos, componentes y modificadores. Se conservan las validaciones, recetas, existencias y cotizaciones existentes.
- Temas claro/oscuro, foco visible, devolución del foco, movimiento reducido y adaptación a tablet. Los identificadores estables evitan reconstruir controles al recalcular sus opciones.

## Verificaciones

Pruebas sobre Electron, IPC y SQL Server reales, en `Wybix_E2E_Core` y perfiles desechables. No se cargaron ofertas en negocios reales.

- 8 recorridos comerciales: venta por canal, 2×1, permisos de cajera, cobro/devolución de combo, edición y cancelación de borrador, publicación de canal/precio, pausa/eliminación, temas/tablet y cancelación de componentes en cocina.
- 16 regresiones: Apps Wybix, permisos/sesiones de Core y formularios de clientes, inventario, compras y proveedores.
- 17 pruebas del motor comercial; 52 de navegación; 8 del contrato de interfaz.
- Revisión visual adicional: importes completos en una línea y composición de cuatro tarjetas y vista previa sin quedar bajo el dock a 1440×900.

Capturas y registros locales: `docs/evidencia/comercial-20261007/`, prefijos `centro-ofertas-` y `redisenio-ofertas-`. Las capturas contienen datos ilustrativos de QA.

No cambia SQL, migraciones, motor compartido, contratos de venta ni aplicaciones móviles. El instalador demo se construye con `npm run dist:demo`; no publica ni despliega la aplicación.
