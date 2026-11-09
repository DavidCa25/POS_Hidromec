# Rendimiento con catálogos grandes

Clientes con 5,000 productos o más. SQL no era el problema
(`sp_get_active_products` tarda ~70 ms con 6,000); lo era la pantalla.

## Qué se cambió

| Dónde | Antes | Ahora |
|---|---|---|
| Buscador de Venta | pintaba todas las tarjetas y releía SQL **antes** de abrirse, cada vez | abre al instante con lo que hay, pinta 120 y dice cuántos hay; refresca en segundo plano si lo leído tiene más de 60 s o hubo una venta |
| Búsqueda (Venta y Touch) | `toLowerCase` de cinco campos por producto y por tecla | índice armado una vez por lectura del catálogo |
| Escáner | recorría la lista | mapa por código de barras y por número de parte |
| Cuadrícula de Touch | todas las tarjetas | 120 y «elige una categoría o busca»; los productos que ya hay se ven mientras refresca |
| Inventario | filtraba, agrupaba y aplanaba en cada detección de cambios (varias veces por ciclo) | memorizado (`core/memo.ts`) mientras no cambien filas, texto o la barra de la tabla |
| Después de vender | el catálogo se vaciaba y el buscador esperaba la lectura | se marca viejo y se refresca sin vaciarse |

Esqueletos (`src/styles/esqueleto.css`) solo en la **primera** carga, sin nada
en memoria: el buscador de Venta y la cuadrícula de Touch. Encima de datos
válidos serían ruido. Animan `opacity`, como `wx-cargando`.

## Cómo se mide

    npm run e2e:rendimiento

Siembra 6,000 productos, mide y los quita. Tiempos en
`tmp/e2e-rendimiento/tiempos.json`.

| Medida (ms) | Antes | Después |
|---|---|---|
| Abrir el buscador de Venta (primera vez, sin catálogo en memoria) | 3,395 | ~1,100 |
| Tarjetas pintadas | 6,006 | 120 |
| Reabrir el buscador | 4,055 | ~125–160 |
| Filtrar en el buscador | 688 | ~40 |
| Filtrar en Inventario | 998 | ~40 |
| Teclear en Inventario | 975 | ~250 |
