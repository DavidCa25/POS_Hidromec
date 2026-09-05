# Historial de preproduccion

Estas son las migraciones que existieron **antes** de WYBIX DATABASE BASELINE V1.
Se conservan como registro de lo que se hizo durante el desarrollo. **No se
aplican, no viajan en el instalador y no deben volver a `electron/migrations/`.**

Se archivaron aqui, y no dentro de `electron/migrations/_preproduccion/`, para
que ni siquiera esten al alcance del runner: hoy `runMigrations()` solo lee los
`.sql` del directorio raiz e ignora los subdirectorios, pero basta con que
alguien lo cambie a un recorrido recursivo para reaplicar historial muerto sobre
una base productiva.

## Por que dejaron de hacer falta

Ninguna instalacion productiva depende de este historial: todas las instalaciones
hechas hasta ahora fueron maquinas virtuales y entornos de prueba, reinstalables.
Y sobre todo, **todo lo que estas migraciones producian ya esta en el arbol
canonico**, que es lo que construye el baseline:

| Migracion | Que hacia | Donde vive ahora |
|---|---|---|
| `0001_init_migrations_table.sql` | Creaba `schema_migrations` | `sql/baseline/v1/00_infraestructura.sql` |
| `0002_multicaja_registers.sql` | Creaba `registers`, anadia `register_id` a `sales`, `cash_shifts`, `cash_closures` y `cash_movements` con sus FK e indices, y sembraba la caja `C1` | `sql/schema/tables/` (estructura) y `sql/baseline/v1/01_seed.sql` (la fila `C1`) |
| `003_setup_inicial.sql` | Vacia (0 bytes) | — |
| `004_iva_precio_venta.sql` | Vacia (0 bytes) | — |
| `005_una_compra_un_proveedor.sql` | Vacia (0 bytes) | — |
| `006_sp_register_purchase.sql` | Vacia (0 bytes) | — |
| `0007_completar-procedures-desde-template.sql` | Llevaba a la base 20 objetos que solo existian dentro de `template.bak` | `sql/procedures/` y `sql/types/` |

Las cuatro vacias (`003`–`006`) nunca tuvieron contenido: se marcaron como
aplicadas para quemar el numero. Son la razon por la que el historial no puede
reconstruirse leyendo los archivos, y buena parte del motivo para cortar por lo
sano con un baseline.

## Que hacer con una instalacion vieja

Reinstalarla desde `template.bak` V1. No hay ruta de migracion desde el
historial de preproduccion al baseline, y no se construyo ninguna a proposito:
mantener esa ruta obligaria a sostener para siempre un camino que ningun cliente
recorre.
