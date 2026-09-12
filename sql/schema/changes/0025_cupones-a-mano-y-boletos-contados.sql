/* ============================================================
   0025 — una rifa puede tener un numero de boletos

   Hasta ahora una rifa repartia boletos sin fin: el numero de cada uno
   salia de contar los que ya habia, y nada decia cuantos iba a haber. Al
   crearla no se podia decir "son quinientos", asi que tampoco se podia
   ver cuantos quedaban ni cuando se llenaba.

   `tickets_total` NULL significa lo de siempre, sin tope. Se deja NULL a
   proposito y no 0: las rifas que ya existen no tenian limite, y darles
   uno por omision cambiaria su comportamiento sin que nadie lo pidiera.

   Idempotente: comprueba la columna antes de anadirla.
   ============================================================ */

IF COL_LENGTH('dbo.raffle_definitions', 'tickets_total') IS NULL
    ALTER TABLE dbo.raffle_definitions ADD tickets_total INT NULL;
GO

/* Un tope de cero o negativo no significa nada: o hay boletos o no hay
   rifa. Se admite NULL, que es "sin tope". */
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints
                WHERE name = 'CK_raffle_definitions_boletos')
    ALTER TABLE dbo.raffle_definitions WITH CHECK
        ADD CONSTRAINT CK_raffle_definitions_boletos
        CHECK (tickets_total IS NULL OR tickets_total > 0);
GO
