/* sp_service_order_add_line
 * Definicion canonica. Modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* Anade trabajo o refacciones a una orden.
 *
 * SERVICIOS Y PRODUCTOS, LA MISMA LISTA
 * -------------------------------------
 * En un taller no son dos documentos: el cliente ve un solo total. Lo que
 * cambia entre uno y otro es el inventario -una refaccion descuenta
 * existencias al cobrar, una hora de trabajo no- y quien comisiona. La forma
 * de la linea es la misma, y por eso `line_kind` se deduce del producto en vez
 * de pedirlo: si tiene ficha en `services`, es un servicio. No hay forma de
 * equivocarse porque no hay nada que elegir.
 *
 * TODO SE CONGELA AL ANADIR
 * -------------------------
 * Nombre, precio, costo, tasa y porcentaje de comision se copian ahora. Si
 * manana sube el precio del aceite, el presupuesto que el cliente autorizo
 * ayer sigue costando lo de ayer. Sin la copia, un cambio de catalogo
 * reescribiria presupuestos aprobados y comisiones ya calculadas sin que
 * nadie lo pidiera.
 *
 * EL INVENTARIO NO SE MUEVE AQUI
 * ------------------------------
 * Ni se reserva. Anadir una refaccion a una orden no la saca del almacen:
 * eso pasa al cobrar, por la misma via que cualquier venta. Una orden abierta
 * tres dias que reservara piezas dejaria el inventario diciendo que hay menos
 * de lo que hay, y la caja de al lado no podria vender lo que tiene delante.
 *
 * SUBE EL PRESUPUESTO
 * -------------------
 * Anadir una linea mueve el importe, asi que `quote_version` sube. Si el
 * cliente ya habia autorizado, la orden queda marcada como pendiente de
 * reautorizacion, y eso es exactamente lo que se quiere: lo que autorizo ya no
 * es lo que se le va a cobrar.
 */
