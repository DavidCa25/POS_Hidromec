/* ============================================================================
   0048 — MODO VENTA ESENCIAL (licencia sin suscripcion activa)
   ----------------------------------------------------------------------------
   Cuando la suscripcion vence y pasan los 45 dias de gracia, Wybix sigue
   vendiendo pero deja de administrar el inventario. No se toca ningun
   producto: la regla vive en `sp_register_sale` (@venta_esencial), no en los
   datos. Cada venta hecha asi queda marcada, para poder decir al renovar
   cuantas hubo y entre que fechas, y recomendar un conteo.
   ========================================================================== */
IF COL_LENGTH(N'dbo.sales', N'venta_esencial') IS NULL
    ALTER TABLE dbo.sales ADD venta_esencial BIT NOT NULL
        CONSTRAINT DF_sales_venta_esencial DEFAULT (0);
