/* sp_service_order_update
 * Definicion canonica. Modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* Cambia la cabecera: diagnostico, activo, fecha prometida, notas.
 *
 * DOS PERSONAS EN LA MISMA ORDEN ES LO NORMAL
 * -------------------------------------------
 * El mostrador anota lo que dijo el cliente mientras el taller escribe el
 * diagnostico. Sin testigo de version, la ultima en guardar se lleva por
 * delante lo que escribio la otra y ninguna de las dos se entera: el
 * diagnostico simplemente desaparece.
 *
 * `@rowver` es el testigo. Se manda el que se leyo al abrir la pantalla; si la
 * fila cambio desde entonces, esto no guarda nada y devuelve el estado actual
 * para que la pantalla pueda decir "esto cambio mientras lo editabas".
 *
 * Es OPCIONAL a proposito: hay llamadas internas -cerrar, cobrar- que ya
 * saben que estan trabajando sobre la version buena. Lo que no puede pasar es
 * que la pantalla no lo mande, y de eso se encarga una prueba.
 *
 * CAMBIAR LA CABECERA NO INVALIDA LA AUTORIZACION
 * -----------------------------------------------
 * Escribir el diagnostico no cambia lo que el cliente va a pagar. Lo que sube
 * el presupuesto son las lineas, y eso vive en los procedimientos de linea.
 */
CREATE OR ALTER PROCEDURE dbo.sp_service_order_update
    @id                INT,
    @customer_asset_id INT = NULL,
    @reported_issue    NVARCHAR(1000) = NULL,
    @diagnosis         NVARCHAR(1000) = NULL,
    @promised_at       DATETIME2(0) = NULL,
    @notes             NVARCHAR(1000) = NULL,
    @rowver            BINARY(8) = NULL,
    @user_id           INT = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    DECLARE @actual BINARY(8), @customer_id INT, @status NVARCHAR(20), @sale_id INT;
    SELECT @actual = rowver, @customer_id = customer_id, @status = status, @sale_id = sale_id
      FROM dbo.service_orders WHERE id = @id;

    IF @customer_id IS NULL
    BEGIN
        RAISERROR('Esa orden no existe.', 16, 1);
        RETURN;
    END

    IF @rowver IS NOT NULL AND @rowver <> @actual
    BEGIN
        /* 50409 es el numero que el proceso principal traduce a "alguien mas
           la cambio". Un mensaje distinto por cada sitio acabaria en un
           "Error" generico en pantalla. */
        RAISERROR('CONFLICTO_DE_VERSION', 16, 1);
        RETURN;
    END

    IF @status = 'CANCELADA'
    BEGIN
        RAISERROR('Esta orden esta cancelada.', 16, 1);
        RETURN;
    END

    IF @customer_asset_id IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM dbo.customer_assets
                        WHERE id = @customer_asset_id AND customer_id = @customer_id)
    BEGIN
        RAISERROR('Ese activo no es de este cliente.', 16, 1);
        RETURN;
    END

    BEGIN TRAN;

    DECLARE @diag_antes NVARCHAR(1000) = (SELECT diagnosis FROM dbo.service_orders WHERE id = @id);

    UPDATE dbo.service_orders
       SET customer_asset_id = ISNULL(@customer_asset_id, customer_asset_id),
           reported_issue = ISNULL(@reported_issue, reported_issue),
           diagnosis = ISNULL(@diagnosis, diagnosis),
           promised_at = ISNULL(@promised_at, promised_at),
           notes = ISNULL(@notes, notes)
     WHERE id = @id;

    /* El diagnostico deja huella propia: es el momento en que se pasa de "lo
       que conto el cliente" a "lo que encontramos", y es lo primero que se
       busca cuando alguien pregunta por que se cotizo lo que se cotizo. */
    IF @diagnosis IS NOT NULL AND ISNULL(@diag_antes, '') <> @diagnosis
        INSERT INTO dbo.service_order_events (order_id, event_type, detail, user_id)
        VALUES (@id, 'DIAGNOSTICO', LEFT(@diagnosis, 400), @user_id);

    COMMIT TRAN;

    EXEC dbo.sp_service_order_get @id = @id;
END
GO
