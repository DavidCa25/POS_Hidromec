/* ============================================================
   0073 — Venta suelta (esquema)

   Vender por pieza lo que se compra en paquete: el cigarro de la cajetilla
   de 20, el chicle del paquete, la pila del blister. El suelto es un
   producto normal -su precio, su codigo de barras, su lugar en el ticket- que
   cuelga de su paquete.

   Es una aplicacion: solo existe para el negocio que la activa desde
   Aplicaciones (`business_modules.module_key = 'venta-suelta'`).

   venta_suelta   una fila por producto suelto: de que paquete sale y
                  cuantas piezas trae el paquete.

   COMO SE DESCUENTA (sp_register_sale, paso 3c): el stock del suelto se
   lleva en piezas enteras. Si una venta pide mas piezas de las que hay, se
   abren los paquetes justos -paquete -N, suelto +N x piezas- con movimientos
   de fuente 'APERTURA'. Por eso no hace falta mas precision en el stock: un
   cigarro nunca es 0.05 de cajetilla.

   Un solo nivel: un suelto no tiene sueltos, y un paquete no cuelga de otro.

   Aditiva: nada existente cambia.
   ============================================================ */
IF OBJECT_ID(N'dbo.venta_suelta', N'U') IS NULL
CREATE TABLE dbo.venta_suelta (
    product_id         INT          NOT NULL CONSTRAINT PK_venta_suelta PRIMARY KEY CLUSTERED,
    parent_product_id  INT          NOT NULL,
    piezas             INT          NOT NULL,
    updated_at         DATETIME2(0) NOT NULL CONSTRAINT DF_venta_suelta_upd DEFAULT (SYSDATETIME()),
    updated_by         INT          NULL,
    CONSTRAINT FK_venta_suelta_product FOREIGN KEY (product_id) REFERENCES dbo.products (id),
    CONSTRAINT FK_venta_suelta_parent FOREIGN KEY (parent_product_id) REFERENCES dbo.products (id),
    CONSTRAINT CK_venta_suelta_distinto CHECK (product_id <> parent_product_id),
    CONSTRAINT CK_venta_suelta_piezas CHECK (piezas BETWEEN 2 AND 10000)
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_venta_suelta_parent' AND object_id = OBJECT_ID(N'dbo.venta_suelta'))
CREATE NONCLUSTERED INDEX IX_venta_suelta_parent ON dbo.venta_suelta (parent_product_id);
GO
