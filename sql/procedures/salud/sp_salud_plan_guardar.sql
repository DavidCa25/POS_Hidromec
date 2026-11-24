/* sp_salud_plan_guardar
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* Crea o reescribe un plan de tratamiento PROPUESTO con sus procedimientos.
 * Aceptado ya no se reescribe: lo que el paciente aceptó es lo que se cobra.
 *
 * @items: JSON [{ "fase": 1, "diente": 36, "procedimiento": "Resina", "productId": 12, "precio": 650 }]
 */
CREATE OR ALTER PROCEDURE [dbo].[sp_salud_plan_guardar]
    @id          INT           = NULL,
    @customer_id INT,
    @titulo      NVARCHAR(120),
    @items       NVARCHAR(MAX),
    @user_id     INT
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    SET @titulo = NULLIF(LTRIM(RTRIM(@titulo)), N'');
    IF @titulo IS NULL BEGIN RAISERROR('Ponle nombre al plan.', 16, 1); RETURN; END
    IF @items IS NULL OR ISJSON(@items) <> 1 BEGIN RAISERROR('Procedimientos inválidos.', 16, 1); RETURN; END
    IF NOT EXISTS (SELECT 1 FROM dbo.salud_pacientes WHERE customer_id = @customer_id AND consentimiento_at IS NOT NULL)
    BEGIN RAISERROR('SIN_CONSENTIMIENTO: el paciente no ha dado su consentimiento para el tratamiento de sus datos.', 16, 1); RETURN; END

    DECLARE @it TABLE (fase TINYINT, diente TINYINT, procedimiento NVARCHAR(160), product_id INT, precio DECIMAL(10,2));
    INSERT INTO @it
    SELECT ISNULL(TRY_CAST(j.fase AS TINYINT), 1), TRY_CAST(j.diente AS TINYINT),
           LEFT(LTRIM(RTRIM(j.procedimiento)), 160), TRY_CAST(j.productId AS INT), TRY_CAST(j.precio AS DECIMAL(10,2))
      FROM OPENJSON(@items)
           WITH (fase NVARCHAR(5) '$.fase', diente NVARCHAR(5) '$.diente', procedimiento NVARCHAR(400) '$.procedimiento',
                 productId NVARCHAR(12) '$.productId', precio NVARCHAR(20) '$.precio') j;

    IF NOT EXISTS (SELECT 1 FROM @it)
    BEGIN RAISERROR('El plan necesita al menos un procedimiento.', 16, 1); RETURN; END
    IF EXISTS (SELECT 1 FROM @it WHERE NULLIF(procedimiento, N'') IS NULL OR precio IS NULL OR precio < 0)
    BEGIN RAISERROR('Cada procedimiento necesita nombre y precio.', 16, 1); RETURN; END
    IF EXISTS (SELECT 1 FROM @it i WHERE i.product_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM dbo.products p WHERE p.id = i.product_id))
    BEGIN RAISERROR('Uno de los servicios del plan ya no existe.', 16, 1); RETURN; END

    BEGIN TRAN;
    IF @id IS NULL
    BEGIN
        INSERT INTO dbo.salud_planes (paciente_id, titulo, created_by) VALUES (@customer_id, @titulo, @user_id);
        SET @id = SCOPE_IDENTITY();
    END
    ELSE
    BEGIN
        DECLARE @estado NVARCHAR(12), @pac INT;
        SELECT @estado = estado, @pac = paciente_id FROM dbo.salud_planes WITH (UPDLOCK) WHERE id = @id;
        IF @estado IS NULL OR @pac <> @customer_id BEGIN ROLLBACK; RAISERROR('El plan no existe.', 16, 1); RETURN; END
        IF @estado <> N'PROPUESTO' BEGIN ROLLBACK; RAISERROR('Un plan aceptado ya no se cambia.', 16, 1); RETURN; END
        UPDATE dbo.salud_planes SET titulo = @titulo WHERE id = @id;
        DELETE FROM dbo.salud_plan_items WHERE plan_id = @id;
    END

    INSERT INTO dbo.salud_plan_items (plan_id, fase, diente, procedimiento, product_id, precio)
    SELECT @id, fase, diente, procedimiento, product_id, precio FROM @it;

    INSERT INTO dbo.salud_bitacora (user_id, paciente_id, accion) VALUES (@user_id, @customer_id, N'PLAN');
    COMMIT;

    SELECT @id AS id;
END
GO
