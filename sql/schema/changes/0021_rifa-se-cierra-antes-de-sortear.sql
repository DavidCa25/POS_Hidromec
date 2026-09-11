/* ============================================================
   0021 — cerrar una rifa es un acto propio, no un efecto del sorteo

   Hasta ahora una rifa pasaba de OPEN a DRAWN de un salto: el sorteo la
   cerraba y elegia ganador en la misma operacion. Son dos decisiones
   distintas y normalmente las toma gente distinta en momentos distintos:

     "ya no se reparten mas boletos"        -> cerrar
     "el ganador es el boleto 341"          -> sortear

   Mezclarlas obliga a sortear en el instante en que quieres dejar de
   repartir, y deja sin respuesta la pregunta que siempre aparece despues:
   ¿cuantos boletos participaban exactamente cuando se cerro?

   Estas tres columnas guardan esa respuesta EN EL MOMENTO DEL CIERRE, no
   cuando alguien se acuerde de sortear. Un sorteo que ocurre una semana mas
   tarde sigue usando el universo congelado aquel dia.
   ============================================================ */

IF COL_LENGTH('dbo.raffle_definitions', 'closed_at') IS NULL
ALTER TABLE dbo.raffle_definitions ADD closed_at DATETIME2(0) NULL;

IF COL_LENGTH('dbo.raffle_definitions', 'closed_entries_count') IS NULL
ALTER TABLE dbo.raffle_definitions ADD closed_entries_count INT NULL;

/* El ultimo boleto que entro antes del cierre. El sorteo no mira mas alla
   de este id, asi que un boleto insertado despues -por un camino que no
   deberia existir- no puede colarse en un sorteo ya congelado. */
IF COL_LENGTH('dbo.raffle_definitions', 'closed_max_entry_id') IS NULL
ALTER TABLE dbo.raffle_definitions ADD closed_max_entry_id INT NULL;
