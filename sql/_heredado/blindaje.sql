/* ============================================================
   BLINDAJE WYBIX  ·  Anti robo hormiga
   Ejecutar en SSMS sobre la base Wybix_POS (o Wybix_Production).
   Incluye: bitácora de seguridad, autorización de supervisor,
   agregados por cajero e índice de riesgo.
   ============================================================ */

/* 1) Bitácora de seguridad (auditoría de acciones sensibles) */
IF OBJECT_ID('dbo.security_events', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.security_events (
        id             INT IDENTITY(1,1) PRIMARY KEY,
        datee          DATETIME       NOT NULL DEFAULT GETDATE(),
        user_id        INT            NULL,   -- quién realizó la acción (cajero)
        authorized_by  INT            NULL,   -- supervisor que autorizó (si aplica)
        register_id    INT            NULL,   -- caja
        event_type     NVARCHAR(40)   NOT NULL, -- VOID_SALE, REFUND, DRAWER_NO_SALE, ITEM_REMOVED, DISCOUNT, PRICE_CHANGE, INV_ADJUST
        amount         DECIMAL(18,2)  NULL,   -- monto involucrado
        detail         NVARCHAR(400)  NULL,   -- descripción / referencia
        sale_id        INT            NULL
    );
    CREATE INDEX IX_secev_user_date ON dbo.security_events (user_id, datee);
    CREATE INDEX IX_secev_type_date ON dbo.security_events (event_type, datee);
END
GO

/* 2) Registrar un evento de seguridad */
CREATE OR ALTER PROCEDURE dbo.sp_log_security_event
    @user_id INT = NULL, @authorized_by INT = NULL, @register_id INT = NULL,
    @event_type NVARCHAR(40), @amount DECIMAL(18,2) = NULL,
    @detail NVARCHAR(400) = NULL, @sale_id INT = NULL
AS
BEGIN
    SET NOCOUNT ON;
    INSERT INTO dbo.security_events (user_id, authorized_by, register_id, event_type, amount, detail, sale_id)
    VALUES (@user_id, @authorized_by, @register_id, @event_type, @amount, @detail, @sale_id);
    SELECT SCOPE_IDENTITY() AS id;
END
GO

/* 3) Autorizar supervisor (valida usuario+contraseña con rol admin/supervisor) */
CREATE OR ALTER PROCEDURE dbo.sp_authorize_supervisor
    @usuario NVARCHAR(50), @password NVARCHAR(255)
AS
BEGIN
    SET NOCOUNT ON;
    SELECT TOP 1 id, usuario, rol
    FROM dbo.users
    WHERE usuario = @usuario
      AND active = 1
      AND rol IN ('admin', 'supervisor')
      AND password_hash = CONVERT(NVARCHAR(255), HASHBYTES('SHA2_256', @password), 2);
END
GO

/* 4) Resumen de eventos por cajero (para alertas) */
CREATE OR ALTER PROCEDURE dbo.sp_security_by_cashier
    @from DATE = NULL, @to DATE = NULL
AS
BEGIN
    SET NOCOUNT ON;
    IF @from IS NULL SET @from = DATEADD(DAY, -30, CAST(GETDATE() AS DATE));
    IF @to   IS NULL SET @to   = CAST(GETDATE() AS DATE);

    SELECT u.id AS user_id, u.usuario AS cajero,
        SUM(CASE WHEN e.event_type = 'VOID_SALE'      THEN 1 ELSE 0 END) AS anuladas,
        SUM(CASE WHEN e.event_type = 'REFUND'         THEN 1 ELSE 0 END) AS devoluciones,
        SUM(CASE WHEN e.event_type = 'DRAWER_NO_SALE' THEN 1 ELSE 0 END) AS cajon_sin_venta,
        SUM(CASE WHEN e.event_type = 'ITEM_REMOVED'   THEN 1 ELSE 0 END) AS eliminados,
        SUM(CASE WHEN e.event_type IN ('DISCOUNT','PRICE_CHANGE') THEN 1 ELSE 0 END) AS descuentos,
        SUM(CASE WHEN e.event_type = 'INV_ADJUST'     THEN 1 ELSE 0 END) AS ajustes_inv,
        SUM(ISNULL(e.amount, 0)) AS monto_riesgo
    FROM dbo.users u
    LEFT JOIN dbo.security_events e
        ON e.user_id = u.id AND e.datee >= @from AND e.datee < DATEADD(DAY, 1, @to)
    WHERE u.rol IN ('cajero','supervisor','admin')
    GROUP BY u.id, u.usuario
    ORDER BY monto_riesgo DESC;
END
GO

/* 5) Índice de riesgo por cajero (semáforo bajo/medio/alto) */
CREATE OR ALTER PROCEDURE dbo.sp_cashier_risk
    @from DATE = NULL, @to DATE = NULL
AS
BEGIN
    SET NOCOUNT ON;
    IF @from IS NULL SET @from = DATEADD(DAY, -30, CAST(GETDATE() AS DATE));
    IF @to   IS NULL SET @to   = CAST(GETDATE() AS DATE);

    ;WITH agg AS (
        SELECT u.id AS user_id, u.usuario AS cajero,
            SUM(CASE WHEN e.event_type = 'VOID_SALE'      THEN 1 ELSE 0 END) AS anuladas,
            SUM(CASE WHEN e.event_type = 'REFUND'         THEN 1 ELSE 0 END) AS devoluciones,
            SUM(CASE WHEN e.event_type = 'DRAWER_NO_SALE' THEN 1 ELSE 0 END) AS cajon_sin_venta,
            SUM(CASE WHEN e.event_type = 'ITEM_REMOVED'   THEN 1 ELSE 0 END) AS eliminados,
            SUM(CASE WHEN e.event_type IN ('DISCOUNT','PRICE_CHANGE') THEN 1 ELSE 0 END) AS descuentos,
            SUM(ISNULL(e.amount, 0)) AS monto_riesgo
        FROM dbo.users u
        LEFT JOIN dbo.security_events e
            ON e.user_id = u.id AND e.datee >= @from AND e.datee < DATEADD(DAY, 1, @to)
        WHERE u.rol IN ('cajero','supervisor','admin')
        GROUP BY u.id, u.usuario
    ),
    scored AS (
        SELECT *,
            (anuladas*8 + devoluciones*6 + cajon_sin_venta*5 + eliminados*3 + descuentos*4) AS raw
        FROM agg
    )
    SELECT user_id, cajero, anuladas, devoluciones, cajon_sin_venta, eliminados, descuentos, monto_riesgo,
        CASE WHEN raw > 100 THEN 100 ELSE raw END AS score,
        CASE WHEN raw >= 60 THEN 'alto' WHEN raw >= 30 THEN 'medio' ELSE 'bajo' END AS nivel
    FROM scored
    ORDER BY raw DESC;
END
GO
