/* ============================================================
   0036 — QuickStart: escribir el almacen intermedio

   El tipo de tabla y los procedimientos que usa la tuberia para dejar las
   filas ya normalizadas. Van aparte de 0034 porque 0034 crea el modelo y
   esto es como se escribe en el: separarlos deja claro que se puede
   reaplicar sin tocar datos.
   ============================================================ */

IF TYPE_ID(N'dbo.ImportRowType') IS NULL
BEGIN
  CREATE TYPE dbo.ImportRowType AS TABLE (
    fila INT NULL,
    crudo_json NVARCHAR(MAX) NULL,
    tipo NVARCHAR(12) NULL,
    part_number NVARCHAR(100) NULL,
    nombre NVARCHAR(200) NULL,
    price DECIMAL(10,2) NULL,
    cost DECIMAL(14,4) NULL,
    stock DECIMAL(12,2) NULL,
    bar_code NVARCHAR(60) NULL,
    category_name NVARCHAR(150) NULL,
    brand_name NVARCHAR(150) NULL,
    base_uom NVARCHAR(10) NULL,
    clave_prod_serv NVARCHAR(8) NULL,
    clave_unidad NVARCHAR(5) NULL,
    tasa_iva DECIMAL(5,4) NULL,
    duration_minutes INT NULL,
    schedulable BIT NULL,
    default_commission_pct DECIMAL(5,2) NULL,
    accion NVARCHAR(12) NULL,
    match_product_id INT NULL,
    match_motivo NVARCHAR(20) NULL,
    problemas_json NVARCHAR(MAX) NULL
  );
END;
GO

/* Mete un lote de filas ya planificadas. No valida: la validacion ya paso,
   y repetirla aqui seria tener dos criterios que pueden discrepar. */
CREATE OR ALTER PROCEDURE dbo.sp_import_rows_add
    @batch_id INT,
    @Rows dbo.ImportRowType READONLY
AS
BEGIN
    SET NOCOUNT ON;
    INSERT INTO dbo.import_rows
      (batch_id, fila, crudo_json, tipo, part_number, nombre, price, cost, stock,
       bar_code, category_name, brand_name, base_uom, clave_prod_serv, clave_unidad,
       tasa_iva, duration_minutes, schedulable, default_commission_pct,
       accion, match_product_id, match_motivo, problemas_json)
    SELECT @batch_id, ISNULL(fila, 0), crudo_json, ISNULL(tipo,'PRODUCTO'),
           part_number, nombre, price, cost, stock,
           bar_code, category_name, brand_name, base_uom, clave_prod_serv, clave_unidad,
           tasa_iva, duration_minutes, schedulable, default_commission_pct,
           ISNULL(accion,'PENDIENTE'), match_product_id, match_motivo, problemas_json
      FROM @Rows;

    SELECT @@ROWCOUNT AS insertadas;
END
GO

/* Vacia las filas de una carga para volver a planificar con otro mapeo.
   Solo las NO aplicadas: lo que ya entro al catalogo no se replantea. */
CREATE OR ALTER PROCEDURE dbo.sp_import_rows_clear
    @batch_id INT
AS
BEGIN
    SET NOCOUNT ON;
    DELETE FROM dbo.import_rows WHERE batch_id = @batch_id AND aplicada = 0;
    SELECT @@ROWCOUNT AS borradas;
END
GO

CREATE OR ALTER PROCEDURE dbo.sp_import_batch_set_mapping
    @batch_id INT,
    @mapping_json NVARCHAR(MAX)
AS
BEGIN
    SET NOCOUNT ON;
    UPDATE dbo.import_batches
       SET mapping_json = @mapping_json, updated_at = SYSDATETIME()
     WHERE id = @batch_id;
END
GO

/* Resolver UNA fila. El grupo resuelve muchas de golpe; esto es para el
   caso que no se parece a ningun otro —el codigo repetido con otro nombre—
   y que por eso no se puede meter en un lote. */
