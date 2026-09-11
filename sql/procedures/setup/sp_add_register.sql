/* sp_add_register
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* ---- Crear caja ----
   code: prefijo de folio (C1, C2, ...). Si no se manda, se genera C{n}.
*/
CREATE OR ALTER PROCEDURE [dbo].[sp_add_register]
    @name NVARCHAR(60),
    @code NVARCHAR(10) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    BEGIN TRY
        BEGIN TRAN;

        IF (LTRIM(RTRIM(ISNULL(@name,''))) = '')
        BEGIN
            RAISERROR('El nombre de la caja es obligatorio.', 16, 1);
            ROLLBACK TRAN; RETURN;
        END

        -- Genera un code tipo C{siguiente} si no lo mandan
        IF (@code IS NULL OR LTRIM(RTRIM(@code)) = '')
        BEGIN
            DECLARE @next INT = (SELECT ISNULL(MAX(id),0) + 1 FROM dbo.registers);
            SET @code = CONCAT('C', @next);
        END

        IF EXISTS (SELECT 1 FROM dbo.registers WHERE code = @code)
        BEGIN
            RAISERROR('Ya existe una caja con ese codigo.', 16, 1);
            ROLLBACK TRAN; RETURN;
        END

        INSERT INTO dbo.registers (code, name, is_active)
        VALUES (@code, @name, 1);

        DECLARE @new_id INT = SCOPE_IDENTITY();

        /* La caja nace con su fila de asignacion, LIBRE. Que la fila exista
           siempre es lo que permite que reclamarla sea un UPDATE sobre la
           clave primaria -una sola sentencia, un solo candado- en vez de un
           INSERT condicional con su carrera. Nace en la misma transaccion
           que la caja: no hay ventana en la que exista una sin la otra. */
        INSERT INTO dbo.register_assignments
            (register_id, machine_id, machine_name, claimed_at, heartbeat_at, lease_until, released_at, released_by)
        VALUES (@new_id, N'', NULL, SYSUTCDATETIME(), SYSUTCDATETIME(), SYSUTCDATETIME(), SYSUTCDATETIME(), N'INICIAL');

        COMMIT TRAN;

        SELECT id, code, name, is_active, created_at
        FROM dbo.registers
        WHERE id = @new_id;
    END TRY
    BEGIN CATCH
        IF XACT_STATE() <> 0 ROLLBACK TRAN;
        DECLARE @msg NVARCHAR(4000) = ERROR_MESSAGE();
        RAISERROR(@msg, 16, 1);
    END CATCH
END
GO
