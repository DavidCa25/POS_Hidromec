/* sp_salud_lote_ajustar
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* Corrige cuánto queda de un lote (conteo, lote mal capturado, caducado
 * retirado). Deja el movimiento con signo: AJUSTE suma, MERMA resta, para
 * que el libro de control pueda llevar el saldo.
 */
CREATE OR ALTER PROCEDURE [dbo].[sp_salud_lote_ajustar]
    @lote_id        INT,
    @cantidad_nueva DECIMAL(12,3),
    @nota           NVARCHAR(200),
    @user_id        INT = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    SET @nota = NULLIF(LTRIM(RTRIM(@nota)), N'');
    IF @nota IS NULL
    BEGIN RAISERROR('Escribe el motivo del ajuste.', 16, 1); RETURN; END
    IF @cantidad_nueva IS NULL OR @cantidad_nueva < 0
    BEGIN RAISERROR('La cantidad no puede ser negativa.', 16, 1); RETURN; END

    BEGIN TRAN;
    DECLARE @actual DECIMAL(12,3), @product_id INT;
    SELECT @actual = cantidad, @product_id = product_id
      FROM dbo.salud_lotes WITH (UPDLOCK, HOLDLOCK) WHERE id = @lote_id;
    IF @product_id IS NULL
    BEGIN ROLLBACK; RAISERROR('El lote no existe.', 16, 1); RETURN; END

    IF @cantidad_nueva > @actual
    BEGIN
        DECLARE @stock DECIMAL(12,3) = (SELECT CAST(ISNULL(stock, 0) AS DECIMAL(12,3)) FROM dbo.products WHERE id = @product_id);
        DECLARE @otros DECIMAL(12,3) = (SELECT ISNULL(SUM(cantidad), 0) FROM dbo.salud_lotes WHERE product_id = @product_id AND id <> @lote_id);
        IF @otros + @cantidad_nueva > @stock
        BEGIN ROLLBACK; RAISERROR('LOTES_EXCEDEN_STOCK: los lotes no pueden sumar más que la existencia.', 16, 1); RETURN; END
    END

    IF @cantidad_nueva <> @actual
    BEGIN
        UPDATE dbo.salud_lotes SET cantidad = @cantidad_nueva WHERE id = @lote_id;
        INSERT INTO dbo.salud_lote_movimientos (product_id, lote_id, tipo, cantidad, user_id, nota)
        VALUES (@product_id, @lote_id,
                CASE WHEN @cantidad_nueva > @actual THEN N'AJUSTE' ELSE N'MERMA' END,
                ABS(@cantidad_nueva - @actual), @user_id, @nota);
    END
    COMMIT;

    SELECT id AS lote_id, product_id, lote, caducidad, cantidad FROM dbo.salud_lotes WHERE id = @lote_id;
END
GO