CREATE OR ALTER PROCEDURE dbo.sp_import_resolve_row
    @row_id INT,
    @resolucion NVARCHAR(20),     -- ACTUALIZAR | CREAR_OTRO | IGNORAR | EDITAR
    @campo NVARCHAR(40) = NULL,
    @valor NVARCHAR(200) = NULL
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @batch_id INT = (SELECT batch_id FROM dbo.import_rows WHERE id = @row_id);
    IF @batch_id IS NULL BEGIN SELECT 0 AS resueltas; RETURN; END

    IF EXISTS (SELECT 1 FROM dbo.import_rows WHERE id = @row_id AND aplicada = 1)
    BEGIN
        /* Una fila que ya entro al catalogo no se «resuelve»: se edita el
           producto, que es otra pantalla y otro permiso. */
        RAISERROR('Esa fila ya se importó.', 16, 1);
        RETURN;
    END

    IF @resolucion = 'EDITAR' AND @campo IS NOT NULL
    BEGIN
        IF @campo = 'nombre'        UPDATE dbo.import_rows SET nombre = @valor WHERE id = @row_id;
        IF @campo = 'price'         UPDATE dbo.import_rows SET price = TRY_CONVERT(DECIMAL(10,2), @valor) WHERE id = @row_id;
        IF @campo = 'cost'          UPDATE dbo.import_rows SET cost = TRY_CONVERT(DECIMAL(14,4), @valor) WHERE id = @row_id;
        IF @campo = 'stock'         UPDATE dbo.import_rows SET stock = TRY_CONVERT(DECIMAL(12,2), @valor) WHERE id = @row_id;
        IF @campo = 'part_number'   UPDATE dbo.import_rows SET part_number = @valor WHERE id = @row_id;
        IF @campo = 'bar_code'      UPDATE dbo.import_rows SET bar_code = @valor WHERE id = @row_id;
        IF @campo = 'category_name' UPDATE dbo.import_rows SET category_name = @valor WHERE id = @row_id;
        IF @campo = 'brand_name'    UPDATE dbo.import_rows SET brand_name = @valor WHERE id = @row_id;
        IF @campo = 'base_uom'      UPDATE dbo.import_rows SET base_uom = @valor WHERE id = @row_id;
    END

    IF @resolucion = 'ACTUALIZAR'
        UPDATE dbo.import_rows SET accion = 'UPDATE', resolucion = 'ACTUALIZAR'
         WHERE id = @row_id AND match_product_id IS NOT NULL;

    IF @resolucion = 'CREAR_OTRO'
        UPDATE dbo.import_rows SET accion = 'CREATE', resolucion = 'CREAR_OTRO',
               match_product_id = NULL, match_motivo = NULL
         WHERE id = @row_id;

    IF @resolucion = 'IGNORAR'
        UPDATE dbo.import_rows SET accion = 'OMITIR', resolucion = 'IGNORAR' WHERE id = @row_id;

    /* Tras editar, la fila se vuelve a mirar: si ya tiene lo minimo y no le
       queda ningun problema grave, deja de estar pendiente. */
    IF @resolucion = 'EDITAR'
    BEGIN
        UPDATE dbo.import_rows
           SET problemas_json = (
                 SELECT j.[value] FROM OPENJSON(ISNULL(problemas_json,'[]')) j
                  WHERE JSON_VALUE(j.[value], '$.campo') <> @campo
                  FOR JSON PATH)
         WHERE id = @row_id;

        UPDATE dbo.import_rows SET problemas_json = '[]'
         WHERE id = @row_id AND problemas_json IS NULL;

        UPDATE dbo.import_rows
           SET accion = CASE WHEN match_product_id IS NULL THEN 'CREATE' ELSE 'UPDATE' END
         WHERE id = @row_id AND accion = 'PENDIENTE'
           AND nombre IS NOT NULL AND price IS NOT NULL
           AND NOT EXISTS (SELECT 1 FROM OPENJSON(ISNULL(problemas_json,'[]'))
                            WITH (gravedad NVARCHAR(10) '$.gravedad') g WHERE g.gravedad = 'alto');
    END

    EXEC dbo.sp_import_batch_touch @batch_id = @batch_id;
    SELECT 1 AS resueltas;
END
GO
