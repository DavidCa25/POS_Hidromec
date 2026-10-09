# MultiSucursal

Complemento de licencia `ADDON_MULTIBRANCH`. Convierte las sucursales de una empresa en
una red con **una matriz** que administra el catálogo de todas, sin que ninguna deje de
vender sin Internet.

## Modelo

```
Empresa (dueño, app Wybix)
├── Matriz      publica el catálogo corporativo, fija precios y reglas por sucursal
├── Sucursal A  recibe y aplica; su inventario, ventas y cortes son suyos
└── Sucursal B  ídem
        ⇅ traspasos de mercancía entre cualquiera de ellas
```

- **Matriz**: la elige el dueño en la app (Sucursales → Hacer matriz). Si nadie la
  elige, es la primera sucursal que se dio de alta.
- Cada sucursal sigue teniendo **su propia base de SQL Server**. La nube solo transporta
  versiones del catálogo, excepciones y el estado de los traspasos.
- Sin `MULTIBRANCH` en una licencia activa de la empresa, nada de esto se activa y cada
  sucursal opera como siempre.

## Qué viaja y qué no

| De la matriz (catálogo corporativo) | De cada sucursal (no viaja) |
|---|---|
| Productos: nombre, código, código de barras, categoría, marca, claves SAT, IVA, tipo de inventario, si se vende, unidad | Existencia y costo |
| Recetas y modificadores | Ventas, cortes, turnos y caja |
| Política comercial: canales, precios por canal, promociones, combos | Configuración de la caja (impresora, Touch, cajón) |
| Usuarios **de empresa** con su contraseña y PIN | Usuarios propios de la sucursal |
| Bajas: un producto dado de baja en la matriz se da de baja (sin borrar) | Productos propios (si la empresa lo permite) |

## Excepciones por sucursal

Desde la matriz (Configuración → Nube y cuenta → MultiSucursal):

- **Precio en la sucursal**: un precio distinto al de la matriz.
- **Se vende ahí**: apagado lo quita de la caja de esa sucursal sin tocar su inventario.

## Reglas de la empresa

- **Cambiar precios** (apagado por omisión): si se enciende, una sucursal puede cambiar el
  precio de un producto de la matriz y ese cambio se respeta mientras la matriz no cambie
  ese precio.
- **Dar de alta productos propios** (encendido por omisión): si se apaga, la sucursal no
  puede crear productos (ni a mano, ni con el importador); todo viene de la matriz.

En la sucursal, un producto de la matriz muestra el aviso «Este producto lo administra la
matriz». El proceso principal rechaza cambios de nombre, código, impuestos, tipo y (sin
permiso) precio; existencia y costo sí se ajustan.

## Usuarios de empresa

En la matriz, cada usuario puede viajar a **todas** las sucursales o a algunas. Llega con la
misma contraseña (scrypt) y el mismo PIN. Si en la sucursal ya existe un usuario con el
mismo nombre creado ahí, **no se reemplaza** y se avisa. Un usuario que deja de ser de
empresa se desactiva en las sucursales.

## Traspasos

Inventario → Traspasos entre sucursales.

1. **Enviar**: sale del inventario de esta sucursal en el momento (`BRANCH_OUT`). Solo
   mercancía con existencia propia (no recetas ni productos de menú).
2. **Recibir**: la otra sucursal cuenta lo que llegó; solo eso entra (`BRANCH_IN`).
3. **Cerrar**: quien envió ve lo recibido y la diferencia.
4. **Cancelar**: mientras no se reciba, quien envió lo cancela y la mercancía regresa.

Sin Internet también se envía y se recibe: cada paso queda hecho en la base local y la
nube se pone al día en la siguiente sincronización (idempotente por uuid).

## Sincronización

Cada ciclo de la nube (5 min en la caja principal):

- La matriz publica si su catálogo cambió (misma huella = misma versión).
- Cada sucursal pide solo lo nuevo (versión y revisión de excepciones) y lo aplica en
  **una** transacción: o entra la versión completa o nada.
- Los traspasos se suben, se cierran y se confirman.

También a mano: «Publicar ahora» (matriz) y «Recibir ahora» (sucursal).

Emparejamiento de productos al aplicar: por uuid; si no, por código (la sucursal adopta el
uuid de la matriz). Un producto propio de la sucursal que use un código de la matriz se
renombra con sufijo `-LOCAL-<id>` y se avisa.

## Si la matriz cambia

La nueva matriz suelta sus candados al publicar por primera vez: sus productos y usuarios
dejan de ser «de la matriz» y su catálogo pasa a ser el de la empresa.

## Piezas

| Capa | Archivos |
|---|---|
| Nube | `wybix-owner/supabase/migrations/20261013120000_multisucursal.sql`, acciones `multi_*` en `supabase/functions/_shared/pos-sync.ts` |
| Base local | `electron/migrations/0055_multisucursal.sql` (`sp_corporate_catalog_export`, `sp_corporate_catalog_apply`, `sp_branch_transfer_*`) |
| Proceso principal | `electron/nube/multisucursal.js`, `electron/ipc/multisucursal.js` |
| Pantallas | `src/app/multisucursal-panel/`, `src/traspasos/`, aviso en `src/inventario/` |
| App del dueño | `apps/owner/app/sucursales.tsx` |

## Pruebas

| Comando | Qué cubre |
|---|---|
| `npm run test:multisucursal` | Proceso principal sin nube ni base: publicar, recibir, envíos sin red, cierre de traspasos, candado |
| `npm run db:test-multisucursal` | Dos bases temporales (matriz y sucursal): exportar, aplicar, excepciones, reglas, usuarios, traspasos |
| `wybix-owner: node scripts/probar-fase3.mjs` | Nube: licencia, matriz, versiones, excepciones, reglas, traspasos, permisos |
| `wybix-owner: npm run test:quick` | `pos-sync`: el equipo sale de la credencial, sanitización, mensajes |

## Pendiente fuera del código

- Desplegar la migración y `pos-sync` en Supabase.
- Reconstruir `installer/template.bak` (`npm run db:prepare-release`) para que una
  instalación nueva nazca con la 0055.
- Publicar la app del dueño con la pantalla Sucursales.
- Precio de lista de `ADDON_MULTIBRANCH` en `license_catalog`.
