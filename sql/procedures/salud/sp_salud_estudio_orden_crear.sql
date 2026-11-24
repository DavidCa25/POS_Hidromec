/* sp_salud_estudio_orden_crear
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* Abre la orden de estudios de un paciente. Cada estudio guarda la copia de
 * su nombre, precio y parámetros: si mañana cambia el catálogo, lo que se
 * pidió hoy no cambia. El cobro (la orden de servicio) lo enlaza quien llama,
 * en la misma transacción, con sp_salud_estudio_orden_vincular.
 *
 * @items: JSON [{ "productId": 12 }, ...]
 */
CREATE OR ALTER PROCEDURE [dbo].[sp_salud_estudio_orden_crear]
    @customer_id  INT,
    @items        NVARCHAR(MAX),
    @medico       NVARCHAR(160) = NULL,
    @indicaciones NVARCHAR(600) = NULL,
    @user_id      INT = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    IF NOT EXISTS (SELECT 1 FROM dbo.salud_pacientes WHERE customer_id = @customer_id)
    BEGIN RAISERROR('SIN_FICHA: primero da de alta la ficha del paciente.', 16, 1); RETURN; END
    IF NOT EXISTS (SELECT 1 FROM dbo.salud_pacientes WHERE customer_id = @customer_id AND consentimiento_at IS NOT NULL)
    BEGIN RAISERROR('SIN_CONSENTIMIENTO: el paciente no ha dado su consentimiento.', 16, 1); RETURN; END
    IF ISJSON(@items) = 0 BEGIN RAISERROR('Elige al menos un estudio.', 16, 1); RETURN; END

    DECLARE @ids TABLE (n INT IDENTITY(1,1), product_id INT);
    INSERT INTO @ids (product_id)
    SELECT TRY_CONVERT(INT, productId) FROM OPENJSON(@items) WITH (productId NVARCHAR(12) '$.productId');
    IF NOT EXISTS (SELECT 1 FROM @ids) BEGIN RAISERROR('Elige al menos un estudio.', 16, 1); RETURN; END
    IF EXISTS (SELECT 1 FROM @ids i WHERE NOT EXISTS (
        SELECT 1 FROM dbo.salud_estudios e JOIN dbo.products p ON p.id = e.product_id
         WHERE e.product_id = i.product_id AND p.active = 1))
    BEGIN RAISERROR('Uno de los estudios ya no está en el catálogo.', 16, 1); RETURN; END

    BEGIN TRAN;
    INSERT INTO dbo.salud_estudio_ordenes (paciente_id, medico, indicaciones, created_by)
    VALUES (@customer_id, NULLIF(LTRIM(RTRIM(@medico)), N''), NULLIF(LTRIM(RTRIM(@indicaciones)), N''), @user_id);
    DECLARE @id INT = SCOPE_IDENTITY();

    INSERT INTO dbo.salud_estudio_items (orden_id, product_id, nombre, tipo, modalidad, parametros, precio)
    SELECT @id, e.product_id, p.nombre, e.tipo, e.modalidad, e.parametros, p.price
      FROM @ids i
      JOIN dbo.salud_estudios e ON e.product_id = i.product_id
      JOIN dbo.products p ON p.id = e.product_id
     ORDER BY i.n;

    INSERT INTO dbo.salud_bitacora (user_id, paciente_id, accion) VALUES (@user_id, @customer_id, N'ESTUDIO');
    COMMIT;

    SELECT o.id, o.folio FROM dbo.salud_estudio_ordenes o WHERE o.id = @id;
    SELECT i.id, i.product_id, i.nombre, i.precio FROM dbo.salud_estudio_items i WHERE i.orden_id = @id ORDER BY i.id;
END
GO
