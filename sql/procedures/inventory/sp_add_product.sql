/* sp_add_product
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
-- =============================================
-- Author:      <Daniela Luna>
-- Create date: <04/08/2025>
-- Description: <SP para agregar productos>
-- Update:      + bar_code y campos fiscales SAT (opcionales)
-- =============================================
CREATE OR ALTER PROCEDURE [dbo].[sp_add_product]
    @brand INT,
    @part_number NVARCHAR(100),
    @name NVARCHAR(100),
    @price DECIMAL(10,2),
    @stock INT,
    @category INT,
    @bar_code NVARCHAR(100) = NULL,
    @clave_prod_serv NVARCHAR(8) = NULL,
    @clave_unidad NVARCHAR(5) = NULL,
    @objeto_impuesto NVARCHAR(2) = '02',
    @tasa_iva DECIMAL(5,4) = 0.16
AS
BEGIN
    SET NOCOUNT ON;

    IF EXISTS (SELECT 1 FROM products WHERE part_number = @part_number)
    BEGIN
        RAISERROR('Ya existe un producto con ese número de parte.', 16, 1);
        RETURN;
    END;

    -- Si mandan bar_code no vacio, valida que no lo tenga otro producto
    IF @bar_code IS NOT NULL AND LTRIM(RTRIM(@bar_code)) <> ''
    BEGIN
        IF EXISTS (SELECT 1 FROM products WHERE bar_code = @bar_code)
        BEGIN
            RAISERROR('Ese codigo de barras ya esta asignado a otro producto.', 16, 1);
            RETURN;
        END
    END

    INSERT INTO products (
        part_number, nombre, price, stock, category_id, brand_id,
        bar_code, clave_prod_serv, clave_unidad, objeto_impuesto, tasa_iva,
        active, registrated_date
    )
    VALUES (
        @part_number,
        @name,
        @price,
        @stock,
        @category,
        @brand,
        CASE WHEN @bar_code IS NULL OR LTRIM(RTRIM(@bar_code)) = '' THEN NULL ELSE @bar_code END,
        @clave_prod_serv,
        @clave_unidad,
        ISNULL(@objeto_impuesto, '02'),
        ISNULL(@tasa_iva, 0.16),
        1,
        GETDATE()
    );
END;
GO