CREATE OR ALTER PROCEDURE dbo.sp_service_order_add_line
    @order_id        INT,
    @product_id      INT,
    @quantity        DECIMAL(12, 2) = 1,
    @professional_id INT = NULL,
    @unit_price      DECIMAL(12, 2) = NULL,
    @commission_pct  DECIMAL(5, 2) = NULL,
    @notes           NVARCHAR(400) = NULL,
    @user_id         INT = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    DECLARE @status NVARCHAR(20), @sale_id INT;
    SELECT @status = status, @sale_id = sale_id FROM dbo.service_orders WHERE id = @order_id;

    IF @status IS NULL
    BEGIN
        RAISERROR('Esa orden no existe.', 16, 1);
        RETURN;
    END

    /* Una orden ya cobrada no admite lineas nuevas: el total cambiaria y la
       venta ya no cuadraria con lo que la orden dice. Lo que se hace en ese
       caso es otra orden, o una devolucion sobre la venta. */
    IF @sale_id IS NOT NULL
    BEGIN
        RAISERROR('Esta orden ya se cobro. Abre una nueva para trabajo adicional.', 16, 1);
        RETURN;
    END

    IF @status = 'CANCELADA'
    BEGIN
        RAISERROR('Esta orden esta cancelada.', 16, 1);
        RETURN;
    END

    IF @quantity IS NULL OR @quantity <= 0
    BEGIN
        RAISERROR('La cantidad tiene que ser mayor que cero.', 16, 1);
        RETURN;
    END

    DECLARE @nombre NVARCHAR(100), @precio DECIMAL(10, 2), @costo DECIMAL(14, 4),
            @iva DECIMAL(5, 4), @activo BIT;
    SELECT @nombre = nombre, @precio = price, @costo = cost,
           @iva = tasa_iva, @activo = ISNULL(active, 0)
      FROM dbo.products WHERE id = @product_id;

    IF @nombre IS NULL
    BEGIN
        RAISERROR('Ese producto no existe.', 16, 1);
        RETURN;
    END

    IF @activo = 0
    BEGIN
        RAISERROR('Ese producto esta dado de baja.', 16, 1);
        RETURN;
    END

    DECLARE @es_servicio BIT =
        CASE WHEN EXISTS (SELECT 1 FROM dbo.services WHERE product_id = @product_id) THEN 1 ELSE 0 END;
    DECLARE @line_kind NVARCHAR(10) = CASE WHEN @es_servicio = 1 THEN 'SERVICIO' ELSE 'PRODUCTO' END;

    /* Quien no puede hacer ese servicio no puede quedarse con la linea: la
       comision saldria a nombre de alguien que no lo hizo. Sin matriz para ese
       servicio, lo hace cualquiera. */
    IF @professional_id IS NOT NULL AND @es_servicio = 1
       AND EXISTS (SELECT 1 FROM dbo.service_professionals WHERE service_product_id = @product_id)
       AND NOT EXISTS (SELECT 1 FROM dbo.service_professionals
                        WHERE service_product_id = @product_id
                          AND professional_id = @professional_id)
    BEGIN
        RAISERROR('Esa persona no tiene asignado este servicio.', 16, 1);
        RETURN;
    END

    IF @professional_id IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM dbo.professionals WHERE id = @professional_id AND active = 1)
    BEGIN
        RAISERROR('Ese profesional no existe o esta dado de baja.', 16, 1);
        RETURN;
    END

    /* El precio: el que se pase -un descuento pactado en el mostrador- o el
       del catalogo. Cero es un precio valido: una cortesia. */
    DECLARE @precio_final DECIMAL(12, 2) = ISNULL(@unit_price, @precio);
    IF @precio_final < 0
    BEGIN
        RAISERROR('El precio no puede ser negativo.', 16, 1);
        RETURN;
    END

    /* LA COMISION, DE LO MAS CONCRETO A LO MAS GENERAL.
       Lo que se pase gana; si no, lo pactado para esa persona en ese servicio;
       si no, lo del servicio; si no, lo de la persona. Un producto no
       comisiona salvo que alguien lo diga expresamente. */
    DECLARE @comision DECIMAL(5, 2) = @commission_pct;
    IF @comision IS NULL AND @professional_id IS NOT NULL
    BEGIN
        SELECT @comision = sp.commission_pct
          FROM dbo.service_professionals sp
         WHERE sp.service_product_id = @product_id AND sp.professional_id = @professional_id;

        IF @comision IS NULL AND @es_servicio = 1
            SELECT @comision = default_commission_pct FROM dbo.services WHERE product_id = @product_id;

        IF @comision IS NULL
            SELECT @comision = default_commission_pct FROM dbo.professionals WHERE id = @professional_id;
    END

    IF @comision IS NOT NULL AND (@comision < 0 OR @comision > 100)
    BEGIN
        RAISERROR('La comision va de 0 a 100.', 16, 1);
        RETURN;
    END

    BEGIN TRAN;

    DECLARE @line_no INT =
        ISNULL((SELECT MAX(line_no) FROM dbo.service_order_lines WHERE order_id = @order_id), 0) + 1;

    INSERT INTO dbo.service_order_lines
        (order_id, line_no, line_kind, product_id,
         name_snapshot, unit_price_snapshot, unit_cost_snapshot, tasa_iva_snapshot,
         quantity, professional_id, commission_pct_snapshot, status, notes, added_by)
    VALUES
        (@order_id, @line_no, @line_kind, @product_id,
         @nombre, @precio_final, @costo, ISNULL(@iva, 0.16),
         @quantity, @professional_id, @comision, 'PENDIENTE', @notes, @user_id);

    DECLARE @line_id INT = SCOPE_IDENTITY();

    UPDATE dbo.service_orders
       SET quote_version = quote_version + 1,
           status = CASE WHEN status = 'BORRADOR' THEN 'BORRADOR' ELSE status END
     WHERE id = @order_id;

    DECLARE @version INT = (SELECT quote_version FROM dbo.service_orders WHERE id = @order_id);

    INSERT INTO dbo.service_order_events
        (order_id, event_type, quote_version, amount, detail, user_id)
    VALUES
        (@order_id, 'LINEA_ANADIDA', @version,
         CONVERT(DECIMAL(14, 2), @quantity * @precio_final),
         @nombre + ' x' + CONVERT(NVARCHAR(20), @quantity), @user_id);

    COMMIT TRAN;

    EXEC dbo.sp_service_order_get @id = @order_id;
END
GO
