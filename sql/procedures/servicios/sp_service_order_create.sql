/* sp_service_order_create
 * Definicion canonica. Modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* Abre una orden de servicio: entra el trabajo.
 *
 * LO MINIMO PARA ABRIR ES EL CLIENTE
 * ----------------------------------
 * Ni el activo, ni el diagnostico, ni una sola linea. Cuando el coche entra al
 * taller nadie sabe todavia que hay que hacerle, y una pantalla que exija
 * cotizarlo antes de abrirlo obliga a inventarse la cotizacion o a apuntar el
 * trabajo en un papel. El papel siempre gana esa pelea.
 *
 * NACE EN 'ABIERTA', NO EN 'BORRADOR'
 * -----------------------------------
 * Un borrador es algo que puede no llegar a existir. Esto ya existe: el coche
 * esta dentro. `BORRADOR` se reserva para las que nacen de una cotizacion sin
 * trabajo detras.
 *
 * `quote_version` empieza en 1 y `authorized_version` en NULL: nada
 * autorizado todavia, que es la verdad.
 */
CREATE OR ALTER PROCEDURE dbo.sp_service_order_create
    @customer_id       INT,
    @customer_asset_id INT = NULL,
    @reported_issue    NVARCHAR(1000) = NULL,
    @promised_at       DATETIME2(0) = NULL,
    @notes             NVARCHAR(1000) = NULL,
    @user_id           INT = NULL,
    @register_id       INT = NULL,
    @status            NVARCHAR(20) = 'ABIERTA'
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    IF NOT EXISTS (SELECT 1 FROM dbo.customers WHERE id = @customer_id)
    BEGIN
        RAISERROR('El cliente no existe.', 16, 1);
        RETURN;
    END

    /* Un activo de OTRO cliente en esta orden es casi siempre un clic mal
       dado, y el historial que deja es peor que el error: el coche de alguien
       aparece en el expediente de otro. */
    IF @customer_asset_id IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM dbo.customer_assets
                        WHERE id = @customer_asset_id AND customer_id = @customer_id)
    BEGIN
        RAISERROR('Ese activo no es de este cliente.', 16, 1);
        RETURN;
    END

    IF @status NOT IN ('BORRADOR', 'ABIERTA')
    BEGIN
        RAISERROR('Una orden nueva solo puede nacer como BORRADOR o ABIERTA.', 16, 1);
        RETURN;
    END

    BEGIN TRAN;

    INSERT INTO dbo.service_orders
        (customer_id, customer_asset_id, status, reported_issue,
         promised_at, notes, opened_by, register_id)
    VALUES
        (@customer_id, @customer_asset_id, @status, @reported_issue,
         @promised_at, @notes, @user_id, @register_id);

    DECLARE @id INT = SCOPE_IDENTITY();

    INSERT INTO dbo.service_order_events
        (order_id, event_type, to_status, quote_version, detail, user_id)
    VALUES
        (@id, 'ABIERTA', @status, 1, @reported_issue, @user_id);

    COMMIT TRAN;

    EXEC dbo.sp_service_order_get @id = @id;
END
GO
