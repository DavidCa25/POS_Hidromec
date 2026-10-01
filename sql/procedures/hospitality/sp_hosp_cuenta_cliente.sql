/* sp_hosp_cuenta_cliente
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* ASIGNAR, CAMBIAR o QUITAR (@customer_id NULL) el cliente de una cuenta
   abierta. Lo llama la caja cuando cambia el cliente de su carrito. */
CREATE OR ALTER PROCEDURE dbo.sp_hosp_cuenta_cliente
    @cuenta_id INT,
    @customer_id INT = NULL,
    @user_id INT = NULL
AS
BEGIN
    SET NOCOUNT ON;
    IF NOT EXISTS (SELECT 1 FROM dbo.hosp_cuentas WHERE id = @cuenta_id AND estado IN ('ABIERTA', 'POR_COBRAR'))
    BEGIN RAISERROR('Esta cuenta ya está cerrada.', 16, 1); RETURN; END
    IF @customer_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM dbo.customers WHERE id = @customer_id)
    BEGIN RAISERROR('El cliente no existe.', 16, 1); RETURN; END
    UPDATE dbo.hosp_cuentas SET customer_id = @customer_id WHERE id = @cuenta_id;
    SELECT c.id, c.customer_id, cu.customerName AS customer_name
      FROM dbo.hosp_cuentas c
      LEFT JOIN dbo.customers cu ON cu.id = c.customer_id
     WHERE c.id = @cuenta_id;
END
GO
