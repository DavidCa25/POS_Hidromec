/* sp_customer_price_list_set
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* 0089 · La lista de precios de un cliente: el canal comercial cuyos precios
 * paga (p. ej. «MAYOREO»). NULL = el precio de mostrador.
 *
 * El canal debe existir en la politica comercial vigente. Mostrador no se
 * asigna: es lo que paga cualquiera sin lista.
 */
CREATE OR ALTER PROCEDURE [dbo].[sp_customer_price_list_set]
    @customer_id INT,
    @channel     NVARCHAR(64) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET @channel = NULLIF(LTRIM(RTRIM(@channel)), N'');
    IF @channel = N'LOCAL' SET @channel = NULL;
    IF NOT EXISTS (SELECT 1 FROM dbo.customers WHERE id = @customer_id)
    BEGIN RAISERROR('El cliente no existe.', 16, 1); RETURN; END
    IF @channel IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM dbo.commercial_policy cp
        CROSS APPLY OPENJSON(cp.payload, '$.channels') WITH (id NVARCHAR(64), active BIT) c
         WHERE cp.id = 1 AND c.id = @channel AND c.active = 1)
    BEGIN RAISERROR('Esa lista de precios no existe o está apagada.', 16, 1); RETURN; END

    UPDATE dbo.customers SET price_channel = @channel, updated_at = SYSUTCDATETIME() WHERE id = @customer_id;
    SELECT id, price_channel FROM dbo.customers WHERE id = @customer_id;
END
GO
