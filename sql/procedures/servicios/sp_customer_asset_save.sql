/* sp_customer_asset_save
 * Definicion canonica. Modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* Guarda el activo de un cliente: su coche, su mascota, su maquina.
 *
 * `label` es lo unico obligatorio ademas del cliente, y es a proposito: en el
 * mostrador, lo primero que se sabe es como llamarlo. La placa, el ano y el
 * color se rellenan despues, o nunca. Un alta que exija ocho campos no se
 * hace con el cliente delante.
 */
CREATE OR ALTER PROCEDURE dbo.sp_customer_asset_save
    @id                   INT = NULL,
    @customer_id          INT,
    @kind                 NVARCHAR(20) = 'OTRO',
    @label                NVARCHAR(120),
    @identifier           NVARCHAR(60) = NULL,
    @secondary_identifier NVARCHAR(60) = NULL,
    @brand                NVARCHAR(60) = NULL,
    @model                NVARCHAR(60) = NULL,
    @year_or_age          NVARCHAR(20) = NULL,
    @color                NVARCHAR(40) = NULL,
    @notes                NVARCHAR(400) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    IF @label IS NULL OR LTRIM(RTRIM(@label)) = ''
    BEGIN
        RAISERROR('Ponle un nombre para reconocerlo.', 16, 1);
        RETURN;
    END

    IF NOT EXISTS (SELECT 1 FROM dbo.customers WHERE id = @customer_id)
    BEGIN
        RAISERROR('El cliente no existe.', 16, 1);
        RETURN;
    END

    /* Vacio y NULL son lo mismo para un identificador, y guardarlos distinto
       convierte "buscar por placa" en dos busquedas. */
    SET @identifier = NULLIF(LTRIM(RTRIM(@identifier)), '');
    SET @secondary_identifier = NULLIF(LTRIM(RTRIM(@secondary_identifier)), '');

    IF @id IS NULL
    BEGIN
        INSERT INTO dbo.customer_assets
            (customer_id, kind, label, identifier, secondary_identifier,
             brand, model, year_or_age, color, notes)
        VALUES
            (@customer_id, ISNULL(@kind, 'OTRO'), @label, @identifier, @secondary_identifier,
             @brand, @model, @year_or_age, @color, @notes);
        SET @id = SCOPE_IDENTITY();
    END
    ELSE
    BEGIN
        UPDATE dbo.customer_assets
           SET customer_id = @customer_id,
               kind = ISNULL(@kind, kind),
               label = @label,
               identifier = @identifier,
               secondary_identifier = @secondary_identifier,
               brand = @brand,
               model = @model,
               year_or_age = @year_or_age,
               color = @color,
               notes = @notes,
               updated_at = SYSDATETIME()
         WHERE id = @id;

        IF @@ROWCOUNT = 0
        BEGIN
            RAISERROR('Ese registro ya no existe.', 16, 1);
            RETURN;
        END
    END

    SELECT * FROM dbo.customer_assets WHERE id = @id;
END
GO
