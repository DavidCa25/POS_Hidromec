SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* ================= sp_cash_closure_email_list (0061) =================
   Los cortes cerrados de un periodo con el estado de su correo. Un corte
   sin renglón en cash_closure_email_jobs sale como SIN_ENVIAR: es lo que
   pasa con los cortes anteriores a esta versión.

   @solo_pendientes = 1: lo que el botón "Enviar pendientes" puede mandar
   (todo lo que no está ENVIADO), del más viejo al más nuevo.
   ==================================================================== */
CREATE OR ALTER PROCEDURE dbo.sp_cash_closure_email_list
    @desde           DATE = NULL,
    @hasta           DATE = NULL,
    @register_id     INT  = NULL,
    @solo_pendientes BIT  = 0,
    @top             INT  = 200
AS
BEGIN
    SET NOCOUNT ON;
    IF @hasta IS NULL SET @hasta = CAST(SYSDATETIME() AS DATE);
    IF @desde IS NULL SET @desde = DATEADD(DAY, -30, @hasta);
    IF @top IS NULL OR @top < 1 OR @top > 500 SET @top = 200;

    SELECT TOP (@top)
           c.id, c.opened_at, c.closed_at, r.name AS register_name, u.usuario AS cashier,
           TRY_CONVERT(DECIMAL(12, 2), JSON_VALUE(c.receipt_snapshot, '$.total')) AS total,
           c.difference,
           ISNULL(j.status, N'SIN_ENVIAR') AS email_status,
           j.sent_at, j.attempts, j.recipients, j.last_error
      FROM dbo.cash_closures c
      LEFT JOIN dbo.registers r ON r.id = c.register_id
      LEFT JOIN dbo.users u ON u.id = c.userId
      LEFT JOIN dbo.cash_closure_email_jobs j ON j.closure_id = c.id
     WHERE c.closed_at IS NOT NULL
       AND c.closed_at >= @desde AND c.closed_at < DATEADD(DAY, 1, @hasta)
       AND (@register_id IS NULL OR c.register_id = @register_id)
       AND (@solo_pendientes = 0 OR ISNULL(j.status, N'SIN_ENVIAR') <> N'ENVIADO')
     ORDER BY CASE WHEN @solo_pendientes = 1 THEN c.closed_at END ASC,
              c.closed_at DESC, c.id DESC;
END;
GO
