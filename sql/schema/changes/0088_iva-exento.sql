/* ============================================================
   0088 — IVA exento, distinto de la tasa 0

   Hasta aquí «0% / Exento» era una sola opción: tasa_iva = 0. Para el SAT
   son dos cosas:

     tasa 0      el producto causa IVA a la tasa del 0% (medicinas de
                 patente, alimentos sin procesar). El CFDI lleva el
                 traslado con TipoFactor «Tasa» y TasaOCuota 0.000000, y da
                 derecho a acreditar el IVA de las compras.
     exento      el acto no causa IVA (honorarios médicos y dentales,
                 art. 15 fr. XIV LIVA; colegiaturas; renta de casa
                 habitación). El CFDI lleva TipoFactor «Exento», sin tasa ni
                 importe, y el IVA de las compras NO se acredita.

   products.iva_exento   1 = exento. Solo cuenta con tasa_iva = 0: quien lo
                         lee pregunta `tasa_iva = 0 AND iva_exento = 1`. No
                         es un CHECK a propósito: la importación, el catálogo
                         corporativo y la edición rápida cambian la tasa sin
                         saber de esta columna, y un producto que vuelve al
                         16% simplemente deja de ser exento. Por omisión 0:
                         nada existente cambia.

   Esta migración también despliega sp_salud_estudios_catalogo (0087):
   lee iva_exento, que no existe hasta aquí.

   El precio y el ticket no cambian (los dos cobran 0 de IVA); cambia la
   factura y, con ella, la contabilidad del negocio.
   ============================================================ */

IF COL_LENGTH(N'dbo.products', N'iva_exento') IS NULL
    ALTER TABLE dbo.products ADD iva_exento BIT NOT NULL
        CONSTRAINT DF_products_iva_exento DEFAULT (0) WITH VALUES;
GO
