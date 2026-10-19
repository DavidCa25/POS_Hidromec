SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* ===================== sp_loyalty_points_manage (0064) =====================
   COSTO   pone (o quita, @valor NULL) el costo en puntos de una recompensa:
           eso la mete o la saca del catálogo de canje.
   AJUSTE  suma o resta puntos (o sellos de @card_id) a un cliente. La nota
           es obligatoria y queda quién lo hizo: un ajuste sin motivo es
           dinero que nadie puede explicar.
   ========================================================================== */
CREATE OR ALTER PROCEDURE dbo.sp_loyalty_points_manage
    @accion VARCHAR(10),
    @id INT,
    @valor INT = NULL,
    @card_id INT = NULL,
    @nota NVARCHAR(200) = NULL,
    @user_id INT = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;
    IF @accion = 'COSTO'
    BEGIN
        IF @valor IS NOT NULL AND @valor NOT BETWEEN 1 AND 1000000 THROW 51000, 'El costo va de 1 a 1,000,000 puntos.', 1;
        IF @valor IS NOT NULL AND NOT EXISTS (SELECT 1 FROM dbo.reward_definitions WHERE id = @id AND kind IN (N'FREE_PRODUCT', N'AMOUNT', N'PERCENT'))
            THROW 51000, 'Solo se canjean recompensas de producto gratis, monto o porcentaje.', 1;
        UPDATE dbo.reward_definitions SET points_cost = @valor WHERE id = @id;
        IF @@ROWCOUNT = 0 THROW 51000, 'La recompensa no existe.', 1;
        RETURN;
    END
    IF @accion = 'AJUSTE'
    BEGIN
        SET @nota = NULLIF(LTRIM(RTRIM(ISNULL(@nota, N''))), N'');
        IF @nota IS NULL THROW 51000, 'Escribe el motivo del ajuste.', 1;
        IF ISNULL(@valor, 0) = 0 THROW 51000, 'El ajuste no puede ser cero.', 1;
        IF NOT EXISTS (SELECT 1 FROM dbo.customers WHERE id = @id) THROW 51000, 'El cliente no existe.', 1;
        IF @card_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM dbo.loyalty_stamp_cards WHERE id = @card_id)
            THROW 51000, 'La tarjeta no existe.', 1;
        BEGIN TRAN;
        DECLARE @recurso NVARCHAR(40) = CONCAT(N'wx-loy-', @id);
        EXEC sp_getapplock @Resource = @recurso, @LockMode = 'Exclusive', @LockOwner = 'Transaction', @LockTimeout = 10000;
        INSERT INTO dbo.loyalty_ledger (customer_id, program, card_id, delta, kind, reason, user_id, note)
        VALUES (@id, CASE WHEN @card_id IS NULL THEN N'POINTS' ELSE N'STAMPS' END, @card_id, @valor, N'ADJUST', NULL, @user_id, @nota);
        COMMIT;
        RETURN;
    END
    ;THROW 51000, 'Acción no válida.', 1;
END;
GO
