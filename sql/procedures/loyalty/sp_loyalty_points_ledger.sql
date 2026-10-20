SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* ===================== sp_loyalty_points_ledger (0064) =====================
   El historial de puntos y sellos de un cliente, del más reciente al más
   antiguo. Es la respuesta a "¿por qué tengo estos puntos?".
   ========================================================================== */
CREATE OR ALTER PROCEDURE dbo.sp_loyalty_points_ledger
    @customer_id INT
AS
BEGIN
    SET NOCOUNT ON;
    SELECT TOP (300) l.id, l.created_at, l.program, l.card_id, k.name AS tarjeta, l.delta, l.kind, l.reason,
           l.sale_id, l.refund_id, rd.name AS recompensa, l.amount, u.usuario, l.note, l.origin, l.location_name
      FROM dbo.loyalty_ledger l
      LEFT JOIN dbo.loyalty_stamp_cards k ON k.id = l.card_id
      LEFT JOIN dbo.reward_definitions rd ON rd.id = l.reward_definition_id
      LEFT JOIN dbo.users u ON u.id = l.user_id
     WHERE l.customer_id = @customer_id
     ORDER BY l.created_at DESC, l.id DESC;
END;
GO
