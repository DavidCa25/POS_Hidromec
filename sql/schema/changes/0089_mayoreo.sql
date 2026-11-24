/* ============================================================
   0089 — Mayoreo: presentaciones de venta y lista de precios por cliente

   PRESENTACIÓN DE VENTA
   Hasta aquí una presentación (product_presentations) solo servía para
   comprar: «Cartón 24» entraba al inventario como 24 piezas. Ahora también
   se vende, con su propio código de barras y su propio precio:

     bar_code     el código impreso en el cartón. Al escanearlo, la caja
                  agrega 24 piezas del producto al precio del cartón.
     sale_price   el precio del cartón completo. NULL = no se vende así
                  (sigue siendo solo de compra, como antes).

   El inventario y la venta siguen en piezas: sale_detail guarda las 24
   piezas con el precio del cartón repartido entre ellas (el centavo que no
   divide exacto queda en la última). Así devoluciones, existencias,
   reportes y factura no cambian. Quien decide el precio es la cotización
   comercial (shared/comercial.ts, `pack`), no la pantalla.

   El contenido de una presentación de venta es un número entero de piezas,
   de 2 a 1000: se cobra por unidades completas.

   LISTA DE PRECIOS POR CLIENTE
   customers.price_channel   el canal comercial cuyos precios paga el
                             cliente (p. ej. «MAYOREO»). Al asignar el
                             cliente a la cuenta, la caja cambia a ese canal.
                             Un canal marcado «solo clientes» (customersOnly
                             en la política) únicamente se cotiza para un
                             cliente que lo tiene asignado, y sp_register_sale
                             comprueba que la venta sea de ese cliente.
   ============================================================ */

IF COL_LENGTH(N'dbo.product_presentations', N'bar_code') IS NULL
    ALTER TABLE dbo.product_presentations ADD bar_code NVARCHAR(50) NULL;
IF COL_LENGTH(N'dbo.product_presentations', N'sale_price') IS NULL
    ALTER TABLE dbo.product_presentations ADD sale_price DECIMAL(10, 2) NULL;
GO

IF OBJECT_ID(N'dbo.CK_product_presentations_venta', 'C') IS NULL
    ALTER TABLE dbo.product_presentations WITH CHECK ADD CONSTRAINT CK_product_presentations_venta
        CHECK (sale_price IS NULL OR (sale_price >= 0 AND factor_to_base >= 2 AND factor_to_base <= 1000
               AND factor_to_base = ROUND(factor_to_base, 0)));
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'UX_product_presentations_bar_code'
               AND object_id = OBJECT_ID(N'dbo.product_presentations'))
    CREATE UNIQUE NONCLUSTERED INDEX UX_product_presentations_bar_code
        ON dbo.product_presentations (bar_code) WHERE bar_code IS NOT NULL;
GO

IF COL_LENGTH(N'dbo.customers', N'price_channel') IS NULL
    ALTER TABLE dbo.customers ADD price_channel NVARCHAR(64) NULL;
GO
