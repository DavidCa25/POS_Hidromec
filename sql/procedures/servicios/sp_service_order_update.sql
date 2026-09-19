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

    /* ------------------------------------------------------------------
       SOBRE QUE SE TRABAJA NO SE CAMBIA A MITAD DE LA ORDEN.

       Una orden es un compromiso sobre una cosa concreta: este coche, este
       equipo. Cambiar esa cosa cuando el cliente ya autorizo un presupuesto,
       cuando alguien ya empezo a trabajar o cuando la orden ya se cobro no es
       una correccion: es reescribir la historia de un trabajo que ya ocurrio,
       y deja un presupuesto autorizado que no corresponde a nada y una
       comision cobrada sobre otra cosa.

       Mientras la orden esta RECIBIDA y nadie se ha comprometido -sin
       autorizar, sin trabajo empezado, sin cobrar- cambiarlo es corregir un
       error de captura, y eso si se permite: es el caso real de recibir dos
       coches del mismo cliente y equivocarse de fila.

       Se comprueba AQUI y no solo en la pantalla porque la pantalla es una
       cortesia: el canal esta abierto a cualquiera que tenga el paquete, y
       una regla que solo vive en el renderer no es una regla.
       ------------------------------------------------------------------ */
    IF @customer_asset_id IS NOT NULL
    BEGIN
        DECLARE @activo_actual INT = (SELECT customer_asset_id FROM dbo.service_orders WHERE id = @id);

        IF ISNULL(@activo_actual, 0) <> @customer_asset_id
        BEGIN
            DECLARE @autorizada DATETIME2(0) =
                (SELECT authorized_at FROM dbo.service_orders WHERE id = @id);
            DECLARE @con_trabajo INT =
                (SELECT COUNT(*) FROM dbo.service_order_lines
                  WHERE order_id = @id AND status IN ('EN_PROCESO', 'HECHA'));

            IF @sale_id IS NOT NULL OR @autorizada IS NOT NULL OR @con_trabajo > 0
               OR @status NOT IN ('BORRADOR', 'ABIERTA')
            BEGIN
                /* Un codigo propio: la pantalla lo traduce a una frase que
                   dice POR QUE no se puede, que es lo unico que ayuda a quien
                   lo intenta. */
                RAISERROR('ACTIVO_BLOQUEADO', 16, 1);
                RETURN;
            END
        END
    END

    BEGIN TRAN;

    DECLARE @diag_antes NVARCHAR(1000) = (SELECT diagnosis FROM dbo.service_orders WHERE id = @id);
    DECLARE @activo_antes INT = (SELECT customer_asset_id FROM dbo.service_orders WHERE id = @id);

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

    /* Y sobre que se trabaja tambien. Es un dato que sale en el presupuesto y
       en la entrega, asi que cambiarlo sin dejar constancia convierte una
       correccion legitima en algo indistinguible de un error. */
    IF @customer_asset_id IS NOT NULL AND ISNULL(@activo_antes, 0) <> @customer_asset_id
        INSERT INTO dbo.service_order_events (order_id, event_type, detail, user_id)
        VALUES (@id, 'ACTIVO_CAMBIADO',
                LEFT(ISNULL((SELECT label FROM dbo.customer_assets WHERE id = @customer_asset_id), ''), 400),
                @user_id);

    COMMIT TRAN;

    EXEC dbo.sp_service_order_get @id = @id;
END
GO
