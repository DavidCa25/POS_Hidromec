# Migraciones productivas

Vacio a proposito. **Baseline V1 es el punto de partida**: una base recien
instalada nace de `installer/template.bak`, que ya trae el esquema, los tipos,
los procedures desplegables y el seed estructural. No hay nada que migrar.

El historial anterior al baseline esta archivado en
`sql/_historial-preproduccion/` y no debe volver aqui.

## La proxima migracion

El historial productivo arranca de cero. El primer cambio real de esquema o de
procedures que haya que llevar a una instalacion ya entregada se llama:

    0001_<primer_cambio_real>.sql

Se genera con `npm run db:migration` a partir del arbol canonico, nunca a mano,
y se prueba con `npm run db:test-migration` antes de entrar al instalador.

Este archivo mantiene la carpeta en Git y viaja con el instalador; el runner
solo lee `.sql`, asi que lo ignora.
