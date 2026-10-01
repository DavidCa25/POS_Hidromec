/* sp_hosp_cuenta_cobrar
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* COBRADA: igual que en 0040, y el cliente de la cuenta queda el de la venta
   (la venta es la que manda; la caja ya los tenia iguales). */
CREATE OR ALTER PROCEDURE dbo.sp_hosp_cuenta_cobrar
    @cuenta_id INT,
    @sale_id INT,
    @user_id INT = NULL
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @estado NVARCHAR(12), @actual INT;
    SELECT @estado = estado, @actual = sale_id FROM dbo.hosp_cuentas WHERE id = @cuenta_id;
    IF @estado IS NULL BEGIN RAISERROR('La cuenta no existe.', 16, 1); RETURN; END
    IF NOT EXISTS (SELECT 1 FROM dbo.sales WHERE id = @sale_id)
    BEGIN RAISERROR('La venta no existe.', 16, 1); RETURN; END

    IF @estado = 'COBRADA'
    BEGIN
        IF @actual = @sale_id
        BEGIN SELECT id, estado, sale_id FROM dbo.hosp_cuentas WHERE id = @cuenta_id; RETURN; END
        RAISERROR('Esta cuenta ya se cobró con otra venta.', 16, 1); RETURN;
    END
    IF @estado = 'CANCELADA' BEGIN RAISERROR('Esta cuenta se canceló.', 16, 1); RETURN; END

    UPDATE c
       SET estado = 'COBRADA', sale_id = @sale_id, cerrada_por = @user_id, cerrada_en = SYSDATETIME(),
           customer_id = s.customer_id
      FROM dbo.hosp_cuentas c
      JOIN dbo.sales s ON s.id = @sale_id
     WHERE c.id = @cuenta_id;

    SELECT id, estado, sale_id FROM dbo.hosp_cuentas WHERE id = @cuenta_id;
END
GO
