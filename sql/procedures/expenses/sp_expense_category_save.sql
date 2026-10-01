/* sp_expense_category_save
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* ------------------------------------------------------------------------
   Crear o editar un concepto de egreso (Renta, Uber, Didi, Gas...).

   @id NULL  -> crea. Un concepto creado por el negocio siempre es GENERAL:
                "Pago al personal" (PERSONAL) lo trae el sistema y es el unico.
   @id dado  -> renombra, activa/desactiva y cambia el orden.

   No se borra nada: un concepto usado en egresos pasados se DESACTIVA, y los
   egresos siguen diciendo en que se gasto. El concepto del sistema se puede
   renombrar y reordenar, pero no desactivar: sin el no habria donde
   registrar un pago al personal.
   ------------------------------------------------------------------------ */
CREATE OR ALTER PROCEDURE dbo.sp_expense_category_save
    @id          INT = NULL,
    @name        NVARCHAR(60),
    @active      BIT = 1,
    @sort_order  INT = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    SET @name = LTRIM(RTRIM(ISNULL(@name, N'')));
    IF @name = N''
    BEGIN
        RAISERROR('El concepto necesita un nombre.', 16, 1);
        RETURN;
    END

    IF EXISTS (SELECT 1 FROM dbo.expense_categories WHERE name = @name AND (@id IS NULL OR id <> @id))
    BEGIN
        RAISERROR('Ya existe un concepto con ese nombre.', 16, 1);
        RETURN;
    END

    IF @id IS NULL
    BEGIN
        /* Nuevo: al final de la lista, salvo que se pida otro lugar. */
        IF @sort_order IS NULL
            SELECT @sort_order = ISNULL(MAX(sort_order), 0) + 10
              FROM dbo.expense_categories WHERE sort_order < 1000;
        INSERT INTO dbo.expense_categories (name, kind, is_system, active, sort_order)
        VALUES (@name, 'GENERAL', 0, ISNULL(@active, 1), @sort_order);
        SET @id = SCOPE_IDENTITY();
    END
    ELSE
    BEGIN
        IF NOT EXISTS (SELECT 1 FROM dbo.expense_categories WHERE id = @id)
        BEGIN
            RAISERROR('El concepto no existe.', 16, 1);
            RETURN;
        END
        IF ISNULL(@active, 1) = 0 AND EXISTS (SELECT 1 FROM dbo.expense_categories WHERE id = @id AND is_system = 1)
        BEGIN
            RAISERROR('Este concepto es del sistema y no se puede desactivar. Puedes cambiarle el nombre.', 16, 1);
            RETURN;
        END
        UPDATE dbo.expense_categories
           SET name = @name,
               active = ISNULL(@active, active),
               sort_order = ISNULL(@sort_order, sort_order),
               updated_at = SYSDATETIME()
         WHERE id = @id;
    END

    SELECT id, name, kind, is_system, active, sort_order
      FROM dbo.expense_categories WHERE id = @id;
END
GO
