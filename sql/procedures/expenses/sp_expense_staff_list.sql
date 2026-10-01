/* sp_expense_staff_list
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* ------------------------------------------------------------------------
   Personas a las que se les puede registrar un pago: las de `users`, que es
   la entidad del personal en Wybix. No hay tabla de empleados aparte.

   Solo lo necesario para elegir a alguien: sin contrasena ni permisos. Salen
   las activas y, ademas, las inactivas que ya tienen pagos (para poder
   consultar su historial).
   ------------------------------------------------------------------------ */
CREATE OR ALTER PROCEDURE dbo.sp_expense_staff_list
AS
BEGIN
    SET NOCOUNT ON;
    SELECT u.id, u.usuario, u.rol, CAST(ISNULL(u.active, 1) AS BIT) AS active,
           (SELECT COUNT(*) FROM dbo.expenses e WHERE e.staff_user_id = u.id AND e.voided_at IS NULL) AS pagos
      FROM dbo.users u
     WHERE ISNULL(u.active, 1) = 1
        OR EXISTS (SELECT 1 FROM dbo.expenses e WHERE e.staff_user_id = u.id)
     ORDER BY CASE WHEN ISNULL(u.active, 1) = 1 THEN 0 ELSE 1 END, u.usuario;
END
GO
