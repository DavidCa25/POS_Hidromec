/* ============================================================
   0058 — La version de la politica comercial, una sola (datos)

   En una sucursal de MultiSucursal, el catalogo de la matriz llegaba con la
   version de la matriz DENTRO del JSON y la columna llevaba otra. Las
   cotizaciones usaban una y el cobro comparaba contra la otra: no se podia
   cobrar ninguna cuenta ("La cotizacion cambio o ya se utilizo").

   Aqui se alinea el JSON con la columna en las bases que ya lo tienen
   desalineado. sp_corporate_catalog_apply ya no lo vuelve a separar.
   Idempotente: si ya coinciden, no toca nada.
   ============================================================ */
IF OBJECT_ID(N'dbo.commercial_policy', 'U') IS NOT NULL
    UPDATE dbo.commercial_policy
       SET payload = JSON_MODIFY(payload, '$.version', version)
     WHERE ISJSON(payload) = 1
       AND ISNULL(TRY_CONVERT(INT, JSON_VALUE(payload, '$.version')), -1) <> version;
GO
