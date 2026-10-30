/* sp_platform_settlement_link
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* =================== sp_platform_settlement_link (0069) ===================
   Empareja A MANO un pedido de la plataforma con una venta de la caja (la
   que la regla no pudo decidir), o lo suelta con @sale_id = NULL. Solo en
   BORRADOR, y solo con una venta candidata que nadie mas haya tomado.
   ==================================================================== */
CREATE OR ALTER PROCEDURE dbo.sp_platform_settlement_link
    @settlement_id INT,
    @order_line_id INT,
    @sale_id       INT = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;
    IF NOT EXISTS (SELECT 1 FROM dbo.platform_settlements WHERE id = @settlement_id AND status = 'BORRADOR')
        THROW 51000, 'Solo se empareja una liquidacion en borrador.', 1;
    IF NOT EXISTS (SELECT 1 FROM dbo.platform_settlement_orders WHERE id = @order_line_id AND settlement_id = @settlement_id)
        THROW 51000, 'Ese pedido no es de esta liquidacion.', 1;
    IF EXISTS (SELECT 1 FROM dbo.platform_settlement_orders WHERE id = @order_line_id AND cancelled = 1) AND @sale_id IS NOT NULL
        THROW 51000, 'La plataforma cancelo ese pedido: no lleva venta.', 1;

    IF @sale_id IS NOT NULL
    BEGIN
        CREATE TABLE #candidatas (sale_id INT PRIMARY KEY, datee DATETIME2(0), dia DATE, amount DECIMAL(14, 2),
            reference NVARCHAR(100) COLLATE DATABASE_DEFAULT, nref NVARCHAR(100) COLLATE DATABASE_DEFAULT, channel_id NVARCHAR(64) COLLATE DATABASE_DEFAULT, channel_name NVARCHAR(120) COLLATE DATABASE_DEFAULT,
            mapped BIT, in_period BIT);
        EXEC dbo.sp_platform_settlement_candidates @settlement_id = @settlement_id;
        IF NOT EXISTS (SELECT 1 FROM #candidatas WHERE sale_id = @sale_id)
            THROW 51000, 'Esa venta no se pago en plataforma en este periodo, o ya esta en otra liquidacion.', 1;
        IF EXISTS (SELECT 1 FROM dbo.platform_settlement_orders WHERE settlement_id = @settlement_id AND sale_id = @sale_id AND id <> @order_line_id)
            THROW 51000, 'Esa venta ya esta emparejada con otro pedido.', 1;
    END

    UPDATE dbo.platform_settlement_orders
       SET sale_id = @sale_id, match_kind = CASE WHEN @sale_id IS NULL THEN NULL ELSE 'MANUAL' END
     WHERE id = @order_line_id;
    UPDATE dbo.platform_settlements SET updated_at = SYSDATETIME() WHERE id = @settlement_id;
    SELECT @order_line_id AS id, @sale_id AS sale_id;
END
GO
