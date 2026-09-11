/* sp_coupon_redeem
 * Definicion canonica. Mantener este archivo y generar una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* ============================================================
   sp_coupon_redeem — consumir un cupon, ligado a la venta que lo uso.

   CUANDO
   ------
   DESPUES de que la venta esta cobrada. La redencion apunta a `sale_id`, y
   ese id no existe hasta que `sp_register_sale` confirmo. Un cupon consumido
   por una venta que acabo en ROLLBACK seria un cupon perdido sin que nadie
   comprara nada.

   UN SOLO USO, AUNQUE DOS CAJAS LO INTENTEN A LA VEZ
   --------------------------------------------------
   Esto NO se resuelve escondiendo el boton. Dos cajas pueden tener el mismo
   papel delante -o el mismo codigo dictado por telefono- y pulsar cobrar en
   el mismo segundo.

   La garantia es el UPDATE condicional de abajo: las condiciones viven en el
   WHERE, no en un IF previo. SQL Server evalua ese WHERE con la fila
   bloqueada, asi que de dos intentos simultaneos exactamente uno encuentra
   fila que actualizar y el otro recibe @@ROWCOUNT = 0. Un `IF EXISTS`
   seguido de un UPDATE dejaria pasar a los dos: entre leer y escribir cabe
   la otra sesion entera.

   BENEFICIOS SOPORTADOS EN V1
   ---------------------------
   FREE_PRODUCT   se aplica poniendo a cero el precio de esa linea en la
                  venta. Encaja con el contrato actual: la linea sigue
                  descontando inventario, el ticket dice "0.00" -que es la
                  verdad- y el total cuadra solo.

   AMOUNT         NO se aplican todavia. `sales` no tiene concepto de
   PERCENT        descuento: `sp_register_sale` calcula el total como
                  SUM(quantity * unit_price) y no hay donde poner una rebaja
                  que no pertenezca a una linea.

                  Repartirla entre las lineas seria mentir sobre el precio de
                  cada producto: el ticket diria que el cafe costo 43.27, la
                  factura llevaria ese precio al SAT y los informes de margen
                  calcularian sobre un precio que nadie cobro.

                  Hacerlo bien pide que la venta CONOZCA el descuento -tabla,
                  procedure, ticket, facturacion e informes-, y eso es
                  rearquitectura del precio, no un anadido. Queda pendiente y
                  documentado; mientras tanto estos cupones se emiten y se
                  validan, pero la caja avisa de que no puede aplicarlos.
   ============================================================ */
