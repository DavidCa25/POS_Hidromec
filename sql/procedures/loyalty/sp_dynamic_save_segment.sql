/* sp_dynamic_save_segment
 * Definicion canonica. Mantener este archivo y generar una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* ============================================================
   sp_dynamic_save_segment — crear, cambiar o quitar un sector de la ruleta.

   UNO a uno, no la lista entera de golpe. Reemplazar todos los sectores en
   cada guardado significaria borrarlos y volver a crearlos, y con ello
   cambiarian sus ids: los intentos ya jugados apuntan a un `segment_id`, y
   un premio reclamado tiene que poder seguir diciendo QUE sector salio.

   `@borrar` desactiva en vez de eliminar, por lo mismo: un sector que ya
   premio a alguien no se puede hacer desaparecer del historial.
   ============================================================ */
CREATE OR ALTER PROCEDURE [dbo].[sp_dynamic_save_segment]
    @id INT = NULL,
    @definition_id INT,
    @label NVARCHAR(60),
    @outcome NVARCHAR(16) = 'NONE',        -- NONE | REWARD | RAFFLE_ENTRY
    @reward_definition_id INT = NULL,
    @raffle_id INT = NULL,
    @quantity INT = 1,
    @weight INT = 1,
    @sort_order INT = NULL,
    @borrar BIT = 0
AS
BEGIN
    SET NOCOUNT ON;

    IF NOT EXISTS (SELECT 1 FROM dbo.dynamic_definitions WHERE id = @definition_id)
    BEGIN RAISERROR('La dinamica no existe.', 16, 1); RETURN; END

    /* Quitar: se desactiva. Ver la nota de arriba. */
    IF @borrar = 1
    BEGIN
        IF @id IS NULL BEGIN RAISERROR('Falta el sector que se quiere quitar.', 16, 1); RETURN; END
        UPDATE dbo.dynamic_segments SET active = 0 WHERE id = @id AND definition_id = @definition_id;
        EXEC dbo.sp_dynamic_segments @definition_id = @definition_id;
        RETURN;
    END

    IF LTRIM(RTRIM(ISNULL(@label, N''))) = N''
    BEGIN RAISERROR('Cada sector necesita una etiqueta: es lo que lee el cliente.', 16, 1); RETURN; END

    SET @outcome = UPPER(LTRIM(RTRIM(ISNULL(@outcome, N'NONE'))));
    IF @outcome NOT IN ('NONE', 'REWARD', 'RAFFLE_ENTRY')
    BEGIN RAISERROR('Resultado de sector desconocido.', 16, 1); RETURN; END

    /* Un sector que promete algo tiene que decir QUE promete. Sin esto se
       guardaria "Bebida gratis" sin bebida, y la ruleta pararia ahi sin
       entregar nada. */
    IF @outcome = 'REWARD' AND @reward_definition_id IS NULL
    BEGIN RAISERROR('Ese sector entrega una recompensa: elige cual.', 16, 1); RETURN; END
    IF @outcome = 'RAFFLE_ENTRY' AND @raffle_id IS NULL
    BEGIN RAISERROR('Ese sector entrega boletos: elige la rifa.', 16, 1); RETURN; END

    IF ISNULL(@quantity, 0) < 1 SET @quantity = 1;
    IF ISNULL(@weight, 0) < 0 SET @weight = 0;

    IF @sort_order IS NULL
        SELECT @sort_order = ISNULL(MAX(sort_order), -1) + 1
        FROM dbo.dynamic_segments WHERE definition_id = @definition_id;

    IF @id IS NULL
    BEGIN
        INSERT INTO dbo.dynamic_segments
            (definition_id, sort_order, label, outcome, reward_definition_id, raffle_id, quantity, weight, active)
        VALUES
            (@definition_id, @sort_order, @label, @outcome,
             CASE WHEN @outcome = 'REWARD' THEN @reward_definition_id END,
             CASE WHEN @outcome = 'RAFFLE_ENTRY' THEN @raffle_id END,
             @quantity, @weight, 1);
    END
    ELSE
    BEGIN
        UPDATE dbo.dynamic_segments
           SET label = @label, outcome = @outcome,
               reward_definition_id = CASE WHEN @outcome = 'REWARD' THEN @reward_definition_id END,
               raffle_id = CASE WHEN @outcome = 'RAFFLE_ENTRY' THEN @raffle_id END,
               quantity = @quantity, weight = @weight, sort_order = @sort_order,
               active = 1
         WHERE id = @id AND definition_id = @definition_id;
    END

    EXEC dbo.sp_dynamic_segments @definition_id = @definition_id;
END
GO
