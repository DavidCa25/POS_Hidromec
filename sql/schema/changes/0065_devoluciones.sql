/* ============================================================
   0065 — Devoluciones (esquema)

   sale_refunds.reason       el motivo, obligatorio desde 0065 (el
                             procedimiento lo exige; las devoluciones
                             anteriores quedan sin motivo).
   sale_refunds.register_id  la caja que hizo la devolución. Antes solo se
                             sabía si había sacado efectivo (closure_id); una
                             devolución a tarjeta no aparecía en ningún corte.
   sale_refunds.exchange_amount   lo que se apartó para un CAMBIO (no regresó
                             como dinero); exchange_sale_id, la venta del
                             cambio que lo usó (una vez).

   Aditiva: nada existente cambia de significado.
   ============================================================ */
IF COL_LENGTH(N'dbo.sale_refunds', N'reason') IS NULL
    ALTER TABLE dbo.sale_refunds ADD reason NVARCHAR(40) COLLATE Modern_Spanish_CI_AS NULL;
GO
IF COL_LENGTH(N'dbo.sale_refunds', N'register_id') IS NULL
    ALTER TABLE dbo.sale_refunds ADD register_id INT NULL;
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_sale_refunds_register' AND object_id = OBJECT_ID(N'dbo.sale_refunds'))
    CREATE NONCLUSTERED INDEX IX_sale_refunds_register ON dbo.sale_refunds (register_id, datee) INCLUDE (refund_total, closure_id);
GO
IF COL_LENGTH(N'dbo.sale_refunds', N'exchange_amount') IS NULL
    ALTER TABLE dbo.sale_refunds ADD exchange_amount DECIMAL(12,2) NULL;
GO
IF COL_LENGTH(N'dbo.sale_refunds', N'exchange_sale_id') IS NULL
    ALTER TABLE dbo.sale_refunds ADD exchange_sale_id INT NULL;
GO
