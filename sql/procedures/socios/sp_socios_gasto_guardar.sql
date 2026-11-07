/* sp_socios_gasto_guardar
 * Definicion canonica. Mantener este archivo y generar una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* ===================== sp_socios_gasto_guardar (0079) =====================
   A cargo de quien es un gasto y quien lo pago. Lo llama el canal de gastos
   justo despues de registrarlo.

   @modo       COMUN  = con la regla del negocio (iguales, % fijo, ventas).
               SOCIOS = de los de @lineas: '[{"socioId":1,"pct":60}, ...]'
                        que suman 100 (uno solo al 100 % = gasto de un socio).
   @pagado_por NULL = lo pago el negocio. Un socio = lo pago de su bolsa:
               se le abona como aportacion. Un gasto en EFECTIVO salio del
               cajon: lo pago el negocio.
   ======================================================================= */
CREATE OR ALTER PROCEDURE dbo.sp_socios_gasto_guardar
    @expense_id INT,
    @modo       VARCHAR(8),
    @lineas     NVARCHAR(MAX) = NULL,
    @pagado_por INT = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    IF NOT EXISTS (SELECT 1 FROM dbo.business_modules WHERE module_key = N'socios' AND enabled = 1)
        THROW 51000, N'Socios no está activado.', 1;
    DECLARE @metodo VARCHAR(20) = (SELECT payment_method FROM dbo.expenses WHERE id = @expense_id);
    IF @metodo IS NULL THROW 51000, N'Ese gasto no existe.', 1;
    SET @modo = UPPER(ISNULL(@modo, 'COMUN'));
    IF @modo NOT IN ('COMUN', 'SOCIOS') THROW 51000, N'Indica a cargo de quién es el gasto.', 1;
    IF @pagado_por IS NOT NULL AND @metodo = 'EFECTIVO'
        THROW 51000, N'Un gasto en efectivo salió del cajón: lo pagó el negocio.', 1;
    IF @pagado_por IS NOT NULL AND NOT EXISTS (SELECT 1 FROM dbo.socios WHERE id = @pagado_por AND activo = 1)
        THROW 51000, N'Ese socio no está activo.', 1;

    DECLARE @l TABLE (socio_id INT PRIMARY KEY, pct DECIMAL(7, 4));
    IF @modo = 'SOCIOS'
    BEGIN
        IF ISJSON(ISNULL(@lineas, '')) <> 1 THROW 51000, N'Indica de qué socios es el gasto.', 1;
        INSERT INTO @l (socio_id, pct)
        SELECT socioId, SUM(pct) FROM OPENJSON(@lineas) WITH (socioId INT, pct DECIMAL(7, 4))
         WHERE pct > 0 GROUP BY socioId;
        IF NOT EXISTS (SELECT 1 FROM @l) THROW 51000, N'Indica de qué socios es el gasto.', 1;
        IF EXISTS (SELECT 1 FROM @l l WHERE NOT EXISTS (SELECT 1 FROM dbo.socios s WHERE s.id = l.socio_id AND s.activo = 1))
            THROW 51000, N'Ese socio no está activo.', 1;
        IF ABS((SELECT SUM(pct) FROM @l) - 100) > 0.01 THROW 51000, N'El gasto debe repartirse al 100 %.', 1;
    END

    BEGIN TRAN;
        DELETE FROM dbo.socios_gasto WHERE expense_id = @expense_id;
        INSERT INTO dbo.socios_gasto (expense_id, modo, pagado_por_socio_id) VALUES (@expense_id, @modo, @pagado_por);
        INSERT INTO dbo.socios_gasto_lineas (expense_id, socio_id, pct) SELECT @expense_id, socio_id, pct FROM @l;
    COMMIT;

    SELECT g.expense_id, g.modo, g.pagado_por_socio_id, l.socio_id, l.pct
      FROM dbo.socios_gasto g LEFT JOIN dbo.socios_gasto_lineas l ON l.expense_id = g.expense_id
     WHERE g.expense_id = @expense_id;
END
GO
