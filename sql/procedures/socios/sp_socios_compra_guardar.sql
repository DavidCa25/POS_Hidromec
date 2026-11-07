/* sp_socios_compra_guardar
 * Definicion canonica. Mantener este archivo y generar una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* ===================== sp_socios_compra_guardar (0079) ====================
   Quien pago una compra. Lo llama el canal de compras justo despues de
   registrarla.

   @pagado_por NULL = el negocio (cajon, banco): lo comprado es anticipo del
               dueno de cada producto.
               Un socio = de su bolsa: no hay anticipo; al venderse,
               recupera su costo.
   ======================================================================= */
CREATE OR ALTER PROCEDURE dbo.sp_socios_compra_guardar
    @purchase_id INT,
    @pagado_por  INT = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    IF NOT EXISTS (SELECT 1 FROM dbo.business_modules WHERE module_key = N'socios' AND enabled = 1)
        THROW 51000, N'Socios no está activado.', 1;
    IF NOT EXISTS (SELECT 1 FROM dbo.purchase WHERE id = @purchase_id) THROW 51000, N'Esa compra no existe.', 1;
    IF @pagado_por IS NOT NULL AND NOT EXISTS (SELECT 1 FROM dbo.socios WHERE id = @pagado_por AND activo = 1)
        THROW 51000, N'Ese socio no está activo.', 1;
    /* Una compra que salio del cajon no la pago nadie de su bolsa. */
    IF @pagado_por IS NOT NULL AND EXISTS (
        SELECT 1 FROM dbo.supplier_payments sp
         WHERE sp.purchase_id = @purchase_id AND sp.cash_movement_id IS NOT NULL)
        THROW 51000, N'Esa compra se pagó con efectivo del cajón: la pagó el negocio.', 1;

    BEGIN TRAN;
        DELETE FROM dbo.socios_compra WHERE purchase_id = @purchase_id;
        IF @pagado_por IS NOT NULL
            INSERT INTO dbo.socios_compra (purchase_id, pagado_por_socio_id) VALUES (@purchase_id, @pagado_por);
    COMMIT;

    SELECT @purchase_id AS purchase_id, @pagado_por AS pagado_por_socio_id;
END
GO
