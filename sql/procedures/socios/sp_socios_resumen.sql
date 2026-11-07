/* sp_socios_resumen
 * Definicion canonica. Mantener este archivo y generar una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* ======================== sp_socios_resumen (0079) ========================
   Lo de cada socio en un periodo, sin cerrar nada. Sin fechas: el periodo
   abierto (desde el dia siguiente a la ultima liquidacion, o desde el
   inicio, hasta hoy).

   saldo_inicial es el saldo con el que cerro la ultima liquidacion anterior
   al periodo; saldo_final = saldo_inicial + resultado. Positivo: el negocio
   le debe. Negativo: el le debe al negocio.

   Recordset: una fila por socio, a centavos.
   ======================================================================= */
CREATE OR ALTER PROCEDURE dbo.sp_socios_resumen
    @desde DATE = NULL,
    @hasta DATE = NULL
AS
BEGIN
    SET NOCOUNT ON;

    IF NOT EXISTS (SELECT 1 FROM dbo.socios_config WHERE id = 1)
        THROW 51000, N'Socios no está configurado.', 1;

    DECLARE @ultima_hasta DATE = (SELECT MAX(hasta) FROM dbo.socios_liquidaciones);
    IF @desde IS NULL
        SET @desde = COALESCE(DATEADD(DAY, 1, @ultima_hasta), (SELECT inicio FROM dbo.socios_config WHERE id = 1));
    IF @hasta IS NULL SET @hasta = CAST(GETDATE() AS DATE);
    IF @hasta < @desde SET @hasta = @desde;

    CREATE TABLE #res (
        socio_id     INT NOT NULL PRIMARY KEY,
        vendido      DECIMAL(18, 6) NOT NULL DEFAULT 0,
        costo        DECIMAL(18, 6) NOT NULL DEFAULT 0,
        ganancia     DECIMAL(18, 6) NOT NULL DEFAULT 0,
        gastos       DECIMAL(18, 6) NOT NULL DEFAULT 0,
        anticipos    DECIMAL(18, 6) NOT NULL DEFAULT 0,
        aportaciones DECIMAL(18, 6) NOT NULL DEFAULT 0,
        retiros      DECIMAL(18, 6) NOT NULL DEFAULT 0,
        faltantes    DECIMAL(18, 6) NOT NULL DEFAULT 0
    );
    EXEC dbo.sp_socios_calcular @desde = @desde, @hasta = @hasta;

    /* El saldo con que cerro la liquidacion anterior a este periodo. */
    DECLARE @previa INT = (SELECT TOP (1) id FROM dbo.socios_liquidaciones WHERE hasta < @desde ORDER BY hasta DESC);
    INSERT INTO #res (socio_id)
    SELECT l.socio_id FROM dbo.socios_liquidacion_lineas l
     WHERE l.liquidacion_id = @previa AND l.saldo_final <> 0
       AND NOT EXISTS (SELECT 1 FROM #res r WHERE r.socio_id = l.socio_id);

    SELECT r.socio_id, s.nombre, s.activo, s.user_id,
           @desde AS desde, @hasta AS hasta,
           CAST(ROUND(r.vendido, 2) AS DECIMAL(14, 2))      AS vendido,
           CAST(ROUND(r.costo, 2) AS DECIMAL(14, 2))        AS costo,
           CAST(ROUND(r.ganancia, 2) AS DECIMAL(14, 2))     AS ganancia,
           CAST(ROUND(r.gastos, 2) AS DECIMAL(14, 2))       AS gastos,
           CAST(ROUND(r.anticipos, 2) AS DECIMAL(14, 2))    AS anticipos,
           CAST(ROUND(r.aportaciones, 2) AS DECIMAL(14, 2)) AS aportaciones,
           CAST(ROUND(r.retiros, 2) AS DECIMAL(14, 2))      AS retiros,
           CAST(ROUND(r.faltantes, 2) AS DECIMAL(14, 2))    AS faltantes,
           x.resultado,
           CAST(ISNULL(l.saldo_final, 0) AS DECIMAL(14, 2)) AS saldo_inicial,
           CAST(ISNULL(l.saldo_final, 0) + x.resultado AS DECIMAL(14, 2)) AS saldo_final
      FROM #res r
      JOIN dbo.socios s ON s.id = r.socio_id
      CROSS APPLY (SELECT CAST(ROUND(r.costo + r.ganancia - r.gastos - r.anticipos + r.aportaciones
                                     - r.retiros - r.faltantes, 2) AS DECIMAL(14, 2)) AS resultado) x
      LEFT JOIN dbo.socios_liquidacion_lineas l ON l.liquidacion_id = @previa AND l.socio_id = r.socio_id
     ORDER BY s.orden, s.id;
END
GO
