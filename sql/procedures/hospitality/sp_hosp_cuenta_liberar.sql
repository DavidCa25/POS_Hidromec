/* sp_hosp_cuenta_liberar
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* LIBERAR una mesa sin cobrar: solo si no hay consumo. Una cuenta con
   lineas se cobra, o se cancelan sus comandas primero (eso lo decide un
   encargado): liberarla sin mas seria regalar lo que ya se sirvio. */
CREATE OR ALTER PROCEDURE dbo.sp_hosp_cuenta_liberar
    @cuenta_id INT,
    @user_id INT = NULL
AS
BEGIN
    SET NOCOUNT ON;
    IF NOT EXISTS (SELECT 1 FROM dbo.hosp_cuentas WHERE id = @cuenta_id AND estado IN ('ABIERTA', 'POR_COBRAR'))
    BEGIN RAISERROR('Esta cuenta ya está cerrada.', 16, 1); RETURN; END
    IF EXISTS (SELECT 1 FROM dbo.hosp_orden_lineas WHERE cuenta_id = @cuenta_id AND estado = 'ACTIVA')
    BEGIN RAISERROR('La mesa tiene consumo: cóbrala, o que un encargado cancele lo pedido.', 16, 1); RETURN; END

    UPDATE dbo.hosp_cuentas
       SET estado = 'CANCELADA', cerrada_por = @user_id, cerrada_en = SYSDATETIME()
     WHERE id = @cuenta_id;
    SELECT id, estado FROM dbo.hosp_cuentas WHERE id = @cuenta_id;
END
GO
