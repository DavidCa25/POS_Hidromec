/* sp_coupon_validate
 * Definicion canonica. Mantener este archivo y generar una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* ============================================================
   sp_coupon_validate — ¿este codigo sirve, y para que?

   Lo llama la caja cuando alguien teclea o escanea un cupon, ANTES de cobrar.
   No consume nada: solo mira. Consumir es `sp_coupon_redeem`, y ocurre cuando
   la venta ya esta cobrada.

   Devuelve SIEMPRE una fila, con `ok` y un `motivo` legible. Un cupon que no
   sirve no es un error del sistema -es el caso normal de un papel caducado- y
   tratarlo como excepcion obligaria a la pantalla a leer mensajes de SQL para
   decidir que ensenar.

   MOTIVOS
   -------
   NO_EXISTE      el codigo no corresponde a ningun cupon
   EXPIRADO       paso su vigencia
   AGOTADO        ya se uso todas las veces que permitia
   ANULADO        alguien lo invalido
   INACTIVO       la definicion se apago despues de emitirlo
   OK             sirve

   APLICABLE
   ---------
   `aplicable` es distinto de `ok`. Un cupon puede ser perfectamente valido y
   aun asi no poder aplicarse en el punto de venta, porque el tipo de
   beneficio no esta soportado todavia. Ver la nota de sp_coupon_redeem.
   ============================================================ */
CREATE OR ALTER PROCEDURE [dbo].[sp_coupon_validate]
    @code NVARCHAR(24)
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @ahora DATETIME2(0) = SYSDATETIME();   /* hora local: misma politica que sp_loyalty_evaluate_sale */

    SET @code = LTRIM(RTRIM(ISNULL(@code, N'')));

    DECLARE @id INT, @estado NVARCHAR(12), @expira DATETIME2(0),
            @permitidos INT, @usados INT, @activa BIT, @kind NVARCHAR(20);

    SELECT @id = ci.id, @estado = ci.status, @expira = ci.expires_at,
           @permitidos = ci.uses_allowed, @usados = ci.uses_count,
           @activa = cd.active, @kind = cd.kind
    FROM dbo.coupon_instances ci
    JOIN dbo.coupon_definitions cd ON cd.id = ci.definition_id
    WHERE ci.code = @code;

    DECLARE @motivo NVARCHAR(20) =
        CASE
            WHEN @id IS NULL THEN 'NO_EXISTE'
            WHEN @estado = 'VOID' THEN 'ANULADO'
            WHEN @activa = 0 THEN 'INACTIVO'
            WHEN @expira IS NOT NULL AND @expira < @ahora THEN 'EXPIRADO'
            WHEN @usados >= @permitidos OR @estado = 'REDEEMED' THEN 'AGOTADO'
            ELSE 'OK'
        END;

    /* Solo el producto gratis se puede aplicar hoy: ver sp_coupon_redeem. */
    DECLARE @aplicable BIT = CASE WHEN @motivo = 'OK' AND @kind = 'FREE_PRODUCT' THEN 1 ELSE 0 END;

    SELECT
        CAST(CASE WHEN @motivo = 'OK' THEN 1 ELSE 0 END AS BIT) AS ok,
        @motivo AS motivo,
        @aplicable AS aplicable,
        ci.id AS instance_id,
        ci.code,
        ci.definition_id,
        cd.name AS nombre,
        cd.kind,
        cd.amount,
        cd.discount_pct,
        cd.product_id,
        p.nombre AS product_name,
        ci.expires_at,
        ci.uses_allowed,
        ci.uses_count,
        ci.customer_id,
        c.customerName AS cliente,
        CASE @motivo
            WHEN 'NO_EXISTE' THEN N'Ese código no existe.'
            WHEN 'EXPIRADO'  THEN N'Este cupón ya venció.'
            WHEN 'AGOTADO'   THEN N'Este cupón ya se usó.'
            WHEN 'ANULADO'   THEN N'Este cupón fue anulado.'
            WHEN 'INACTIVO'  THEN N'Esta promoción ya no está disponible.'
            ELSE CASE WHEN @aplicable = 1
                      THEN CONCAT(N'Cupón válido: ', cd.name)
                      ELSE N'Cupón válido, pero este tipo de descuento todavía no se puede aplicar en caja.'
                 END
        END AS mensaje
    FROM dbo.coupon_instances ci
    JOIN dbo.coupon_definitions cd ON cd.id = ci.definition_id
    LEFT JOIN dbo.products p ON p.id = cd.product_id
    LEFT JOIN dbo.customers c ON c.id = ci.customer_id
    WHERE ci.id = @id

    UNION ALL

    /* El codigo inexistente tambien tiene que devolver fila: la pantalla
       espera siempre una respuesta con su motivo, no una lista vacia que
       tendria que interpretar. */
    SELECT CAST(0 AS BIT), 'NO_EXISTE', CAST(0 AS BIT), NULL, @code, NULL, NULL, NULL,
           NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL,
           N'Ese código no existe.'
    WHERE @id IS NULL;
END
GO
