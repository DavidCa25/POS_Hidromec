/* sp_get_cash_closures
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
-- =============================================
-- Author:		<David Casillas>
-- Create date: <18-08-2025>
-- Description:	<Obtener cash_closures>
-- =============================================
CREATE OR ALTER PROCEDURE [dbo].[sp_get_cash_closures]
    @start_date DATE = NULL,
    @end_date   DATE = NULL
AS
BEGIN
    SET NOCOUNT ON;

    IF @start_date IS NULL SET @start_date = CAST(GETDATE() AS DATE);
    IF @end_date   IS NULL SET @end_date   = @start_date;

    SELECT
        c.id,
        c.userId,
        u.usuario AS user_name,
        c.create_date,
        c.cash_expected,
        c.cash_delivered,
        c.difference
    FROM cash_closures c
    INNER JOIN users u ON u.id = c.userId
    WHERE CAST(c.create_date AS DATE) BETWEEN @start_date AND @end_date
    ORDER BY c.create_date DESC;
END
GO
