/* sp_expense_category_move
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* Sube (@direction = -1) o baja (+1) un concepto un lugar en la lista,
   intercambiando su orden con el vecino. Primero se renumera la lista de 10 en
   10 para que dos conceptos con el mismo orden no se queden trabados. */
CREATE OR ALTER PROCEDURE dbo.sp_expense_category_move
    @id        INT,
    @direction INT
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    BEGIN TRAN;

    ;WITH orden AS (
        SELECT id, ROW_NUMBER() OVER (ORDER BY sort_order, name) * 10 AS nuevo
          FROM dbo.expense_categories WITH (UPDLOCK, HOLDLOCK)
    )
    UPDATE c SET sort_order = o.nuevo
      FROM dbo.expense_categories c JOIN orden o ON o.id = c.id;

    DECLARE @mio INT = (SELECT sort_order FROM dbo.expense_categories WHERE id = @id);
    IF @mio IS NULL
    BEGIN
        ROLLBACK TRAN;
        RAISERROR('El concepto no existe.', 16, 1);
        RETURN;
    END

    DECLARE @vecino INT = CASE WHEN @direction < 0
        THEN (SELECT TOP 1 id FROM dbo.expense_categories WHERE sort_order < @mio ORDER BY sort_order DESC)
        ELSE (SELECT TOP 1 id FROM dbo.expense_categories WHERE sort_order > @mio ORDER BY sort_order ASC)
    END;

    IF @vecino IS NOT NULL
    BEGIN
        DECLARE @suyo INT = (SELECT sort_order FROM dbo.expense_categories WHERE id = @vecino);
        UPDATE dbo.expense_categories SET sort_order = @suyo, updated_at = SYSDATETIME() WHERE id = @id;
        UPDATE dbo.expense_categories SET sort_order = @mio,  updated_at = SYSDATETIME() WHERE id = @vecino;
    END

    COMMIT TRAN;
END
GO
