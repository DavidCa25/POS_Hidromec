/* sp_loyalty_save_definition
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* ---- Crear o actualizar una DEFINICION de recompensa, cupon o dinamica.
   Un solo procedimiento para los tres porque el alta es la misma operacion
   -nombre, tipo, parametros, activo- y separarla en tres habria triplicado la
   misma validacion. `@kind_of` dice de cual se trata.

   Cada tipo exige lo suyo ANTES de guardar: una recompensa de importe sin
   importe, o una dinamica TIMING sin objetivo, se guardarian y fallarian mas
   tarde, cuando ya hay un cliente delante de la pantalla. */
CREATE OR ALTER PROCEDURE [dbo].[sp_loyalty_save_definition]
    @kind_of NVARCHAR(10),              -- REWARD | COUPON | DYNAMIC
    @id INT = NULL,
    @name NVARCHAR(120),
    @kind NVARCHAR(20) = NULL,          -- recompensa/cupon: FREE_PRODUCT, AMOUNT, PERCENT...
    @type NVARCHAR(20) = NULL,          -- dinamica: TIMING, WHEEL...
    @description NVARCHAR(400) = NULL,
    @product_id INT = NULL,
    @amount DECIMAL(12,2) = NULL,
    @discount_pct DECIMAL(5,2) = NULL,
    @valid_days INT = NULL,
    @uses_allowed INT = 1,
    @code_prefix NVARCHAR(8) = NULL,
    @target_value DECIMAL(12,4) = NULL,
    @tolerance DECIMAL(12,4) = NULL,
    @attempts_allowed INT = 1,
    @reward_definition_id INT = NULL,
    @active BIT = 1
AS
BEGIN
    SET NOCOUNT ON;

    IF LTRIM(RTRIM(ISNULL(@name, N''))) = N''
    BEGIN RAISERROR('Falta el nombre.', 16, 1); RETURN; END
    IF ISNULL(@uses_allowed, 0) < 1 SET @uses_allowed = 1;

    IF @kind_of = 'REWARD'
    BEGIN
        IF @kind = 'FREE_PRODUCT' AND @product_id IS NULL
        BEGIN RAISERROR('Una recompensa de producto gratis necesita el producto.', 16, 1); RETURN; END
        IF @kind = 'AMOUNT' AND ISNULL(@amount, 0) <= 0
        BEGIN RAISERROR('Una recompensa de importe necesita un importe mayor que cero.', 16, 1); RETURN; END
        IF @kind = 'PERCENT' AND ISNULL(@discount_pct, 0) <= 0
        BEGIN RAISERROR('Una recompensa de porcentaje necesita un porcentaje mayor que cero.', 16, 1); RETURN; END

        IF @id IS NULL
        BEGIN
            INSERT INTO dbo.reward_definitions (name, kind, product_id, amount, discount_pct, notes, valid_days, uses_allowed, active)
            VALUES (@name, @kind, @product_id, @amount, @discount_pct, @description, @valid_days, @uses_allowed, @active);
            SET @id = SCOPE_IDENTITY();
        END
        ELSE
            UPDATE dbo.reward_definitions
               SET name = @name, kind = @kind, product_id = @product_id, amount = @amount,
                   discount_pct = @discount_pct, notes = @description, valid_days = @valid_days,
                   uses_allowed = @uses_allowed, active = @active
             WHERE id = @id;

        SELECT id, name, kind, active FROM dbo.reward_definitions WHERE id = @id;
        RETURN;
    END

    IF @kind_of = 'COUPON'
    BEGIN
        IF @kind = 'FREE_PRODUCT' AND @product_id IS NULL
        BEGIN RAISERROR('Un cupon de producto gratis necesita el producto.', 16, 1); RETURN; END
        IF @kind = 'AMOUNT' AND ISNULL(@amount, 0) <= 0
        BEGIN RAISERROR('Un cupon de importe necesita un importe mayor que cero.', 16, 1); RETURN; END
        IF @kind = 'PERCENT' AND ISNULL(@discount_pct, 0) <= 0
        BEGIN RAISERROR('Un cupon de porcentaje necesita un porcentaje mayor que cero.', 16, 1); RETURN; END
        IF LTRIM(RTRIM(ISNULL(@code_prefix, N''))) = N'' SET @code_prefix = N'WYBIX';

        IF @id IS NULL
        BEGIN
            INSERT INTO dbo.coupon_definitions (name, kind, amount, discount_pct, product_id, valid_days, uses_allowed, code_prefix, active)
            VALUES (@name, @kind, @amount, @discount_pct, @product_id, @valid_days, @uses_allowed, @code_prefix, @active);
            SET @id = SCOPE_IDENTITY();
        END
        ELSE
            UPDATE dbo.coupon_definitions
               SET name = @name, kind = @kind, amount = @amount, discount_pct = @discount_pct,
                   product_id = @product_id, valid_days = @valid_days,
                   uses_allowed = @uses_allowed, code_prefix = @code_prefix, active = @active
             WHERE id = @id;

        SELECT id, name, kind, active FROM dbo.coupon_definitions WHERE id = @id;
        RETURN;
    END

    IF @kind_of = 'DYNAMIC'
    BEGIN
        /* TIMING solo necesita el segundo objetivo.
           `tolerance` ya no participa: el juego es exacto a la centesima y
           exigir un margen mayor que cero impedia guardar justo la dinamica
           que se queria -"detenlo en 10.00 clavados"-. La columna se conserva
           porque hay definiciones viejas que la traen; simplemente se ignora. */
        IF @type = 'TIMING' AND ISNULL(@target_value, 0) <= 0
        BEGIN RAISERROR('Una dinamica de cronometro necesita el segundo objetivo.', 16, 1); RETURN; END
        IF ISNULL(@attempts_allowed, 0) < 1 SET @attempts_allowed = 1;

        IF @id IS NULL
        BEGIN
            INSERT INTO dbo.dynamic_definitions (name, type, description, target_value, tolerance, attempts_allowed, reward_definition_id, active)
            VALUES (@name, @type, @description, @target_value, @tolerance, @attempts_allowed, @reward_definition_id, @active);
            SET @id = SCOPE_IDENTITY();
        END
        ELSE
            UPDATE dbo.dynamic_definitions
               SET name = @name, type = @type, description = @description,
                   target_value = @target_value, tolerance = @tolerance,
                   attempts_allowed = @attempts_allowed,
                   reward_definition_id = @reward_definition_id, active = @active
             WHERE id = @id;

        SELECT id, name, type, active FROM dbo.dynamic_definitions WHERE id = @id;
        RETURN;
    END

    RAISERROR('Tipo de definicion desconocido.', 16, 1);
END
GO
