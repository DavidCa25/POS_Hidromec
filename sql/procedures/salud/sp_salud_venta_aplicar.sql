/* sp_salud_venta_aplicar
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* Después del COMMIT de la venta: guarda la receta que la respaldó y
 * descuenta los lotes, primero el que caduca primero (FEFO).
 *
 * Idempotente por venta: si ya hay movimientos o receta de esa venta no
 * hace nada, así que reintentarlo no descuenta dos veces.
 *
 * Lo que el stock vendió por encima de los lotes vigentes sale «sin lote»
 * (lote_id NULL) y se ve así en el libro, en vez de inventar un lote.
 * Los lotes caducados NO se consumen: si se vendió, no salió de ahí.
 */
CREATE OR ALTER PROCEDURE [dbo].[sp_salud_venta_aplicar]
    @sale_id INT,
    @receta  NVARCHAR(MAX) = NULL,
    @user_id INT = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    IF NOT EXISTS (SELECT 1 FROM dbo.sales WHERE id = @sale_id)
    BEGIN RAISERROR('La venta no existe.', 16, 1); RETURN; END
    IF EXISTS (SELECT 1 FROM dbo.salud_lote_movimientos WHERE sale_id = @sale_id)
       OR EXISTS (SELECT 1 FROM dbo.salud_recetas_surtidas WHERE sale_id = @sale_id)
    BEGIN
        SELECT CAST(1 AS BIT) AS ya_aplicada, CAST(NULL AS INT) AS receta_id;
        RETURN;
    END

    DECLARE @hoy DATE = CAST(GETDATE() AS DATE);
    BEGIN TRAN;

    DECLARE @receta_id INT = NULL;
    IF @receta IS NOT NULL AND ISJSON(@receta) = 1
    BEGIN
        DECLARE @medico NVARCHAR(120) = NULLIF(LTRIM(RTRIM(JSON_VALUE(@receta, '$.medico'))), N''),
                @cedula NVARCHAR(20)  = NULLIF(LTRIM(RTRIM(JSON_VALUE(@receta, '$.cedula'))), N''),
                @fecha  DATE          = TRY_CAST(JSON_VALUE(@receta, '$.fecha') AS DATE);
        IF @medico IS NULL OR @cedula IS NULL OR @fecha IS NULL
        BEGIN ROLLBACK; RAISERROR('RECETA_INCOMPLETA: faltan médico, cédula o fecha de la receta.', 16, 1); RETURN; END

        INSERT INTO dbo.salud_recetas_surtidas
            (sale_id, medico, cedula, fecha_receta, institucion, paciente, retenida, surtidos_restantes, user_id)
        VALUES (@sale_id, @medico, @cedula, @fecha,
                NULLIF(LTRIM(RTRIM(JSON_VALUE(@receta, '$.institucion'))), N''),
                NULLIF(LTRIM(RTRIM(JSON_VALUE(@receta, '$.paciente'))), N''),
                ISNULL(TRY_CAST(JSON_VALUE(@receta, '$.retenida') AS BIT), 0),
                TRY_CAST(JSON_VALUE(@receta, '$.surtidosRestantes') AS TINYINT),
                @user_id);
        SET @receta_id = SCOPE_IDENTITY();
    END

    /* Lo vendido de cada producto con control de lotes. */
    DECLARE @lineas TABLE (product_id INT PRIMARY KEY, cantidad DECIMAL(12,3));
    INSERT INTO @lineas (product_id, cantidad)
    SELECT d.product_id, SUM(d.quantity)
      FROM dbo.sale_detail d
      JOIN dbo.salud_productos s ON s.product_id = d.product_id AND s.controla_lotes = 1
     WHERE d.sale_id = @sale_id
     GROUP BY d.product_id
    HAVING SUM(d.quantity) > 0;

    DECLARE @pid INT, @falta DECIMAL(12,3), @lote_id INT, @disp DECIMAL(12,3), @toma DECIMAL(12,3);
    WHILE EXISTS (SELECT 1 FROM @lineas)
    BEGIN
        SELECT TOP (1) @pid = product_id, @falta = cantidad FROM @lineas ORDER BY product_id;
        WHILE @falta > 0
        BEGIN
            SET @lote_id = NULL;
            SELECT TOP (1) @lote_id = id, @disp = cantidad
              FROM dbo.salud_lotes WITH (UPDLOCK, ROWLOCK)
             WHERE product_id = @pid AND cantidad > 0 AND caducidad > @hoy
             ORDER BY caducidad, id;
            IF @lote_id IS NULL
            BEGIN
                INSERT INTO dbo.salud_lote_movimientos (product_id, lote_id, tipo, cantidad, sale_id, receta_id, user_id, nota)
                VALUES (@pid, NULL, N'SALIDA', @falta, @sale_id, @receta_id, @user_id, N'Sin lote vigente');
                SET @falta = 0;
            END
            ELSE
            BEGIN
                SET @toma = CASE WHEN @disp < @falta THEN @disp ELSE @falta END;
                UPDATE dbo.salud_lotes SET cantidad = cantidad - @toma WHERE id = @lote_id;
                INSERT INTO dbo.salud_lote_movimientos (product_id, lote_id, tipo, cantidad, sale_id, receta_id, user_id)
                VALUES (@pid, @lote_id, N'SALIDA', @toma, @sale_id, @receta_id, @user_id);
                SET @falta = @falta - @toma;
            END
        END
        DELETE FROM @lineas WHERE product_id = @pid;
    END

    COMMIT;
    SELECT CAST(0 AS BIT) AS ya_aplicada, @receta_id AS receta_id;
END
GO
