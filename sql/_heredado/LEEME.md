# Archivos sueltos anteriores al árbol canónico

Estos son los `.sql` que existían en `sql/` antes de esta fase. **No los borres
todavía**, por dos motivos:

1. `utilidad.sql` e `importador_ventas.sql` son la **única fuente** de
   `sp_cloud_daily_profit` y `sp_import_sales`. `scripts/db/extraer.mjs` los lee
   desde aquí (ver `scripts/db/lib/solo-repo.mjs`) para promoverlos al árbol
   canónico, porque esos dos procedures no existen en ninguna base de datos.

2. El resto (`blindaje.sql`, `estadisticas.sql`, `proveedores_cuentas.sql`,
   `sp_reorder_suggestions.sql`, `sp_update_business_config.sql`) contiene
   definiciones que **ya están** en `sql/procedures/`, extraídas de la base. Se
   conservan como referencia histórica hasta confirmar que no aportan nada que
   se haya perdido.

`importador_productos.sql` está vacío (0 bytes). Era el marcador de posición de
`sp_import_products`, cuyo código real se recuperó de la base de datos y ahora
vive en `sql/procedures/inventory/sp_import_products.sql`.

La fuente de verdad a partir de ahora es `sql/procedures/`, `sql/types/` y
`sql/manifest.json`.
