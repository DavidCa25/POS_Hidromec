/* sp_venta_suelta_guardar
 * Definicion canonica. Mantener este archivo y generar una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* ==================== sp_venta_suelta_guardar (0073) ====================
   Liga un producto suelto con su paquete, o lo desliga.

   @parent_product_id NULL: deja de venderse suelto (se borra la fila). El
   producto y su stock se quedan como estan.

   Reglas:
     · el modulo tiene que estar encendido;
     · los dos llevan existencias propias (DIRECT): una receta o un servicio
       no se abren;
     · un solo nivel: el paquete no cuelga de otro y el suelto no es paquete
       de nadie;
     · de 2 a 10000 piezas por paquete.

   Si el suelto no tiene costo, toma el del paquete entre sus piezas: sin eso
   la utilidad de cada cigarro saldria completa.
   El permiso (CATALOGO_EDITAR) lo exige el proceso principal.
   ==================================================================== */
CREATE OR ALTER PROCEDURE dbo.sp_venta_suelta_guardar
    @product_id        INT,
    @parent_product_id INT = NULL,
    @piezas            INT = NULL,
    @user_id           INT = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    IF NOT EXISTS (SELECT 1 FROM dbo.business_modules WHERE module_key = N'venta-suelta' AND enabled = 1)
        THROW 51000, N'Venta suelta no está activada.', 1;
    IF @product_id IS NULL OR NOT EXISTS (SELECT 1 FROM dbo.products WHERE id = @product_id)
        THROW 51000, N'El producto no existe.', 1;

    IF @parent_product_id IS NULL
    BEGIN
        DELETE FROM dbo.venta_suelta WHERE product_id = @product_id;
        RETURN;
    END

    IF @parent_product_id = @product_id
        THROW 51000, N'Un producto no puede ser su propio paquete.', 1;
    IF @piezas IS NULL OR @piezas < 2 OR @piezas > 10000
        THROW 51000, N'Indica cuántas piezas trae el paquete (de 2 a 10000).', 1;
    IF NOT EXISTS (SELECT 1 FROM dbo.products WHERE id = @parent_product_id AND ISNULL(active, 1) = 1)
        THROW 51000, N'El paquete no existe o está dado de baja.', 1;
    IF EXISTS (SELECT 1 FROM dbo.products WHERE id IN (@product_id, @parent_product_id) AND inventory_mode <> 'DIRECT')
        THROW 51000, N'El suelto y su paquete tienen que llevar existencias propias.', 1;
    IF EXISTS (SELECT 1 FROM dbo.venta_suelta WHERE product_id = @parent_product_id)
        THROW 51000, N'Ese paquete ya se vende suelto de otro: elige el paquete original.', 1;
    IF EXISTS (SELECT 1 FROM dbo.venta_suelta WHERE parent_product_id = @product_id)
        THROW 51000, N'Este producto ya es el paquete de otro suelto.', 1;

    BEGIN TRAN;
        MERGE dbo.venta_suelta AS d
        USING (SELECT @product_id AS product_id) AS s
           ON d.product_id = s.product_id
         WHEN MATCHED THEN
              UPDATE SET parent_product_id = @parent_product_id, piezas = @piezas,
                         updated_at = SYSDATETIME(), updated_by = @user_id
         WHEN NOT MATCHED THEN
              INSERT (product_id, parent_product_id, piezas, updated_by)
              VALUES (@product_id, @parent_product_id, @piezas, @user_id);

        UPDATE h SET h.cost = CAST(p.cost / @piezas AS DECIMAL(14, 4))
        FROM dbo.products h
        JOIN dbo.products p ON p.id = @parent_product_id
        WHERE h.id = @product_id AND ISNULL(h.cost, 0) = 0 AND ISNULL(p.cost, 0) > 0;
    COMMIT;

    EXEC dbo.sp_venta_suelta_get @product_id = @product_id;
END
GO
