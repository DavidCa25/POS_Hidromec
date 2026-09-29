/* ============================================================
   0041 — Actividad por hora

   Responde «¿a que hora tengo mas clientes?», «¿que viernes son mas
   fuertes?» y «¿necesito mas gente de 8 a 10?» con las ventas que ya hay.
   No hay tablas nuevas ni cifras precalculadas: todo se deriva de `sales`.

   QUE HORA ES LA DE UNA VENTA
   ---------------------------
   `sales.datee`: el momento del COBRO, que `sp_register_sale` escribe con
   GETDATE() dentro de su transaccion, con el reloj del servidor SQL. Es la
   unica marca que tienen todas las ventas -Retail, Touch, servicios y
   mesas- y la unica que no se puede editar despues.

   En una mesa el cobro llega al final de la comida. Para «a que hora entra
   la gente» en servicio de mesa, la apertura de la cuenta seria mas precisa;
   este reporte habla de cobros y lo dice en pantalla.

   QUE CUENTA
   ----------
     ticket    una venta. Una venta a credito es un ticket igual.
     ingreso   su total MENOS lo reembolsado de esa misma venta, sea cual sea
               el dia del reembolso: una devolucion no convierte la venta de
               las 9 en una venta mas pequena de las 18.
     dia       lunes = 0 ... domingo = 6. Se calcula contando dias desde el
               1900-01-01, que fue lunes: no depende de SET DATEFIRST, que
               cambia con el idioma del servidor.

   Para comparar horas y dias se devuelve tambien cuantos dias de cada tipo
   tiene el rango en el CALENDARIO, no solo los que tuvieron ventas: un
   martes sin ventas es un martes que cuenta.
   ============================================================ */
CREATE OR ALTER PROCEDURE dbo.sp_report_actividad_horaria
    @desde DATE,
    @hasta DATE
AS
BEGIN
    SET NOCOUNT ON;
    IF @desde IS NULL OR @hasta IS NULL
    BEGIN RAISERROR('Elige el rango de fechas.', 16, 1); RETURN; END
    IF @hasta < @desde
    BEGIN RAISERROR('La fecha final es anterior a la inicial.', 16, 1); RETURN; END
    IF DATEDIFF(DAY, @desde, @hasta) > 3660
    BEGIN RAISERROR('El rango es demasiado largo: elige diez años o menos.', 16, 1); RETURN; END

    DECLARE @ini DATETIME = CAST(@desde AS DATETIME);
    DECLARE @fin DATETIME = DATEADD(DAY, 1, CAST(@hasta AS DATETIME));

    DECLARE @v TABLE (
        id INT PRIMARY KEY, fecha DATE, dia INT, hora INT, neto DECIMAL(14, 2)
    );
    INSERT INTO @v (id, fecha, dia, hora, neto)
    SELECT s.id,
           CAST(s.datee AS DATE),
           DATEDIFF(DAY, 0, s.datee) % 7,
           DATEPART(HOUR, s.datee),
           CAST(s.total AS DECIMAL(14, 2)) - ISNULL(r.reembolsado, 0)
      FROM dbo.sales s
      OUTER APPLY (SELECT SUM(x.refund_total) AS reembolsado
                     FROM dbo.sale_refunds x WHERE x.sale_id = s.id) r
     WHERE s.datee >= @ini AND s.datee < @fin;

    /* Los dias del calendario, para promediar. */
    DECLARE @cal TABLE (fecha DATE PRIMARY KEY, dia INT);
    ;WITH d AS (
        SELECT @desde AS fecha
        UNION ALL
        SELECT DATEADD(DAY, 1, fecha) FROM d WHERE fecha < @hasta
    )
    INSERT INTO @cal (fecha, dia)
    SELECT fecha, DATEDIFF(DAY, CAST('19000101' AS DATE), fecha) % 7 FROM d
    OPTION (MAXRECURSION 3700);

    /* 1) Resumen */
    SELECT COUNT(*) AS tickets,
           ISNULL(SUM(neto), 0) AS ingresos,
           (SELECT COUNT(*) FROM @cal) AS dias,
           @desde AS desde, @hasta AS hasta
      FROM @v;

    /* 2) Celdas dia x hora (solo las que tienen algo) */
    SELECT dia, hora, COUNT(*) AS tickets, SUM(neto) AS ingresos
      FROM @v GROUP BY dia, hora ORDER BY dia, hora;

    /* 3) Por hora, las 24 aunque esten vacias */
    ;WITH h AS (SELECT 0 AS hora UNION ALL SELECT hora + 1 FROM h WHERE hora < 23)
    SELECT h.hora, COUNT(v.id) AS tickets, ISNULL(SUM(v.neto), 0) AS ingresos
      FROM h LEFT JOIN @v v ON v.hora = h.hora
     GROUP BY h.hora ORDER BY h.hora;

    /* 4) Por dia de la semana, con cuantos de ese dia tiene el rango */
    ;WITH w AS (SELECT 0 AS dia UNION ALL SELECT dia + 1 FROM w WHERE dia < 6)
    SELECT w.dia,
           (SELECT COUNT(*) FROM @v v WHERE v.dia = w.dia) AS tickets,
           ISNULL((SELECT SUM(v.neto) FROM @v v WHERE v.dia = w.dia), 0) AS ingresos,
           (SELECT COUNT(*) FROM @cal c WHERE c.dia = w.dia) AS dias_calendario
      FROM w ORDER BY w.dia;

    /* 5) Por fecha: cada viernes por separado, para saber cuales pesan */
    SELECT c.fecha, c.dia, COUNT(v.id) AS tickets, ISNULL(SUM(v.neto), 0) AS ingresos
      FROM @cal c LEFT JOIN @v v ON v.fecha = c.fecha
     GROUP BY c.fecha, c.dia ORDER BY c.fecha;
END
GO
