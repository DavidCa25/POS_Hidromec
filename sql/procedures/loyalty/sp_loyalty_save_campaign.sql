/* sp_loyalty_save_campaign
 * Definicion canonica. Mantener este archivo y generar una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* ---- Crear o actualizar una campana.
   `@id` nulo = alta. Las condiciones nulas NO condicionan, que es lo que
   permite una campana sin requisitos sin inventar valores centinela. */
CREATE OR ALTER PROCEDURE [dbo].[sp_loyalty_save_campaign]
    @id INT = NULL,
    @name NVARCHAR(120),
    @description NVARCHAR(400) = NULL,
    @outcome NVARCHAR(20),
    @reward_definition_id INT = NULL,
    @coupon_definition_id INT = NULL,
    @dynamic_definition_id INT = NULL,
    @raffle_id INT = NULL,
    @quantity INT = 1,
    @per_amount DECIMAL(12,2) = NULL,
    @min_total DECIMAL(12,2) = NULL,
    @product_id INT = NULL,
    @requires_customer BIT = 0,
    @first_purchase_only BIT = 0,
    @weekday_mask TINYINT = NULL,
    @time_from TIME(0) = NULL,
    @time_to TIME(0) = NULL,
    @starts_at DATETIME2(0) = NULL,
    @ends_at DATETIME2(0) = NULL,
    @priority INT = 100,
    @active BIT = 1
AS
BEGIN
    SET NOCOUNT ON;

    IF LTRIM(RTRIM(ISNULL(@name, N''))) = N''
    BEGIN RAISERROR('La campana necesita un nombre.', 16, 1); RETURN; END

    /* Una campana que no dice QUE otorga no sirve para nada, y dejarla
       guardar seria dejar que falle en silencio la primera vez que se venda. */
    IF (@outcome = 'REWARD' AND @reward_definition_id IS NULL)
    OR (@outcome = 'COUPON' AND @coupon_definition_id IS NULL)
    OR (@outcome = 'DYNAMIC' AND @dynamic_definition_id IS NULL)
    OR (@outcome = 'RAFFLE_ENTRY' AND @raffle_id IS NULL)
    BEGIN RAISERROR('Falta indicar que otorga la campana.', 16, 1); RETURN; END

    IF ISNULL(@quantity, 0) < 1 SET @quantity = 1;

    IF @id IS NULL
    BEGIN
        INSERT INTO dbo.campaigns
            (name, description, outcome, reward_definition_id, coupon_definition_id,
             dynamic_definition_id, raffle_id, quantity, per_amount, min_total, product_id,
             requires_customer, first_purchase_only, weekday_mask, time_from, time_to,
             starts_at, ends_at, priority, active)
        VALUES
            (@name, @description, @outcome, @reward_definition_id, @coupon_definition_id,
             @dynamic_definition_id, @raffle_id, @quantity, @per_amount, @min_total, @product_id,
             @requires_customer, @first_purchase_only, @weekday_mask, @time_from, @time_to,
             @starts_at, @ends_at, @priority, @active);
        SET @id = SCOPE_IDENTITY();
    END
    ELSE
    BEGIN
        UPDATE dbo.campaigns
           SET name = @name, description = @description, outcome = @outcome,
               reward_definition_id = @reward_definition_id,
               coupon_definition_id = @coupon_definition_id,
               dynamic_definition_id = @dynamic_definition_id,
               raffle_id = @raffle_id,
               quantity = @quantity, per_amount = @per_amount,
               min_total = @min_total, product_id = @product_id,
               requires_customer = @requires_customer, first_purchase_only = @first_purchase_only,
               weekday_mask = @weekday_mask, time_from = @time_from, time_to = @time_to,
               starts_at = @starts_at, ends_at = @ends_at,
               priority = @priority, active = @active
         WHERE id = @id;
    END

    SELECT id, name, outcome, active FROM dbo.campaigns WHERE id = @id;
END
GO
