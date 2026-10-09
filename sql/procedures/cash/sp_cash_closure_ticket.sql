SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
CREATE OR ALTER PROCEDURE dbo.sp_cash_closure_ticket @closure_id INT, @freeze BIT=0
AS
BEGIN
 SET NOCOUNT ON;
 DECLARE @snapshot NVARCHAR(MAX);
 SELECT @snapshot=receipt_snapshot FROM dbo.cash_closures WHERE id=@closure_id;
 IF @snapshot IS NULL BEGIN
 SELECT @snapshot=(SELECT c.id,c.userId,c.opened_at,c.closed_at,c.opening_cash,c.cash_expected,c.cash_delivered,c.difference,r.name register_name,u.usuario cashier,
 ISNULL(v.total,0) total,ISNULL(v.tickets,0) tickets,ISNULL(v.discount,0) discount,
 (SELECT ISNULL(SUM(refund_total),0) FROM dbo.sale_refunds f WHERE f.closure_id=c.id) refunds,
 (SELECT ISNULL(SUM(CASE WHEN amount>0 AND typee NOT IN('OPENING','SALE') THEN amount ELSE 0 END),0) FROM dbo.cash_movements m WHERE m.closure_id=c.id) cash_in,
 (SELECT ISNULL(SUM(CASE WHEN amount<0 THEN -amount ELSE 0 END),0) FROM dbo.cash_movements m WHERE m.closure_id=c.id) cash_out,
 (SELECT SUM(CASE WHEN d.tax_object='02' THEN d.subtotal-d.subtotal/(1+d.tax_rate) ELSE 0 END) FROM dbo.sales s JOIN dbo.sale_detail d ON d.sale_id=s.id WHERE (s.closure_id=c.id OR (s.closure_id IS NULL AND s.register_id=c.register_id AND s.datee>=c.opened_at AND s.datee<=ISNULL(c.closed_at,SYSDATETIME()))) AND d.tax_rate IS NOT NULL) tax,
 JSON_QUERY((SELECT p.payment_method,SUM(p.amount) amount FROM (
 SELECT s.register_id,s.datee,s.closure_id,p.payment_method,p.amount FROM dbo.sales s JOIN dbo.sale_payments p ON p.sale_id=s.id
 UNION ALL SELECT s.register_id,s.datee,s.closure_id,s.payment_method,s.total FROM dbo.sales s WHERE NOT EXISTS(SELECT 1 FROM dbo.sale_payments p WHERE p.sale_id=s.id)
 ) p WHERE (p.closure_id=c.id OR (p.closure_id IS NULL AND c.register_id=p.register_id AND p.datee>=c.opened_at AND p.datee<=ISNULL(c.closed_at,SYSDATETIME()))) GROUP BY p.payment_method FOR JSON PATH)) payments
 FROM dbo.cash_closures c LEFT JOIN dbo.registers r ON r.id=c.register_id LEFT JOIN dbo.users u ON u.id=c.userId
 OUTER APPLY(SELECT SUM(s.total) total,COUNT(*) tickets,SUM(TRY_CONVERT(DECIMAL(12,2),JSON_VALUE(s.commercial_snapshot,'$.discount'))) discount FROM dbo.sales s WHERE (s.closure_id=c.id OR (s.closure_id IS NULL AND s.register_id=c.register_id AND s.datee>=c.opened_at AND s.datee<=ISNULL(c.closed_at,SYSDATETIME())))) v WHERE c.id=@closure_id FOR JSON PATH, WITHOUT_ARRAY_WRAPPER);
 END;
 IF @snapshot IS NULL THROW 51000,'No existe ese corte.',1;
 IF @freeze=1 BEGIN
 UPDATE dbo.cash_closures SET receipt_snapshot=@snapshot WHERE id=@closure_id AND closed_at IS NOT NULL AND receipt_snapshot IS NULL;
 RETURN;
 END;
 SELECT @snapshot document_json;
END;
GO
