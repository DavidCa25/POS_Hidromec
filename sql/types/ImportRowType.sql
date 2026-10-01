/* ImportRowType
 * Tipo de tabla. SQL Server no conserva el texto original de un tipo, asi
 * que este DDL se reconstruye desde sys.columns. Es equivalente, no literal.
 * Un tipo NO admite CREATE OR ALTER: se comprueba antes de crearlo.
 */
IF TYPE_ID(N'dbo.ImportRowType') IS NULL
BEGIN
  CREATE TYPE dbo.ImportRowType AS TABLE (
    fila INT NULL,
    crudo_json NVARCHAR(MAX) NULL,
    tipo NVARCHAR(12) NULL,
    part_number NVARCHAR(100) NULL,
    nombre NVARCHAR(200) NULL,
    price DECIMAL(10, 2) NULL,
    cost DECIMAL(14, 4) NULL,
    stock DECIMAL(12, 2) NULL,
    bar_code NVARCHAR(60) NULL,
    category_name NVARCHAR(150) NULL,
    brand_name NVARCHAR(150) NULL,
    base_uom NVARCHAR(10) NULL,
    clave_prod_serv NVARCHAR(8) NULL,
    clave_unidad NVARCHAR(5) NULL,
    tasa_iva DECIMAL(5, 4) NULL,
    duration_minutes INT NULL,
    schedulable BIT NULL,
    default_commission_pct DECIMAL(5, 2) NULL,
    accion NVARCHAR(12) NULL,
    match_product_id INT NULL,
    match_motivo NVARCHAR(20) NULL,
    problemas_json NVARCHAR(MAX) NULL,
    inventory_mode NVARCHAR(10) NULL,
    sellable BIT NULL
  );
END;
