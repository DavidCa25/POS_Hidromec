/* sp_socios_liquidar
 * Definicion canonica. Mantener este archivo y generar una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* ======================== sp_socios_liquidar (0079) =======================
   Cierra el periodo que sigue a la ultima liquidacion (o al inicio) hasta
   @hasta. Una liquidacion cerrada ya no cambia: lo vendido estaba congelado
   y los gastos, anticipos y faltantes quedan escritos aqui.

   Los periodos no se enciman ni dejan huecos: siempre empieza al dia
   siguiente de la anterior. No se cierra un periodo que incluya hoy: el dia
   todavia no termina.

   Devuelve la liquidacion y sus lineas (sp_socios_liquidacion).
   ======================================================================= */
CREATE OR ALTER PROCEDURE dbo.sp_socios_liquidar
    @hasta   DATE,
    @user_id INT = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    IF NOT EXISTS (SELECT 1 FROM dbo.business_modules WHERE module_key = N'socios' AND enabled = 1)
        THROW 51000, N'Socios no está activado.', 1;
    IF @hasta IS NULL THROW 51000, N'Indica hasta qué día se liquida.', 1;
    IF @hasta >= CAST(GETDATE() AS DATE)
        THROW 51000, N'Solo se liquidan días que ya terminaron.', 1;

    /* El reparto de lo vendido, antes de abrir la transaccion. */
    EXEC dbo.sp_socios_asignar;

    DECLARE @id INT;
    BEGIN TRAN;
        DECLARE @ultima DATE = (SELECT MAX(hasta) FROM dbo.socios_liquidaciones WITH (UPDLOCK, HOLDLOCK));
        DECLARE @desde DATE = COALESCE(DATEADD(DAY, 1, @ultima), (SELECT inicio FROM dbo.socios_config WHERE id = 1));
        IF @hasta < @desde
            THROW 51000, N'Ese periodo ya está liquidado.', 1;

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

        DECLARE @previa INT = (SELECT TOP (1) id FROM dbo.socios_liquidaciones ORDER BY hasta DESC);

        /* Socios de la liquidacion anterior que hoy no tienen nada: su saldo
           sigue viajando. */
        INSERT INTO #res (socio_id)
        SELECT l.socio_id FROM dbo.socios_liquidacion_lineas l
         WHERE l.liquidacion_id = @previa AND l.saldo_final <> 0
           AND NOT EXISTS (SELECT 1 FROM #res r WHERE r.socio_id = l.socio_id);

        INSERT INTO dbo.socios_liquidaciones (desde, hasta, user_id) VALUES (@desde, @hasta, @user_id);
        SET @id = SCOPE_IDENTITY();

        INSERT INTO dbo.socios_liquidacion_lineas
            (liquidacion_id, socio_id, vendido, costo, ganancia, gastos, anticipos, aportaciones,
             retiros, faltantes, resultado, saldo_inicial, saldo_final)
        SELECT @id, r.socio_id,
               ROUND(r.vendido, 2), ROUND(r.costo, 2), ROUND(r.ganancia, 2), ROUND(r.gastos, 2),
               ROUND(r.anticipos, 2), ROUND(r.aportaciones, 2), ROUND(r.retiros, 2), ROUND(r.faltantes, 2),
               x.resultado, ISNULL(l.saldo_final, 0), ISNULL(l.saldo_final, 0) + x.resultado
          FROM #res r
          CROSS APPLY (SELECT CAST(ROUND(r.costo + r.ganancia - r.gastos - r.anticipos + r.aportaciones
                                         - r.retiros - r.faltantes, 2) AS DECIMAL(14, 2)) AS resultado) x
          LEFT JOIN dbo.socios_liquidacion_lineas l ON l.liquidacion_id = @previa AND l.socio_id = r.socio_id;
    COMMIT;

    EXEC dbo.sp_socios_liquidacion @id = @id;
END
GO
