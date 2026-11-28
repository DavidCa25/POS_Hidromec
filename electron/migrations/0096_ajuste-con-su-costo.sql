/* ============================================================
   0096 — ajuste con su costo

   Generada con scripts/db/generar-migracion.mjs desde los archivos
   canonicos de sql/. No editar a mano: regenerar.

   Idempotente: todos los objetos usan CREATE OR ALTER, y los tipos
   comprueban su existencia antes de crearse. Se puede reejecutar.

   NO toca tablas ni datos. Solo objetos programables.
   ============================================================ */

/* ---------- sp_inventory_count_apply (SQL_STORED_PROCEDURE) ---------- */
/* sp_inventory_count_apply
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* ---------------------------------------------- ajuste por conteo fisico
   Lo mismo que hacia `inventory:apply-count` en el proceso principal, pero en
   una transaccion y con la fila bloqueada: dos ajustes a la vez sobre el
   mismo producto ya no pueden calcular la diferencia contra un stock viejo. */
CREATE OR ALTER PROCEDURE dbo.sp_inventory_count_apply
    @product_id INT,
    @fisico     DECIMAL(12, 2),
    @user_id    INT = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;
    IF @fisico IS NULL OR @fisico < 0
    BEGIN RAISERROR('El conteo no puede ser negativo.', 16, 1); RETURN; END

    BEGIN TRAN;
    DECLARE @teorico DECIMAL(12, 2), @costo DECIMAL(14, 4);
    SELECT @teorico = ISNULL(stock, 0), @costo = cost FROM dbo.products WITH (UPDLOCK, ROWLOCK) WHERE id = @product_id;
    IF @@ROWCOUNT = 0
    BEGIN ROLLBACK; RAISERROR('Ese producto no existe.', 16, 1); RETURN; END

    DECLARE @dif DECIMAL(12, 2) = @fisico - @teorico;
    IF @dif <> 0
    BEGIN
        UPDATE dbo.products SET stock = @fisico WHERE id = @product_id;
        /* 0096: con el costo de HOY guardado en el movimiento. Sin él, el
           estado de resultados valuaba el faltante con el costo del día en
           que se consultaba: un mes ya cerrado cambiaba de utilidad cada vez
           que cambiaba el precio de compra (lo encontró la simulación de 60
           días de la taquería: $598.50 contra $580.30). */
        INSERT INTO dbo.inventory_movements (product_id, typee, reference, quantity, datee, descriptionn, unit_cost)
        VALUES (@product_id, CASE WHEN @dif > 0 THEN 'entrada' ELSE 'salida' END, 'CONTEO', ABS(@dif), GETDATE(),
                'Ajuste por conteo fisico (dif ' + CONVERT(NVARCHAR(20), CONVERT(FLOAT, @dif)) + ')', @costo);
    END
    COMMIT;
    SELECT @teorico AS teorico, @fisico AS fisico, @dif AS diferencia;
END
GO
