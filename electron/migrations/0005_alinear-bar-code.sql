/* 0005_alinear-bar-code.sql
 * ---------------------------------------------------------------------------
 * Alinea products.bar_code con el contrato canonico de Wybix.
 *
 * QUE PASABA
 * ----------
 * Las instalaciones mas antiguas tienen:
 *
 *     bar_code NVARCHAR(20) NOT NULL
 *
 * mientras que el arbol canonico (sql/schema/tables/products.sql) y las
 * instalaciones nuevas tienen:
 *
 *     bar_code NVARCHAR(50) NULL
 *
 * POR QUE EL CONTRATO CORRECTO ES NVARCHAR(50) NULL
 * -------------------------------------------------
 * 1. Hay productos que NO tienen codigo de barras y no pueden tenerlo: una
 *    receta, un servicio, algo que se vende a granel. Con NOT NULL hay que
 *    inventarles un valor, y ese valor falso acaba en la busqueda del lector.
 *
 * 2. Los procedimientos ya lo tratan como opcional. sp_add_product convierte
 *    la cadena vacia en NULL a proposito y solo comprueba unicidad cuando hay
 *    codigo. Es decir: el codigo ya asume NULL, solo la tabla no lo permitia.
 *
 * 3. 20 caracteres se quedan cortos. EAN-13 y UPC-A caben, pero GTIN-14 y
 *    sobre todo Code128 -que muchas balanzas y etiquetadoras generan- no.
 *
 * SEGURIDAD DEL CAMBIO
 * --------------------
 * Solo amplia: de 20 a 50 caracteres y de NOT NULL a NULL. Ningun codigo
 * existente se trunca ni se pierde, y ninguna fila cambia de valor. El codigo
 * mas largo medido en una instalacion real es de 13 caracteres.
 *
 * No hay indices, restricciones UNIQUE ni CHECK sobre la columna, asi que no
 * hay que recrear nada. El DEFAULT se conserva tal cual.
 * ---------------------------------------------------------------------------
 */

SET XACT_ABORT ON;

IF COL_LENGTH('dbo.products', 'bar_code') IS NULL
BEGIN
    RAISERROR('products.bar_code no existe: la base no tiene el esquema esperado.', 16, 1);
END
ELSE
BEGIN
    DECLARE @longitud INT, @admiteNulos BIT;

    SELECT @longitud = c.max_length / 2, @admiteNulos = c.is_nullable
    FROM sys.columns c
    WHERE c.object_id = OBJECT_ID('dbo.products') AND c.name = 'bar_code';

    IF @longitud < 50 OR @admiteNulos = 0
    BEGIN
        PRINT CONCAT('[0005] bar_code: NVARCHAR(', @longitud, ') ',
                     CASE WHEN @admiteNulos = 1 THEN 'NULL' ELSE 'NOT NULL' END,
                     ' -> NVARCHAR(50) NULL');

        ALTER TABLE dbo.products
            ALTER COLUMN bar_code NVARCHAR(50) COLLATE Modern_Spanish_CI_AS NULL;
    END
    ELSE
    BEGIN
        PRINT '[0005] bar_code ya cumple el contrato: NVARCHAR(50) NULL.';
    END
END;
