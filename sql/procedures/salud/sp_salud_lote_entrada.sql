/* sp_salud_lote_entrada
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* Asigna lote y caducidad a existencia que YA entró (por compra o conteo).
 * No suma a products.stock: el lote es trazabilidad, no otra existencia.
 * Por eso los lotes no pueden sumar más que el stock.
 */
CREATE OR ALTER PROCEDURE [dbo].[sp_salud_lote_entrada]
    @product_id INT,
    @lote       NVARCHAR(40),
    @caducidad  DATE,
    @cantidad   DECIMAL(12,3),
    @costo      DECIMAL(14,4) = NULL,
    @nota       NVARCHAR(200) = NULL,
    @user_id    INT = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    SET @lote = UPPER(LTRIM(RTRIM(ISNULL(@lote, N''))));
    IF @lote = N''
    BEGIN RAISERROR('Escribe el número de lote.', 16, 1); RETURN; END
    IF @caducidad IS NULL
    BEGIN RAISERROR('Escribe la fecha de caducidad.', 16, 1); RETURN; END
    IF @caducidad <= CAST(GETDATE() AS DATE)
    BEGIN RAISERROR('Ese lote ya está caducado: no se puede dar de alta para venta.', 16, 1); RETURN; END
    IF ISNULL(@cantidad, 0) <= 0
    BEGIN RAISERROR('La cantidad debe ser mayor a cero.', 16, 1); RETURN; END

    BEGIN TRAN;

    DECLARE @stock DECIMAL(12,3) = (SELECT CAST(ISNULL(stock, 0) AS DECIMAL(12,3))
                                      FROM dbo.products WITH (UPDLOCK, HOLDLOCK) WHERE id = @product_id);
    IF @stock IS NULL
    BEGIN ROLLBACK; RAISERROR('El producto no existe.', 16, 1); RETURN; END

    DECLARE @en_lotes DECIMAL(12,3) = (SELECT ISNULL(SUM(cantidad), 0)
                                         FROM dbo.salud_lotes WITH (UPDLOCK, HOLDLOCK) WHERE product_id = @product_id);
    IF @en_lotes + @cantidad > @stock
    BEGIN
        ROLLBACK;
        DECLARE @msg NVARCHAR(300) = CONCAT(
            N'LOTES_EXCEDEN_STOCK: la existencia es ', FORMAT(@stock, 'N0'), N' y ya hay ',
            FORMAT(@en_lotes, 'N0'), N' con lote. Registra primero la compra.');
        RAISERROR(@msg, 16, 1);
        RETURN;
    END

    /* Si el producto aún no tiene ficha, nace con control de lotes. */
    IF NOT EXISTS (SELECT 1 FROM dbo.salud_productos WHERE product_id = @product_id)
        INSERT INTO dbo.salud_productos (product_id, controla_lotes, updated_by) VALUES (@product_id, 1, @user_id);

    DECLARE @lote_id INT = (SELECT id FROM dbo.salud_lotes
                             WHERE product_id = @product_id AND lote = @lote AND caducidad = @caducidad);
    IF @lote_id IS NULL
    BEGIN
        INSERT INTO dbo.salud_lotes (product_id, lote, caducidad, cantidad, costo)
        VALUES (@product_id, @lote, @caducidad, @cantidad, @costo);
        SET @lote_id = SCOPE_IDENTITY();
    END
    ELSE
        UPDATE dbo.salud_lotes SET cantidad = cantidad + @cantidad, costo = ISNULL(@costo, costo)
         WHERE id = @lote_id;

    INSERT INTO dbo.salud_lote_movimientos (product_id, lote_id, tipo, cantidad, user_id, nota)
    VALUES (@product_id, @lote_id, N'ENTRADA', @cantidad, @user_id, NULLIF(LTRIM(RTRIM(@nota)), N''));

    COMMIT;

    SELECT id AS lote_id, product_id, lote, caducidad, cantidad FROM dbo.salud_lotes WHERE id = @lote_id;
END
GO
