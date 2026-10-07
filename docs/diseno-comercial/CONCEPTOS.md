# Conceptos de diseño comercial · revisión previa

Propuestas de diseño del 7 de octubre de 2026. El usuario aprobó **A · Centro de ofertas**, con la tipografía actual de Wybix para 2×1, precios y porcentajes. B y C se conservan como referencias de la revisión.

Problema: el panel actual concentra demasiados campos en Configuración, emplea selects nativos y resulta difícil de leer. El repositorio ya tiene wx-select con búsqueda y notas por opción, WxMenu, WxTablaBarra, tokens y dock propios.

## A · Centro de ofertas
Inventario → Promociones y combos. Página de tarjetas que permite identificar la regla, productos, canales, vigencia y estado a primera vista. Vista previa de cuenta en una columna independiente. Al editar, flujo breve de oferta, productos y vigencia. Adecuado para pocas ofertas y lectura visual rápida.

## B · Lista y editor
Inventario → Promociones y combos. Lista con búsqueda y filtros junto a un editor contextual sin overlay oscuro. Campos organizados por pasos; selección de productos mediante popover buscable y chips, días mediante botones, compra/paga mediante cantidades diseñadas. Vista previa y acción al final del editor. Recomendación: conserva orientación al trabajar con varias reglas y evita formularios extensos.

## C · Catálogo conectado
Inventario conserva sus productos y añade pestañas permanentes para promociones y precios por canal. Seleccionar productos permite crear un combo con componentes reales, precio y ticket de prueba en un panel al lado. Las ofertas existentes también se gestionan desde la pestaña visible. Adecuado cuando el trabajo comercial comienza en el catálogo; requiere cuidar que las reglas de varios productos se editen como una sola oferta.

## Invariantes de implementación después de aprobar
- Acceso desde Inventario y su menú del dock; retirar el mosaico comercial de Configuración.
- Reutilizar wx-select, WxMenu, WxTablaBarra, superficies, tipografía y tokens de Wybix; evitar selects nativos y multiselects del navegador.
- Campos diseñados, contraste y separación claros; productos elegibles con búsqueda, selección múltiple y chips, sin ocultar categorías/variantes.
- Conservar funciones de precios por canal, prioridad, vigencia/horarios, elegibilidad, combos, previsualización y permisos actuales.
- Movimiento breve de popovers/paneles, teclado, foco visible y movimiento reducido. No introducir dependencias pesadas para motion.
- Los ejemplos I Do Nut, precios y estados de las imágenes son ilustrativos.

Mockups producidos con la herramienta integrada imagegen usando una captura real de Wybix como referencia de identidad. Son propuestas visuales, no pantallas implementadas.

## Láminas finales

- A: concepto-a-centro-ofertas.png (vista previa corregida: $50 − $25 = $25).
- B: concepto-b-lista-editor.png.
- C: concepto-c-catalogo.png.

Prompts y procedimiento de generación: PROMPTS.md.
