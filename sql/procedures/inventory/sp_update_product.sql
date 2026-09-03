/* sp_update_product
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
-- =============================================
-- Update: + campos fiscales SAT (opcionales)
-- Conserva la logica original de bar_code.
-- =============================================
CREATE OR ALTER PROCEDURE [dbo].[sp_update_product]
    @product_id INT,
    @nombre NVARCHAR(100),
    @precio DECIMAL(10,2),
    @stock DECIMAL(10,2),
    @numero_parte NVARCHAR(100),
    @bar_code NVARCHAR(100) = NULL,
    @clave_prod_serv NVARCHAR(8) = NULL,
    @clave_unidad NVARCHAR(5) = NULL,
    @objeto_impuesto NVARCHAR(2) = NULL,
    @tasa_iva DECIMAL(5,4) = NULL
AS
BEGIN
    SET NOCOUNT ON;

    -- Si mandan un bar_code no vacio, valida que no lo tenga otro producto
    IF @bar_code IS NOT NULL AND LTRIM(RTRIM(@bar_code)) <> ''
    BEGIN
        IF EXISTS (
            SELECT 1 FROM products
            WHERE bar_code = @bar_code AND id <> @product_id
        )
        BEGIN
            RAISERROR('Ese codigo de barras ya esta asignado a otro producto.', 16, 1);
            RETURN;
        END
    END

    UPDATE products
    SET nombre = @nombre,
        price = @precio,
        stock = @stock,
        part_number = @numero_parte,
        bar_code = CASE
                     WHEN @bar_code IS NULL THEN bar_code           -- no lo tocan: conserva
                     WHEN LTRIM(RTRIM(@bar_code)) = '' THEN NULL     -- vacio: lo limpia
                     ELSE @bar_code
                   END,
        -- Campos fiscales: si mandan NULL, conservan el valor actual
        clave_prod_serv = ISNULL(@clave_prod_serv, clave_prod_serv),
        clave_unidad    = ISNULL(@clave_unidad, clave_unidad),
        objeto_impuesto = ISNULL(@objeto_impuesto, objeto_impuesto),
        tasa_iva        = ISNULL(@tasa_iva, tasa_iva)
    WHERE id = @product_id;
END;
GO