CREATE OR ALTER PROCEDURE [dbo].[sp_coupon_redeem]
    @code NVARCHAR(24),
    @sale_id INT,
    @register_id INT = NULL,
    @machine_id NVARCHAR(64) = NULL,
    @amount_applied DECIMAL(12,2) = 0
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    DECLARE @ahora DATETIME2(0) = SYSDATETIME();   /* hora local: misma politica que sp_loyalty_evaluate_sale */
    SET @code = LTRIM(RTRIM(ISNULL(@code, N'')));

    IF NOT EXISTS (SELECT 1 FROM dbo.sales WHERE id = @sale_id)
    BEGIN
        SELECT CAST(0 AS BIT) AS ok, 'SIN_VENTA' AS motivo,
               N'No se puede canjear un cupón sin una venta confirmada.' AS mensaje,
               CAST(NULL AS INT) AS redemption_id, CAST(NULL AS INT) AS instance_id,
               CAST(NULL AS INT) AS uses_count, CAST(NULL AS INT) AS uses_allowed,
               CAST(NULL AS NVARCHAR(12)) AS estado;
        RETURN;
    END

    DECLARE @id INT, @redemption_id INT, @usados INT, @permitidos INT, @estado NVARCHAR(12);

    BEGIN TRY
        BEGIN TRAN;

        /* Idempotencia: si esta venta YA canjeo este cupon, no se cobra otro
           uso. Un reintento del IPC no puede gastar dos veces el mismo papel. */
        SELECT @redemption_id = lr.id, @id = lr.coupon_instance_id
        FROM dbo.loyalty_redemptions lr
        JOIN dbo.coupon_instances ci ON ci.id = lr.coupon_instance_id
        WHERE lr.sale_id = @sale_id AND ci.code = @code AND lr.kind = 'COUPON';

        IF @redemption_id IS NOT NULL
        BEGIN
            SELECT @usados = uses_count, @permitidos = uses_allowed, @estado = status
            FROM dbo.coupon_instances WHERE id = @id;
            COMMIT TRAN;

            SELECT CAST(1 AS BIT) AS ok, 'YA_REGISTRADO' AS motivo,
                   N'Este cupón ya estaba canjeado en esta venta.' AS mensaje,
                   @redemption_id AS redemption_id, @id AS instance_id,
                   @usados AS uses_count, @permitidos AS uses_allowed, @estado AS estado;
            RETURN;
        END

        /* ----------------------------------------------------------------
           EL consumo. Todas las condiciones en el WHERE, a proposito.
           ---------------------------------------------------------------- */
        UPDATE ci
           SET uses_count = ci.uses_count + 1,
               status = CASE WHEN ci.uses_count + 1 >= ci.uses_allowed
                             THEN 'REDEEMED' ELSE ci.status END,
               sale_id = ISNULL(ci.sale_id, @sale_id)
          FROM dbo.coupon_instances ci
          JOIN dbo.coupon_definitions cd ON cd.id = ci.definition_id
         WHERE ci.code = @code
           AND ci.status = 'ISSUED'
           AND cd.active = 1
           AND ci.uses_count < ci.uses_allowed
           AND (ci.expires_at IS NULL OR ci.expires_at >= @ahora);

        IF @@ROWCOUNT = 0
        BEGIN
            ROLLBACK TRAN;

            /* Se explica POR QUE no se pudo, releyendo el estado ya estable.
               "No se pudo" a secas dejaria al cajero sin nada que decirle al
               cliente que tiene el papel en la mano. */
            DECLARE @motivo NVARCHAR(20), @msg NVARCHAR(200);
            SELECT @motivo = CASE
                       WHEN ci.id IS NULL THEN 'NO_EXISTE'
                       WHEN ci.status = 'VOID' THEN 'ANULADO'
                       WHEN cd.active = 0 THEN 'INACTIVO'
                       WHEN ci.expires_at IS NOT NULL AND ci.expires_at < @ahora THEN 'EXPIRADO'
                       ELSE 'AGOTADO' END
            FROM dbo.coupon_instances ci
            JOIN dbo.coupon_definitions cd ON cd.id = ci.definition_id
            WHERE ci.code = @code;

            IF @motivo IS NULL SET @motivo = 'NO_EXISTE';
            SET @msg = CASE @motivo
                WHEN 'NO_EXISTE' THEN N'Ese código no existe.'
                WHEN 'EXPIRADO'  THEN N'Este cupón ya venció.'
                WHEN 'ANULADO'   THEN N'Este cupón fue anulado.'
                WHEN 'INACTIVO'  THEN N'Esta promoción ya no está disponible.'
                ELSE N'Este cupón ya se usó.' END;

            SELECT CAST(0 AS BIT) AS ok, @motivo AS motivo, @msg AS mensaje,
                   CAST(NULL AS INT) AS redemption_id, CAST(NULL AS INT) AS instance_id,
                   CAST(NULL AS INT) AS uses_count, CAST(NULL AS INT) AS uses_allowed,
                   CAST(NULL AS NVARCHAR(12)) AS estado;
            RETURN;
        END

        SELECT @id = id, @usados = uses_count, @permitidos = uses_allowed, @estado = status
        FROM dbo.coupon_instances WHERE code = @code;

        INSERT INTO dbo.loyalty_redemptions
            (kind, reward_instance_id, coupon_instance_id, sale_id, register_id,
             machine_id, amount_applied, created_at)
        VALUES
            ('COUPON', NULL, @id, @sale_id, @register_id,
             @machine_id, ISNULL(@amount_applied, 0), @ahora);

        SET @redemption_id = SCOPE_IDENTITY();

        COMMIT TRAN;
    END TRY
    BEGIN CATCH
        IF XACT_STATE() <> 0 ROLLBACK TRAN;
        DECLARE @err NVARCHAR(400) = ERROR_MESSAGE();
        RAISERROR(@err, 16, 1);
        RETURN;
    END CATCH

    SELECT CAST(1 AS BIT) AS ok, 'OK' AS motivo,
           N'Cupón canjeado.' AS mensaje,
           @redemption_id AS redemption_id, @id AS instance_id,
           @usados AS uses_count, @permitidos AS uses_allowed, @estado AS estado;
END
GO
