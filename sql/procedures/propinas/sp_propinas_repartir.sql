/* sp_propinas_repartir
 * Definicion canonica. Mantener este archivo y generar una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* ======================= sp_propinas_repartir (0079) ======================
   Reparte las propinas pendientes de una caja entre el personal.

   @confirmar = 0  solo calcula: lo que le tocaria a cada quien.
   @confirmar = 1  lo paga: una salida del cajon (TIP_PAYOUT) por persona en
                   el turno abierto, y las propinas quedan repartidas.

   Ventana: de la primera propina pendiente a ahora.
   Comision: si la paga la propina, se le quita a la de tarjeta.
   Modo (propinas_config.reparto):
     ATENDIO  a cada quien lo que cobro (menos su comision);
     HORAS    el bote por horas trabajadas en la ventana (Asistencia);
     IGUALES  el bote en partes iguales entre quienes trabajaron.
   Sin jornadas en la ventana (Asistencia apagada, nadie checo), el bote va
   en partes iguales entre quienes cobraron propina.
   A centavos: lo que deja el redondeo se le suma al que mas recibe.

   recordset 1  el reparto (total, comision, neto, ventana, modo, id)
   recordset 2  una fila por persona (user_id, usuario, horas, monto)
   ======================================================================= */
CREATE OR ALTER PROCEDURE dbo.sp_propinas_repartir
    @register_id INT,
    @user_id     INT = NULL,
    @confirmar   BIT = 0
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    IF NOT EXISTS (SELECT 1 FROM dbo.business_modules WHERE module_key = N'propinas' AND enabled = 1)
        THROW 51000, N'Propinas no está activado.', 1;
    DECLARE @modo VARCHAR(8), @pct DECIMAL(5, 2), @coma VARCHAR(8);
    SELECT @modo = reparto, @pct = comision_pct, @coma = comision_a FROM dbo.propinas_config WHERE id = 1;

    DECLARE @closure INT = NULL, @reparto INT = NULL;
    IF @confirmar = 1 BEGIN TRAN;

    CREATE TABLE #p (id INT PRIMARY KEY, monto DECIMAL(12, 2), comision DECIMAL(12, 4), user_id INT, fecha DATETIME2(0));
    IF @confirmar = 1
        INSERT INTO #p SELECT id, monto, CASE WHEN metodo = 'TARJETA' AND @coma = 'PROPINA' THEN monto * @pct / 100 ELSE 0 END, user_id, fecha
          FROM dbo.propinas WITH (UPDLOCK, HOLDLOCK) WHERE register_id = @register_id AND reparto_id IS NULL;
    ELSE
        INSERT INTO #p SELECT id, monto, CASE WHEN metodo = 'TARJETA' AND @coma = 'PROPINA' THEN monto * @pct / 100 ELSE 0 END, user_id, fecha
          FROM dbo.propinas WHERE register_id = @register_id AND reparto_id IS NULL;

    DECLARE @desde DATETIME2(0) = (SELECT MIN(fecha) FROM #p), @hasta DATETIME2(0) = SYSDATETIME();
    DECLARE @total DECIMAL(12, 2) = ISNULL((SELECT SUM(monto) FROM #p), 0);
    DECLARE @comision DECIMAL(12, 2) = ROUND(ISNULL((SELECT SUM(comision) FROM #p), 0), 2);
    DECLARE @neto DECIMAL(12, 2) = @total - @comision;

    CREATE TABLE #r (user_id INT PRIMARY KEY, horas DECIMAL(9, 2) NULL, w DECIMAL(18, 8) NOT NULL, monto DECIMAL(12, 2) NOT NULL DEFAULT 0);

    IF @total > 0
    BEGIN
        IF @modo = 'ATENDIO'
            INSERT INTO #r (user_id, horas, w)
            SELECT user_id, NULL, 0 FROM #p GROUP BY user_id;
        ELSE
        BEGIN
            /* Horas de cada quien dentro de la ventana. */
            INSERT INTO #r (user_id, horas, w)
            SELECT j.user_id,
                   CAST(SUM(DATEDIFF(MINUTE,
                        CASE WHEN j.entrada_en > @desde THEN j.entrada_en ELSE @desde END,
                        CASE WHEN ISNULL(j.salida_en, @hasta) < @hasta THEN ISNULL(j.salida_en, @hasta) ELSE @hasta END)) / 60.0 AS DECIMAL(9, 2)),
                   0
              FROM dbo.asistencia_jornadas j
             WHERE j.entrada_en < @hasta AND ISNULL(j.salida_en, @hasta) > @desde
             GROUP BY j.user_id
            HAVING SUM(DATEDIFF(MINUTE,
                        CASE WHEN j.entrada_en > @desde THEN j.entrada_en ELSE @desde END,
                        CASE WHEN ISNULL(j.salida_en, @hasta) < @hasta THEN ISNULL(j.salida_en, @hasta) ELSE @hasta END)) > 0;

            IF NOT EXISTS (SELECT 1 FROM #r)
                INSERT INTO #r (user_id, horas, w) SELECT DISTINCT user_id, NULL, 0 FROM #p;

            DECLARE @h DECIMAL(18, 4) = (SELECT SUM(horas) FROM #r);
            IF @modo = 'HORAS' AND ISNULL(@h, 0) > 0
                UPDATE #r SET w = horas / @h;
            ELSE
                UPDATE #r SET w = 1.0 / (SELECT COUNT(*) FROM #r);
        END

        IF @modo = 'ATENDIO'
            UPDATE r SET w = x.m / NULLIF(@neto, 0)
              FROM #r r JOIN (SELECT user_id, SUM(monto - comision) AS m FROM #p GROUP BY user_id) x ON x.user_id = r.user_id;

        UPDATE #r SET monto = ROUND(@neto * w, 2);
        ;WITH m AS (SELECT TOP (1) user_id FROM #r ORDER BY monto DESC, user_id)
        UPDATE r SET monto = r.monto + (@neto - (SELECT SUM(monto) FROM #r))
          FROM #r r JOIN m ON m.user_id = r.user_id;
        DELETE FROM #r WHERE monto <= 0;
    END

    IF @confirmar = 1
    BEGIN
        IF @total <= 0 THROW 51000, N'No hay propinas pendientes en esta caja.', 1;
        SELECT TOP (1) @closure = id FROM dbo.cash_closures WITH (UPDLOCK, HOLDLOCK)
         WHERE register_id = @register_id AND closed_at IS NULL
         ORDER BY opened_at DESC, id DESC;
        IF @closure IS NULL THROW 51000, N'Abre el turno de esta caja para pagar las propinas.', 1;

        INSERT INTO dbo.propinas_repartos (register_id, closure_id, desde, hasta, modo, total, comision, neto, user_id)
        VALUES (@register_id, @closure, @desde, @hasta, @modo, @total, @comision, @neto, @user_id);
        SET @reparto = SCOPE_IDENTITY();

        INSERT INTO dbo.propinas_reparto_lineas (reparto_id, user_id, horas, monto)
        SELECT @reparto, user_id, horas, monto FROM #r;

        /* Una salida del cajon por persona, ligada a su linea. */
        DECLARE @u INT, @m DECIMAL(12, 2), @nombre NVARCHAR(50), @cash INT;
        DECLARE c CURSOR LOCAL FAST_FORWARD FOR SELECT r.user_id, r.monto, u.usuario FROM #r r JOIN dbo.users u ON u.id = r.user_id;
        OPEN c;
        FETCH NEXT FROM c INTO @u, @m, @nombre;
        WHILE @@FETCH_STATUS = 0
        BEGIN
            INSERT INTO dbo.cash_movements (datee, userId, typee, reference_id, reference, amount, note, closure_id, register_id)
            VALUES (GETDATE(), @user_id, 'TIP_PAYOUT', @reparto, CONCAT(N'PROPINAS ', @reparto), -@m,
                    LEFT(CONCAT(N'Propinas de ', @nombre), 200), @closure, @register_id);
            SET @cash = SCOPE_IDENTITY();
            UPDATE dbo.propinas_reparto_lineas SET cash_movement_id = @cash WHERE reparto_id = @reparto AND user_id = @u;
            FETCH NEXT FROM c INTO @u, @m, @nombre;
        END
        CLOSE c; DEALLOCATE c;

        UPDATE p SET reparto_id = @reparto FROM dbo.propinas p JOIN #p x ON x.id = p.id;
        COMMIT;
    END

    SELECT @reparto AS reparto_id, @register_id AS register_id, @modo AS modo, @desde AS desde, @hasta AS hasta,
           @total AS total, @comision AS comision, @neto AS neto, (SELECT COUNT(*) FROM #p) AS propinas;
    SELECT r.user_id, u.usuario, r.horas, r.monto
      FROM #r r JOIN dbo.users u ON u.id = r.user_id
     ORDER BY r.monto DESC, u.usuario;
END
GO
