/* sp_service_save
 * Definicion canonica. Modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* Da de alta un servicio, o convierte en servicio un producto que ya existe.
 *
 * UN SERVICIO ES UN PRODUCTO
 * --------------------------
 * No hay un catalogo paralelo. Este procedimiento escribe en `products` lo
 * que todo lo vendible tiene -nombre, precio, impuestos, clave del SAT- y en
 * `services` lo que solo un servicio tiene: cuanto dura, si necesita a alguien
 * que lo haga y cuanto comisiona.
 *
 * ENLAZAR UN PRODUCTO QUE YA ESTABA
 * ---------------------------------
 * Con `@product_id`, el producto no se recrea: se le anade la ficha de
 * servicio. Es el caso del taller que llevaba anos cobrando "Mano de obra"
 * como un producto mas y ahora quiere agendarlo y comisionarlo. Su historial
 * de ventas sigue siendo el suyo, que es justamente lo que se gana al no
 * inventar una tabla nueva.
 *
 * `inventory_mode = 'NONE'` NO SE NEGOCIA
 * ---------------------------------------
 * Un servicio no tiene existencias. Si el producto enlazado descontaba
 * inventario, deja de hacerlo: cobrar una hora de trabajo no puede restar
 * piezas de un almacen.
 */
CREATE OR ALTER PROCEDURE dbo.sp_service_save
    @product_id             INT = NULL,
    @nombre                 NVARCHAR(100),
    @price                  DECIMAL(10, 2),
    @part_number            NVARCHAR(100) = NULL,
    @category_id            INT = NULL,
    @clave_prod_serv        NVARCHAR(8) = NULL,
    @clave_unidad           NVARCHAR(5) = NULL,
    @tasa_iva               DECIMAL(5, 4) = NULL,
    @duration_minutes       INT = 30,
    @requires_professional  BIT = 1,
    @default_commission_pct DECIMAL(5, 2) = NULL,
    @schedulable            BIT = 1,
    @notes                  NVARCHAR(400) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    IF @nombre IS NULL OR LTRIM(RTRIM(@nombre)) = ''
    BEGIN
        RAISERROR('El servicio necesita un nombre.', 16, 1);
        RETURN;
    END

    IF @price IS NULL OR @price < 0
    BEGIN
        RAISERROR('El precio no puede ser negativo.', 16, 1);
        RETURN;
    END

    BEGIN TRAN;

    /* ------------------------------------------- CATEGORIA Y MARCA, SIEMPRE
     *
     * `sp_get_active_products` -el catalogo de la pantalla de venta- une
     * products con CAT_categories y CAT_brands con INNER JOIN. Un servicio sin
     * categoria o sin marca queda FUERA de esa consulta: existe en la base, se
     * ve en el catalogo de Servicios y no se puede vender. Un servicio que no
     * se puede cobrar no sirve de nada, y el fallo es silencioso.
     *
     * Asi que se le dan las dos. 'Servicios' como categoria es ademas lo que
     * el negocio querria: los agrupa en la pantalla de venta sin que nadie
     * tenga que crearla a mano el primer dia.
     */
    DECLARE @cat_servicios INT, @marca_general INT;

    IF NOT EXISTS (SELECT 1 FROM dbo.CAT_categories WHERE namee = N'Servicios')
        INSERT INTO dbo.CAT_categories (namee) VALUES (N'Servicios');
    SELECT @cat_servicios = id FROM dbo.CAT_categories WHERE namee = N'Servicios';

    IF NOT EXISTS (SELECT 1 FROM dbo.CAT_brands WHERE namee = N'General')
        INSERT INTO dbo.CAT_brands (namee) VALUES (N'General');
    SELECT @marca_general = id FROM dbo.CAT_brands WHERE namee = N'General';

    IF @product_id IS NULL
    BEGIN
        /* Sin clave, se genera una estable y legible. Un servicio rara vez
           tiene codigo de barras, y exigirselo al alta seria pedir un dato que
           el negocio no tiene.

           Se inserta con un valor provisional y se renombra con el identificador
           ya asignado: asi la clave es 'SRV-12' y no un contador aparte que dos
           cajas tendrian que repartirse. */
        DECLARE @generar BIT = CASE WHEN @part_number IS NULL OR LTRIM(RTRIM(@part_number)) = '' THEN 1 ELSE 0 END;
        IF @generar = 1 SET @part_number = 'SRV-TMP-' + CONVERT(NVARCHAR(36), NEWID());

        INSERT INTO dbo.products
            (part_number, nombre, price, stock, active, category_id, brand_id, cost,
             clave_prod_serv, clave_unidad, objeto_impuesto, tasa_iva,
             inventory_mode, sellable, base_uom, allow_decimal_qty)
        VALUES
            (@part_number, @nombre, @price, 0, 1,
             ISNULL(@category_id, @cat_servicios), @marca_general, 0,
             ISNULL(@clave_prod_serv, '80111600'),   -- servicios, clave generica del SAT
             ISNULL(@clave_unidad, 'E48'),           -- unidad de servicio
             '02', ISNULL(@tasa_iva, 0.16),
             'NONE', 1, 'pza', 0);

        SET @product_id = SCOPE_IDENTITY();

        IF @generar = 1
        BEGIN
            DECLARE @clave NVARCHAR(100) = 'SRV-' + CONVERT(NVARCHAR(12), @product_id);
            /* Solo si nadie la usa ya: el mostrador puede haber escrito 'SRV-12'
               a mano hace un ano, y perder el alta por eso seria absurdo. */
            IF NOT EXISTS (SELECT 1 FROM dbo.products WHERE part_number = @clave)
                UPDATE dbo.products SET part_number = @clave WHERE id = @product_id;
        END
    END
    ELSE
    BEGIN
        IF NOT EXISTS (SELECT 1 FROM dbo.products WHERE id = @product_id)
        BEGIN
            ROLLBACK TRAN;
            RAISERROR('El producto no existe.', 16, 1);
            RETURN;
        END

        UPDATE dbo.products
           SET nombre = @nombre,
               price = @price,
               /* Si el producto enlazado no tenia categoria o marca, se le dan:
                  sin ellas desaparece del catalogo de venta. */
               category_id = ISNULL(@category_id, ISNULL(category_id, @cat_servicios)),
               brand_id = ISNULL(brand_id, @marca_general),
               clave_prod_serv = ISNULL(@clave_prod_serv, clave_prod_serv),
               clave_unidad = ISNULL(@clave_unidad, clave_unidad),
               tasa_iva = ISNULL(@tasa_iva, tasa_iva),
               part_number = ISNULL(NULLIF(LTRIM(RTRIM(@part_number)), ''), part_number),
               /* Un servicio no descuenta existencias, venga de donde venga. */
               inventory_mode = 'NONE',
               sellable = 1
         WHERE id = @product_id;
    END

    MERGE dbo.services AS d
    USING (SELECT @product_id AS product_id) AS s ON d.product_id = s.product_id
    WHEN MATCHED THEN UPDATE SET
        duration_minutes = @duration_minutes,
        requires_professional = @requires_professional,
        default_commission_pct = @default_commission_pct,
        schedulable = @schedulable,
        notes = @notes,
        updated_at = SYSDATETIME()
    WHEN NOT MATCHED THEN INSERT
        (product_id, duration_minutes, requires_professional,
         default_commission_pct, schedulable, notes)
        VALUES (@product_id, @duration_minutes, @requires_professional,
                @default_commission_pct, @schedulable, @notes);

    COMMIT TRAN;

    SELECT p.id AS product_id, p.part_number, p.nombre, p.price, p.active,
           s.duration_minutes, s.requires_professional,
           s.default_commission_pct, s.schedulable, s.notes
      FROM dbo.products p
      JOIN dbo.services s ON s.product_id = p.id
     WHERE p.id = @product_id;
END
GO
